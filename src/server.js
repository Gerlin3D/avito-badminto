const express = require("express");
require("dotenv").config();
const path = require("path");
const { searchAvito } = require("./provider/avitoProvider");
const { syncToSheets, getSheetNames, deleteSheet } = require("./sheets/syncToSheets");
const { createItemsRepository } = require("./db/itemsRepository");
const { initDb } = require("./db/initDb");
const { message } = require("telegraf/filters");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// app.get('/', (req, res) => {
//   res.send('Hello World!');
// });

let sseClient = null;
let isStopped = false;
let isRunning = false;

function sendLog(message) {
  console.log("Sent log to client::: ", message);
  if (sseClient) {
    sseClient.write(`data: ${JSON.stringify({ message })}\n\n`);
  }
}


async function scrapeWithRetry(query, options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await searchAvito(query, options);
    } catch (error) {
      if (error.message.includes('blocked') && attempt < maxRetries) {
        sendLog(`⚠️ Заблокировано. Попытка ${attempt}/${maxRetries}, жду 30 сек...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      } else {
        throw error;
      }
    }
  }
}

app.post("/scrape", async (req, res) => {
  try {
    const { query, location, locationName } = req.body;
    const maxPages = Number(
      req.body.maxPages || process.env.AVITO_MAX_PAGES || 1,
    );

    if (!query?.trim()) {
      return res.status(400).json({ message: "Query is required" });
    }

    console.log("Received query:", query);

    isStopped = false;
    isRunning = true;
    
    sendLog(
      `🔍 Запускаю парсинг: "${query}", город: ${locationName}, страниц: ${maxPages}`,
    );


    const collectedItems = [];
    const seenIds = new Set();
    let stopReason = '';
    let parsedPages = 0;

    for (let page = 1; page <= maxPages; page++) {

      if (isStopped) {
        sendLog(`🛑 Парсинг остановлен`);
        break;
      }

      sendLog(`📄 Парсинг страницы ${page}/${maxPages}...`);


      const result = await scrapeWithRetry(query.trim(), { location: location || 'rossiya', locationName, page });


      if (result.items.length === 0) {
        stopReason = `Нет объявлений на странице ${page}`;
        break;
      }

      const newItems = result.items.filter(item => {
        if (seenIds.has(item.id)) return false;
        seenIds.add(item.id);
        return true;
      });

      if (newItems.length === 0) {
        stopReason = `Страница ${page} повторяет уже найденные`;
        break;
      }

      for (const item of newItems) {
        await repo.upsertItem(item);
      }

      collectedItems.push(...newItems);
      sendLog(`✅ Страница ${page}: найдено ${newItems.length} новых`);

      try {
        const allQueryItems = await repo.getItemsByQuery(query.trim());
        await syncToSheets(allQueryItems, query.trim());
        sendLog(`📊 Синк в Google Sheets завершён`);
      } catch (sheetsError) {
        console.error('Sheets sync failed:', sheetsError.message);
        sendLog(`❌ Ошибка синка в Sheets: ${sheetsError.message}`);
      }

      if (page < maxPages) {
        const delay = 2000 + Math.random() * 5000;
        sendLog(`⏳ Пауза ${Math.round(delay / 1000)} сек...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      parsedPages++;
    }

    if (!stopReason) stopReason = `Достигнут лимит ${maxPages} страниц`;

    const finalResult = { items: collectedItems, stopReason, parsedPages};


    sendLog(`✅ Готово! Найдено объявлений: ${finalResult.items.length}`);
    sendLog(`ℹ️ Остановка: ${finalResult.stopReason}`);

    isRunning = false;

    res.status(200).json({
      message: "Scrape finished",
      query,
      maxPages,
      ...finalResult,
    });
  } catch (error) {
    console.error("Scrape failed:", error);
    res.status(500).json({ message: error.message });
  }
});

app.get("/events", (req, res) => {
  res.header("Content-Type", "text/event-stream");
  res.header("Cache-Control", "no-cache");
  res.header("Connection", "keep-alive");

  res.write('data: {"message": "Connected"}\n\n');
  sseClient = res;
  res.on("close", () => {
    console.log("Client disconnected");
  });
});

let repo;

initDb().then((db) => {
  repo = createItemsRepository(db);

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
})


app.delete("/clear", async (req, res) => {
  try {
    await repo.clearAllItems()
    res.status(200).json({message: "База очищена"})
  } catch (error) {
    res.status(500).json({message: error.message})
  }
})

app.post("/stop", async (req, res) => {
  if (!isRunning) {
    return res.status(400).json({message: "Куда жмякаешь? Парсинг не запущен"})
  }
  try {
    isStopped = true;
    isRunning = false;
    res.status(200).json({message: "Парсинг остановлен"})
  } catch (error) {
    res.status(500).json({message: error.message})
  }
})

app.get("/queries", async (req, res) => {
  try {
    const queries = await getSheetNames();
    res.json({ queries })
  } catch (error) {
    res.status(500).json({message: error.message})
  }
})

app.delete("/queries/:query", async (req, res) => {
  try {
    const query = decodeURIComponent(req.params.query);
    await repo.deleteItemsByQuery(query);
    await deleteSheet(query);
    res.json({ message: `Удалены объявления для запроса "${query}"` })
  } catch (error) {
    res.status(500).json({message: error.message})
  }
})



