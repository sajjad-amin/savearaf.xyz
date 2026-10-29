import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

const connectionString =
  (typeof import.meta !== 'undefined' && import.meta.env?.DATABASE_URL) ||
  process.env.DATABASE_URL ||
  '';

export const poolConnection = mysql.createPool({ uri: connectionString });

export const db = drizzle(poolConnection, { schema, mode: 'default' });
export { schema };
