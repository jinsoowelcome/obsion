import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const pages=sqliteTable('published_pages',{
 id:text('id').primaryKey(),title:text('title').notNull(),markdown:text('markdown').notNull(),
 summary:text('summary').notNull().default(''),theme:text('theme').notNull().default('light'),
 digest:text('digest').notNull(),attachments:text('attachments').notNull().default('[]'),editingEnabled:integer('editing_enabled').notNull().default(0),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull()
});
export const nonces=sqliteTable('publish_nonces',{nonce:text('nonce').primaryKey(),createdAt:integer('created_at').notNull()});
export const attachmentHost=sqliteTable('attachment_host',{id:integer('id').primaryKey(),origin:text('origin').notNull(),token:text('token').notNull(),updatedAt:integer('updated_at').notNull()});
