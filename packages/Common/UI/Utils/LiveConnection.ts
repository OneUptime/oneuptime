// Type-only on purpose: see below.
import type Realtime from "./Realtime";

/*
 * THE APP'S LIVE CONNECTION, FOR A PART THAT ONLY JOINS ONE ALREADY OPEN.
 *
 * Realtime keeps the app's live connection (socket.io), which the Dashboard
 * opens as it starts, before anything is drawn. A side menu's count hears
 * its table's changes on it (UseLiveCount), and where no connection is open
 * - a status page's subscribe menu, a preview - it opens none and stays as
 * it is drawn. Asking Realtime itself whether it is open would import it,
 * and socket.io and the analytics models with it, into the first load of
 * every page that draws a side menu: about 18 KiB gzipped of a status
 * page's (packages/Common/Scripts/first-load-budgets.js).
 *
 * So Realtime says here that it has opened the connection, and a part that
 * only joins an open one asks here, reading Realtime's type alone.
 */
let openLiveConnection: typeof Realtime | null = null;

// Realtime, once it has opened the app's live connection: null until then.
export function getOpenLiveConnection(): typeof Realtime | null {
  return openLiveConnection;
}

// Realtime says so as it opens the connection (Realtime.init).
export function setOpenLiveConnection(realtime: typeof Realtime): void {
  openLiveConnection = realtime;
}
