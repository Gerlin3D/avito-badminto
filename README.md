# Avito Parser

Avito Parser is a Node.js pet project for collecting listings from Avito, storing them in SQLite, syncing results to Google Sheets, and triggering runs through either a small web UI or a Telegram bot.

The project uses browser automation with Playwright/Patchright, keeps a local database of seen items, and can process search results page by page.

## Features

- Search Avito listings by query and location
- Parse multiple result pages with duplicate filtering
- Store listings in a local SQLite database
- Sync collected data to Google Sheets
- Run scraping from an Express-based web UI
- Trigger scraping and cleanup actions from a Telegram bot
- Support optional proxy configuration for Avito and Telegram requests

## Tech Stack

- Node.js
- Express
- Playwright / Patchright
- SQLite
- Google Sheets API
- Telegraf

## Project Structure

```text
src/
  bot.js                   Telegram bot entry point
  index.js                 CLI-style scraper entry point
  server.js                Express server and web API
  provider/
    avitoProvider.js       Avito scraping logic
  db/
    initDb.js              SQLite initialization
    itemsRepository.js     Data access layer
    schema.sql             SQLite schema
  sheets/
    sheetsClient.js        Google Sheets client factory
    syncToSheets.js        Sheets sync logic
  public/
    index.html             Simple web interface
  testProxy.js             Single proxy check helper
  proxyMatrix.js           Batch proxy diagnostics
```

## How It Works

1. The scraper opens Avito in a browser context.
2. It navigates to a search URL built from the query, location, and page number.
3. It extracts listing data from the search results page.
4. New items are upserted into SQLite.
5. The collected dataset can be synced to a Google Sheet.
6. The same flow can be triggered from the web UI or Telegram bot.

## Requirements

- Node.js 18+
- Google Chrome installed locally if you use the persistent browser flow
- A Google service account JSON file for Sheets sync
- Optional Telegram bot token
- Optional proxy credentials

## Installation

```bash
npm install
```

## Environment Variables

Create a `.env` file in the project root and define the variables you need.

```env
AVITO_PROXY_ENABLED=false
AVITO_PROXY_SERVER=http://host:port
AVITO_PROXY_USERNAME=
AVITO_PROXY_PASSWORD=

AVITO_HEADLESS=true
AVITO_LOCATION=sankt-peterburg
AVITO_MAX_PAGES=5
AVITO_QUERY=badminton racket

GOOGLE_SHEET_ID=

TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_IDS=
TELEGRAM_PROXY_URL=
TELEGRAM_HANDLER_TIMEOUT_MS=600000

PORT=4000
DEBUG_AVITO=false
```

## Google Sheets Setup

1. Create a Google Cloud project.
2. Enable the Google Sheets API.
3. Create a service account.
4. Download the service account credentials JSON.
5. Place the file at `src/sheets/credentials.json`.
6. Share the target Google Sheet with the service account email.
7. Set `GOOGLE_SHEET_ID` in `.env`.

## Running the Project

Start the web server:

```bash
npm run dev
```

Start the Telegram bot:

```bash
npm run bot
```

Run the scraper entry point once:

```bash
npm start
```

## Available Scripts

- `npm start` - runs `src/index.js`
- `npm run dev` - starts the Express server with Nodemon
- `npm run bot` - starts the Telegram bot

## HTTP API

### `POST /scrape`

Starts scraping for a query.

Example payload:

```json
{
  "query": "badminton racket",
  "location": "sankt-peterburg",
  "locationName": "Saint Petersburg",
  "maxPages": 3
}
```

### `POST /clear`

Clears all saved items from the local database.

### `POST /stop`

Requests the currently running scraping job to stop.

### `GET /events`

Opens a server-sent events stream for scraper logs.

## Data Model

Listings are stored in SQLite with fields such as:

- `id`
- `title`
- `price`
- `url`
- `location`
- `seller_name`
- `category`
- `query`
- `first_seen_at`
- `last_seen_at`
- `last_notified_at`
- `is_active`

## Notes for Public Repositories

- Do not commit `.env`
- Do not commit `src/sheets/credentials.json`
- Rotate any tokens or proxy credentials before publishing
- Check Git history if sensitive values were ever committed

## Limitations

- The parser depends on Avito page structure and may break when the markup changes
- Requests may be blocked by captcha, IP restrictions, or anti-bot checks
- The project currently has no automated test suite
- The UI is minimal and intended mainly for internal usage

## Responsible Use

Use this project responsibly and make sure your usage complies with the target platform's terms, rate limits, and applicable laws.

## Future Improvements

- Add automated tests
- Add structured logging
- Improve retry and backoff logic
- Add export options beyond Google Sheets
- Improve UI and query management
- Add Docker support

## License

This repository currently has no license. Add one before publishing publicly if you want others to reuse the code.
