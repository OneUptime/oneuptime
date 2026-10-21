/*
 * ONE LOOKUP PER KEY, KEPT AS LONG AS ITS CACHE.
 *
 * The cache holds each lookup's promise, so reads made at the same time
 * share one lookup rather than racing to make it twice, and later reads take
 * the answer without asking again. A lookup that fails is forgotten, so the
 * next read asks again. How long answers live is the cache's own lifetime: a
 * Map, or a WeakMap keyed by an object whose lifetime is the right one (a
 * request's interaction props, a record held in a short-lived cache).
 *
 * Unlike SingleFlight, which forgets a key as soon as its work settles, an
 * answer stays for as long as the cache does.
 */
export interface PromiseCacheStore<TKey, TValue> {
  get(key: TKey): Promise<TValue> | undefined;
  set(key: TKey, value: Promise<TValue>): unknown;
  delete(key: TKey): unknown;
}

export default class PromiseCache {
  // The cached lookup for `key`, starting it if nothing has yet.
  public static lookUpOnce<TKey, TValue>(
    cache: PromiseCacheStore<TKey, TValue>,
    key: TKey,
    lookUp: () => Promise<TValue>,
  ): Promise<TValue> {
    const cached: Promise<TValue> | undefined = cache.get(key);

    if (cached) {
      return cached;
    }

    // A lookUp that throws before its first await still yields a promise.
    const pending: Promise<TValue> = (async (): Promise<TValue> => {
      return await lookUp();
    })();

    cache.set(key, pending);

    pending.catch((): void => {
      // Only if it is still this lookup: a later one may have replaced it.
      if (cache.get(key) === pending) {
        cache.delete(key);
      }
    });

    return pending;
  }
}
