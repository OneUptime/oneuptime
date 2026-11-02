import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { ExpressRouter } from "Common/Server/Utils/Express";
import { SessionLengths } from "Common/Types/UserSession/SessionLength";
import EnterpriseModule, { ENTERPRISE_AREAS } from "../../../Server/Index";
import SessionLengthArea, {
  forgetUserSessionLengths,
  getUserSessionLengths,
} from "../../../Server/SessionLength/Index";
import sessionLengthProvider from "../../../Server/SessionLength/SessionLengthProvider";
import { listRoutes } from "../License/Helpers/LicenseTestKit";

/*
 * Session length as an area of the Enterprise module: it reads the lengths
 * at boot, serves the preview the Admin Dashboard asks, and answers core's
 * getUserSessionLengths / forgetUserSessionLengths from the one provider
 * every request of the process shares. Core does the rest - every sign-in,
 * renewal, request and live update is held to what it answers.
 */

const LENGTHS: SessionLengths = {
  standard: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
  sso: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the SessionLength area", () => {
  test("is one of the module's areas", () => {
    expect(ENTERPRISE_AREAS).toContain(SessionLengthArea);
    expect(SessionLengthArea.name).toBe("SessionLength");
  });

  test("reads the lengths at boot, so the first request is checked against them", async () => {
    const refresh: ReturnType<typeof jest.spyOn> = jest
      .spyOn(sessionLengthProvider, "refresh")
      .mockResolvedValue(LENGTHS as never);

    await SessionLengthArea.init!();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("a read that fails at boot does not stop the server from starting", async () => {
    jest
      .spyOn(sessionLengthProvider, "refresh")
      .mockResolvedValue(null as never);

    await expect(SessionLengthArea.init!()).resolves.toBeUndefined();
  });

  test("serves the preview, under /api", () => {
    const routers: Array<ExpressRouter> = SessionLengthArea.getApiRouters!();

    expect(routers).toHaveLength(1);
    expect(listRoutes(routers[0]!)).toEqual(["POST /session-length/preview"]);
  });
});

describe("what core is told", () => {
  test("getUserSessionLengths is the provider's answer", async () => {
    jest
      .spyOn(sessionLengthProvider, "getLengths")
      .mockResolvedValue(LENGTHS as never);

    await expect(getUserSessionLengths()).resolves.toEqual(LENGTHS);
    await expect(EnterpriseModule.getUserSessionLengths!()).resolves.toEqual(
      LENGTHS,
    );
  });

  test("a provider that has never read them throws, and so does the module: core refuses rather than let a session last longer", async () => {
    jest
      .spyOn(sessionLengthProvider, "getLengths")
      .mockRejectedValue(new Error("not read yet") as never);

    await expect(EnterpriseModule.getUserSessionLengths!()).rejects.toThrow(
      "not read yet",
    );
  });

  test("forgetUserSessionLengths makes the provider read them again", () => {
    const forget: ReturnType<typeof jest.spyOn> = jest.spyOn(
      sessionLengthProvider,
      "forget",
    );

    forgetUserSessionLengths();
    EnterpriseModule.forgetUserSessionLengths!();

    expect(forget).toHaveBeenCalledTimes(2);
  });
});
