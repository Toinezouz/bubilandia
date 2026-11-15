/**
 * Asks the browser not to evict our IndexedDB data under storage pressure.
 * Safari may still refuse or ignore it, so backups (export) remain the real safety net.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
