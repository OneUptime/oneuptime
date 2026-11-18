import { useMemo, useSyncExternalStore } from "react";
import { AppProduct, fetchProductsOffOnServer } from "../api/serverProducts";

/*
 * WHAT THE SERVER HAS SWITCHED OFF, FOR THE APP TO LEAVE OUT (#7478).
 *
 * The list is the server's, the same in every project, so one answer serves
 * the whole session: the ProjectProvider reads it from the selected
 * project's products answer once the person's projects are known, and
 * again when another project is chosen after PRODUCTS_OFF_ON_SERVER_STALE_
 * TIME_MS, as the web keeps it; signing out forgets it. Until it is read,
 * and when it cannot be read, nothing is off (api/serverProducts): the app
 * never hides a working product for want of an answer.
 *
 * Kept here rather than in React Query or the project context: the tab bar
 * asks before anything else is drawn, and a screen drawn on its own - in a
 * test, or before the person's projects are known - reads "nothing off"
 * instead of failing.
 */

export const PRODUCTS_OFF_ON_SERVER_STALE_TIME_MS: number = 5 * 60 * 1000;

export interface ProductsOffOnServer {
  // Whether the server has switched this product off.
  isOff: (product: AppProduct) => boolean;
  off: ReadonlySet<AppProduct>;
}

const NOTHING_OFF: ReadonlySet<AppProduct> = new Set<AppProduct>();

let currentOff: ReadonlySet<AppProduct> = NOTHING_OFF;
let readAt: number = 0;
let reading: Promise<void> | null = null;
// Bumped by a reset, so an answer on its way for the last session is dropped.
let session: number = 0;
const listeners: Set<() => void> = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return (): void => {
    listeners.delete(listener);
  };
}

// What is known to be off: nothing until the server's answer is read.
export function getProductsOffOnServer(): ReadonlySet<AppProduct> {
  return currentOff;
}

/*
 * Reads what is off from one of the person's projects, unless a fresh answer
 * is kept or one is on its way. A failed read keeps what was known.
 */
export function loadProductsOffOnServer(
  projectId: string,
  now: number = Date.now(),
): Promise<void> {
  if (reading) {
    return reading;
  }

  if (readAt > 0 && now - readAt < PRODUCTS_OFF_ON_SERVER_STALE_TIME_MS) {
    return Promise.resolve();
  }

  const readingSession: number = session;

  reading = fetchProductsOffOnServer(projectId)
    .then((off: Set<AppProduct>): void => {
      if (readingSession !== session) {
        return;
      }

      currentOff = off.size > 0 ? off : NOTHING_OFF;
      readAt = Date.now();
      notify();
    })
    .catch((): void => {
      // Nothing is off for want of an answer; the next look asks again.
    })
    .finally((): void => {
      if (readingSession === session) {
        reading = null;
      }
    });

  return reading;
}

// Forgets the answer: signing out, and tests.
export function resetProductsOffOnServer(): void {
  session += 1;
  currentOff = NOTHING_OFF;
  readAt = 0;
  reading = null;
  notify();
}

export function useProductsOffOnServer(): ProductsOffOnServer {
  const off: ReadonlySet<AppProduct> = useSyncExternalStore(
    subscribe,
    getProductsOffOnServer,
    getProductsOffOnServer,
  );

  return useMemo((): ProductsOffOnServer => {
    return {
      off: off,
      isOff: (product: AppProduct): boolean => {
        return off.has(product);
      },
    };
  }, [off]);
}
