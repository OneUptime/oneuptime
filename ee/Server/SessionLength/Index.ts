import type { ExpressRouter } from "Common/Server/Utils/Express";
import { SessionLengths } from "Common/Types/UserSession/SessionLength";
import EnterpriseArea from "../Types/EnterpriseArea";
import { createSessionLengthRouter } from "./API/SessionLengthAPI";
import sessionLengthProvider from "./SessionLengthProvider";

/*
 * Session length: how long a sign-in to OneUptime lasts, set by a master
 * admin (Admin Dashboard > Settings > Session Length) - a session length
 * and an idle timeout for every sign-in, and SSO sign-ins' own when they
 * have them (Common/Types/UserSession/SessionLength.ts). See ee/README.md,
 * "Session length".
 *
 *   init           reads the lengths, so the first request after a boot is
 *                  checked against them (never throws: a failed read is
 *                  retried at the next ask)
 *   getApiRouters  the preview the page asks before a change that signs
 *                  people out (API/SessionLengthAPI.ts)
 *
 * and the module's getUserSessionLengths / forgetUserSessionLengths
 * (../Index.ts) answer core from the two below. Core does the rest at every
 * sign-in, renewal and request (UserSessionService, UserMiddleware,
 * Realtime); without this module there are no lengths, and every sign-in
 * lasts as it does on the Community Edition.
 */

/*
 * The lengths core holds sessions to (EnterpriseServerModule.
 * getUserSessionLengths). Throws only while they have never been read.
 */
export const getUserSessionLengths: () => Promise<SessionLengths> =
  async (): Promise<SessionLengths> => {
    return await sessionLengthProvider.getLengths();
  };

// They just changed, here or on another server. Never throws.
export const forgetUserSessionLengths: () => void = (): void => {
  sessionLengthProvider.forget();
};

const SessionLengthArea: EnterpriseArea = {
  name: "SessionLength",
  init: async (): Promise<void> => {
    // Never throws: a failed read is logged and retried on the next ask.
    await sessionLengthProvider.refresh();
  },
  getApiRouters: (): Array<ExpressRouter> => {
    return [createSessionLengthRouter()];
  },
};

export default SessionLengthArea;
