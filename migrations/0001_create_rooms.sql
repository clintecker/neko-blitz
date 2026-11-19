-- Online room state, seat-token hashes, and optimistic-concurrency revision.
CREATE TABLE IF NOT EXISTS `blitz_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`updated` integer NOT NULL,
	`body` text NOT NULL
);
