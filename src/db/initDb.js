const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, '../storage/avito.db');
const schemaPath = path.join(__dirname, 'schema.sql');

function initDb() {
  return new Promise((resolve, reject) => {
    const storageDir = path.dirname(dbPath);

    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }

      console.log('✅ SQLite connected:', dbPath);

      const schema = fs.readFileSync(schemaPath, 'utf-8');

      db.exec(schema, (schemaErr) => {
        if (schemaErr) {
          reject(schemaErr);
          return;
        }

        console.log('✅ Schema initialized');
        resolve(db);
      });
    });
  });
}

module.exports = { initDb };
