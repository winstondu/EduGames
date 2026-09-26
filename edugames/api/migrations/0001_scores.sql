-- High scores: one leaderboard per (game_id, board_key). Contract: src/shared/highscores/types.ts.
CREATE TABLE scores (
  id INTEGER PRIMARY KEY,
  game_id TEXT NOT NULL,
  generator_id TEXT NOT NULL,
  board_key TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  -- JSON object of primitives (<= 1 KB), or NULL.
  meta TEXT,
  -- Truncated salted SHA-256 of the client IP; only used for the per-IP submission rate limit.
  ip_hash TEXT,
  -- UTC "YYYY-MM-DD HH:MM:SS".
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Leaderboard reads (top N) and rank counts.
CREATE INDEX scores_board_score ON scores (game_id, board_key, score DESC);

-- Rate limit: recent submissions per IP.
CREATE INDEX scores_ip_recent ON scores (ip_hash, created_at);
