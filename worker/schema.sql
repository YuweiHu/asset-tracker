DROP TABLE IF EXISTS snapshots;
CREATE TABLE snapshots (
  date           TEXT NOT NULL,     -- 台灣日期 YYYY-MM-DD
  session        TEXT NOT NULL,     -- 'tw'（台股收盤）| 'us'（美股收盤）
  ts             INTEGER NOT NULL,  -- 結算當下 epoch ms
  total_twd      REAL,
  total_usd      REAL,
  breakdown_json TEXT,
  PRIMARY KEY (date, session)
);
