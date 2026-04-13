function createItemsRepository(db) {
  function upsertItem(item) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO items (
          id, title, price, url, location, seller_name, category, query,
          first_seen_at, last_seen_at, last_notified_at, is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          price = excluded.price,
          url = excluded.url,
          location = excluded.location,
          seller_name = excluded.seller_name,
          category = excluded.category,
          query = excluded.query,
          last_seen_at = excluded.last_seen_at,
          is_active = 1;
      `;

      const now = new Date().toISOString();

      db.run(
        query,
        [
          item.id,
          item.title,
          item.price,
          item.url,
          item.location,
          item.seller_name,
          item.category,
          item.query,
          item.first_seen_at || now,
          now,
          item.last_notified_at || null,
        ],
        function (err) {
          if (err) return reject(err);
          resolve(this);
        }
      );
    });
  }

  function markAsNotified(id) {
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE items
        SET last_notified_at = ?
        WHERE id = ?
      `;

      db.run(query, [new Date().toISOString(), id], function (err) {
        if (err) return reject(err);
        resolve(this);
      });
    });
  }

  function getUnnotifiedItems() {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM items
        WHERE last_notified_at IS NULL
        ORDER BY first_seen_at DESC
      `;

      db.all(query, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  }

  function deactivateOldItems() {
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE items
        SET is_active = 0
        WHERE last_seen_at < datetime('now', '-7 days')
      `;

      db.run(query, [], function (err) {
        if (err) return reject(err);
        resolve(this);
      });
    });
  }

  return {
    upsertItem,
    markAsNotified,
    getUnnotifiedItems,
    deactivateOldItems,
  };
}

module.exports = { createItemsRepository };