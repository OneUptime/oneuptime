import { jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Reauthentication from "../../../Server/Utils/Reauthentication/Reauthentication";

/*
 * A suite about something else that changes how a person signs in - a new
 * password's email, a held change of address, an authenticator app's QR code
 * - goes through the check of #10155 first: the session must have confirmed
 * it's its person's (Server/Utils/Reauthentication). Such a suite calls this
 * in its beforeEach, and every session it writes with has confirmed; the
 * check itself, through the same hooks and routes, is pinned by
 * Tests/Server/Utils/Reauthentication and Tests/Server/Services/
 * ReauthenticationGates.test.ts.
 *
 * Returns the spy, so a suite can still assert the check was asked.
 */
export const confirmEverySession: () => SpyInstance<
  typeof Reauthentication.assertConfirmed
> = (): SpyInstance<typeof Reauthentication.assertConfirmed> => {
  return jest
    .spyOn(Reauthentication, "assertConfirmed")
    .mockResolvedValue(undefined);
};
