import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// One versioned document keeps an entire turn atomic, including its public log.
export const rooms = sqliteTable("blitz_rooms", {
  code: text("code").primaryKey(),
  revision: integer("revision").notNull(),
  updated: integer("updated").notNull(),
  body: text("body").notNull(),
});
