import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const pages=sqliteTable('published_pages',{
 id:text('id').primaryKey(),title:text('title').notNull(),markdown:text('markdown').notNull(),
 summary:text('summary').notNull().default(''),theme:text('theme').notNull().default('light'),
 digest:text('digest').notNull(),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull()
});
export const nonces=sqliteTable('publish_nonces',{nonce:text('nonce').primaryKey(),createdAt:integer('created_at').notNull()});
