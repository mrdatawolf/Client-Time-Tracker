import { getLocalDb, closeLocalDb, getDbInitError, getDbPath, resetDbError, isDbInitialized, schema, initializeSchema, getPgliteClientInstance } from './local';

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
  initializeSchema,
  getPgliteClientInstance,
};

export * from '../schema';
