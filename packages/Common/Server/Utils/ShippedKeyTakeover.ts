import { isShippedSecretValue } from "../EnvironmentConfig";

/*
 * THE ROW A COMPONENT COMING BACK UNDER A NEW KEY TAKES OVER
 *
 * A global probe (Telemetry/API/ProbeIngest/Register) is one row, found by
 * the key the probe presents. An installation that ran it on a key this
 * repository ships (EnvironmentConfig.isShippedSecretValue) gets random keys
 * instead - npm start and npm run update put them in config.env for Docker
 * Compose - so the same probe comes back under a key no row holds yet. The
 * row it ran as is refused on every request from then on (a shipped key
 * never authenticates), so the probe takes that row over: it keeps its id,
 * and with it everything that points at it - its monitors.
 *
 * The rule:
 *
 *   - a row that already holds the presented key is the component's own (a
 *     second instance of it took the row over a moment ago), so it is the
 *     one;
 *   - otherwise only a row whose key is a value this repository ships is
 *     ever taken over. A row whose key is the installation's own is proved
 *     by that key alone, so nothing else - a name, the registration key -
 *     moves it to another key;
 *   - of several such rows, the one that reported in last is the one the
 *     component ran as.
 *
 * The caller has already proved it is one of the installation's own probes
 * (REGISTER_PROBE_KEY) and narrowed the rows to the global probes of its
 * name.
 */
export interface TakeoverCandidate {
  key?: string | undefined | null;
  lastAlive?: Date | undefined | null;
}

export default class ShippedKeyTakeover {
  public static pickRowToTakeOver<T extends TakeoverCandidate>(data: {
    rows: Array<T>;
    presentedKey: string;
  }): T | null {
    const alreadyHeld: T | undefined = data.rows.find((row: T) => {
      return row.key === data.presentedKey;
    });

    if (alreadyHeld) {
      return alreadyHeld;
    }

    const shippedKeyRows: Array<T> = data.rows.filter((row: T) => {
      return isShippedSecretValue(row.key);
    });

    if (shippedKeyRows.length === 0) {
      return null;
    }

    // The most recently alive first; a row never alive last. Stable for ties.
    return (
      [...shippedKeyRows].sort((a: T, b: T) => {
        return (
          ShippedKeyTakeover.lastAliveInMs(b) -
          ShippedKeyTakeover.lastAliveInMs(a)
        );
      })[0] || null
    );
  }

  // When the row last reported in, or -1 for a row that never did.
  private static lastAliveInMs(row: TakeoverCandidate): number {
    if (!row.lastAlive) {
      return -1;
    }

    const time: number = new Date(row.lastAlive).getTime();

    return Number.isNaN(time) ? -1 : time;
  }
}
