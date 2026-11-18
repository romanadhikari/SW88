import 'dotenv/config';
import { initDatabase, verifyDatabaseIntegrity } from './db.ts';

initDatabase();
const status = verifyDatabaseIntegrity();
console.log(
  JSON.stringify(
    {
      ok: status.ok,
      migrationVersion: status.migrationVersion,
      sqliteIntegrity: status.sqliteIntegrity,
      foreignKeyErrors: status.foreignKeyErrors,
      negativeWallets: status.negativeWallets,
    },
    null,
    2
  )
);

if (!status.ok) {
  process.exit(1);
}
