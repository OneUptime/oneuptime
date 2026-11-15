import GlobalConfigUtil, {
  GlobalConfigVars,
} from "../../UI/Utils/GlobalConfig";
import { jest } from "@jest/globals";

/*
 * THE SERVER'S GLOBAL CONFIG, ANSWERED BY THE SUITE.
 *
 * The Dashboard, the Admin Dashboard and the sign-in pages read
 * GET /api/global-config/vars through GlobalConfigUtil.fetchVars (whether
 * email can go out, whether push notifications are off, whether a user may
 * create a project). A suite that does not answer it sends it through jsdom's
 * XMLHttpRequest, which Tests/jest.setup.ts refuses and fails the test for
 * (Tests/Helpers/RealNetworkRequests.ts, #8403, #8607).
 *
 * This answers it the way a refused read is taken (Common/UI/Utils/
 * ServerSending.ts, Dashboard/src/Utils/PushNotificationsTurnedOff.ts): email
 * can go out, push notifications are on, projects can be created - what
 * GlobalConfigUtil.readVars reads from an answer that says nothing else -
 * unless the suite says otherwise. Call it in a beforeEach:
 * jest.restoreAllMocks() takes it away with the rest.
 */
export function standInForGlobalConfig(
  vars: Partial<GlobalConfigVars> = {},
): void {
  GlobalConfigUtil.clearCache();

  jest.spyOn(GlobalConfigUtil, "fetchVars").mockResolvedValue({
    ...GlobalConfigUtil.readVars({}),
    ...vars,
  });
}
