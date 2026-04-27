const express = require('express');
require('dotenv').config();
const path = require('path');
const { searchAvitoPages } = require('./provider/avitoProvider');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// app.get('/', (req, res) => {
//   res.send('Hello World!');
// });

app.post('/scrape', async (req, res) => {
  try {
    const { query } = req.body;
    const maxPages = Number(req.body.maxPages || process.env.AVITO_MAX_PAGES || 1);

    if (!query?.trim()) {
      return res.status(400).json({ message: 'Query is required' });
    }

    console.log('Received query:', query);

    const result = await searchAvitoPages(query.trim(), {
      location: process.env.AVITO_LOCATION || 'sankt-peterburg',
      maxPages,
    });

    res.status(200).json({
      message: 'Scrape finished',
      query,
      maxPages,
      ...result,
    });
  } catch (error) {
    console.error('Scrape failed:', error);
    res.status(500).json({ message: error.message });
  }
});

app.get('/events', (req, res) => {
    res.header('Content-Type', 'text/event-stream');
    res.header('Cache-Control', 'no-cache');
    res.header('Connection', 'keep-alive');

    res.write('data: {"message": "Connected"}\n\n');
    
    res.on('close', () => {
        console.log('Client disconnected');
    });
})
    


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);   
})
