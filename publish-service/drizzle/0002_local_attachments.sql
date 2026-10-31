ALTER TABLE published_pages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
CREATE TABLE attachment_host (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 origin TEXT NOT NULL,
 token TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
