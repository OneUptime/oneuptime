/*
 * The session service's session length steps (Common/Server/Services/
 * UserSessionService: decideRenewal, endSessionByLength and
 * getSessionLengthEndReason) as a server whose session lengths are not set -
 * the Community Edition, or an Enterprise Edition that keeps the defaults:
 * every renewal goes ahead, its person active now, and no session was ever
 * ended by a length.
 *
 * POST /refresh-token asks them. The suites about something else, which
 * stand the whole session service in, spread these into theirs:
 *
 *   jest.mock("Common/Server/Services/UserSessionService", () => {
 *     return {
 *       __esModule: true,
 *       default: {
 *         ...(
 *           jest.requireActual(
 *             "./SessionLengthsNotSetStandIn",
 *           ) as typeof import("./SessionLengthsNotSetStandIn")
 *         ).sessionLengthsNotSet(),
 *         findActiveSessionByRefreshToken: ...,
 *       },
 *     };
 *   });
 *
 * SessionLengthRefresh.test.ts drives the refresh with lengths set.
 */

export interface SessionLengthSteps {
  decideRenewal: () => Promise<{
    hasEnded: false;
    lastActiveAt: Date;
    lengths: null;
  }>;
  endSessionByLength: () => Promise<void>;
  getSessionLengthEndReason: () => Promise<null>;
}

export const sessionLengthsNotSet: () => SessionLengthSteps =
  (): SessionLengthSteps => {
    return {
      decideRenewal: (): Promise<{
        hasEnded: false;
        lastActiveAt: Date;
        lengths: null;
      }> => {
        return Promise.resolve({
          hasEnded: false,
          lastActiveAt: new Date(),
          lengths: null,
        });
      },
      endSessionByLength: (): Promise<void> => {
        return Promise.resolve();
      },
      getSessionLengthEndReason: (): Promise<null> => {
        return Promise.resolve(null);
      },
    };
  };
