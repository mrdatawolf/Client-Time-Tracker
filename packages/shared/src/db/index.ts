import { getLocalDb, closeLocalDb, getDbInitError, getDbPath, resetDbError, isDbInitialized, schema } from './local';

export async function getDb() {
  return getLocalDb();
}

export {
  getLocalDb,
  closeLocalDb,
  getDbInitError,
  getDbPath,
  resetDbError,
  isDbInitialized,
  schema,
};

export * from '../schema';
