import { copyFile } from 'node:fs/promises';
await copyFile('server/schema.sql', 'server-dist/schema.sql');
