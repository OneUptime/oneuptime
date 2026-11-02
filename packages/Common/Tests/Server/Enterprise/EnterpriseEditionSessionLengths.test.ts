import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import { EnterpriseServerModuleShape } from "../../../Server/Enterprise/EnterpriseServerModule";
import logger from "../../../Server/Utils/Logger";
import {
  NO_SESSION_LENGTHS,
  SessionLengths,
} from "../../../Types/UserSession/SessionLength";
import FakeEnterpriseModule, {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "./FakeEnterpriseModule";
import { setTestBillingEnabled } from "./TestBillingFlag";

// Billing pinned through the mocked EnvironmentConfig (CI's config.env sets BILLING_ENABLED=true).
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("./TestBillingFlag") = jest.requireActual(
    "./TestBillingFlag",
  ) as typeof import("./TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * EnterpriseEdition.getUserSessionLengths / forgetUserSessionLengths: how
 * long sign-ins last on this server, as every sign-in, renewal, request
 * and live update asks it (Types/UserSession/SessionLength.ts).
 *
 * Core decides nothing about the lengths; it holds every session to what
 * the enterprise module hands it, held to what a GlobalConfig column could
 * hold:
 *   - the Community Edition, a module without the hook, a module answering
 *     null or nothing set: no lengths (null) - every sign-in as it always
 *     was;
 *   - an answer is read again value by value, so a stray value never
 *     shortens anyone's sign-in;
 *   - a module that cannot say throws, and so does this: a session check
 *     that cannot know the lengths refuses (an error), never "no limit";
 *   - forgetting never throws, whatever the module does.
 */

beforeEach(() => {
  setTestBillingEnabled(false);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

const SET: SessionLengths = {
  standard: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
  sso: { lengthInMinutes: 720, idleTimeoutInMinutes: null },
};

describe("EnterpriseEdition.getUserSessionLengths", () => {
  test("is null on the Community Edition: every sign-in lasts as it always has", async () => {
    uninstallEnterpriseModule();

    await expect(EnterpriseEdition.getUserSessionLengths()).resolves.toBeNull();
  });

  test("is null when the module has no say in it (an older module)", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      userSessionLengths: SET,
    });
    (fake as unknown as Record<string, unknown>)["getUserSessionLengths"] =
      undefined;

    await expect(EnterpriseEdition.getUserSessionLengths()).resolves.toBeNull();
  });

  test("is null when the module answers null, or nothing is set", async () => {
    installFakeEnterpriseModule({ userSessionLengths: null });
    await expect(EnterpriseEdition.getUserSessionLengths()).resolves.toBeNull();

    installFakeEnterpriseModule({ userSessionLengths: NO_SESSION_LENGTHS });
    await expect(EnterpriseEdition.getUserSessionLengths()).resolves.toBeNull();
  });

  test("hands over what the module answers, asked every time", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      userSessionLengths: SET,
    });

    await expect(EnterpriseEdition.getUserSessionLengths()).resolves.toEqual(
      SET,
    );
    await EnterpriseEdition.getUserSessionLengths();

    expect(fake.userSessionLengthsReads).toBe(2);
  });

  test("reads every value again: what no column could hold is the default", async () => {
    installFakeEnterpriseModule({
      userSessionLengths: {
        standard: { lengthInMinutes: 5, idleTimeoutInMinutes: 30 },
        sso: {
          lengthInMinutes: "60" as unknown as number,
          idleTimeoutInMinutes: 99999999,
        },
      },
    });

    await expect(EnterpriseEdition.getUserSessionLengths()).resolves.toEqual({
      standard: { lengthInMinutes: null, idleTimeoutInMinutes: 30 },
      sso: { lengthInMinutes: null, idleTimeoutInMinutes: null },
    });
  });

  test("an answer of nothing but stray values is no lengths at all", async () => {
    installFakeEnterpriseModule({
      userSessionLengths: {
        standard: { lengthInMinutes: 1, idleTimeoutInMinutes: -5 },
        sso: { lengthInMinutes: 0, idleTimeoutInMinutes: Number.NaN },
      },
    });

    await expect(EnterpriseEdition.getUserSessionLengths()).resolves.toBeNull();
  });

  test("throws when the module cannot say: a session check refuses rather than let a session outlive them", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      userSessionLengths: SET,
    });
    fake.userSessionLengthsError = new Error("not read yet");

    await expect(EnterpriseEdition.getUserSessionLengths()).rejects.toThrow(
      "not read yet",
    );
  });

  test("does not depend on the license: lengths a lapsed install set keep applying", async () => {
    installFakeEnterpriseModule({
      userSessionLengths: SET,
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    expect(
      EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SessionLength),
    ).toBe(false);
    await expect(EnterpriseEdition.getUserSessionLengths()).resolves.toEqual(
      SET,
    );
  });
});

describe("EnterpriseEdition.forgetUserSessionLengths", () => {
  test("tells the module, so its next answer reads them again", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

    EnterpriseEdition.forgetUserSessionLengths();
    EnterpriseEdition.forgetUserSessionLengths();

    expect(fake.forgetUserSessionLengthsCount).toBe(2);
  });

  test("is nothing on the Community Edition, or for a module without the hook", () => {
    uninstallEnterpriseModule();
    expect(() => {
      EnterpriseEdition.forgetUserSessionLengths();
    }).not.toThrow();

    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    (fake as unknown as Record<string, unknown>)["forgetUserSessionLengths"] =
      undefined;
    expect(() => {
      EnterpriseEdition.forgetUserSessionLengths();
    }).not.toThrow();
  });

  test("never throws, even when the module does: forgetting never fails the write that changed them", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    fake.forgetUserSessionLengths = (): void => {
      throw new Error("boom");
    };

    expect(() => {
      EnterpriseEdition.forgetUserSessionLengths();
    }).not.toThrow();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("the module contract", () => {
  test("getUserSessionLengths and forgetUserSessionLengths are optional: a module without them is still a module", () => {
    const fake: FakeEnterpriseModule = new FakeEnterpriseModule();
    const withoutHooks: Record<string, unknown> = {
      ...(fake as unknown as Record<string, unknown>),
      init: fake.init.bind(fake),
      getIdentityRouters: fake.getIdentityRouters.bind(fake),
      getApiRouters: fake.getApiRouters.bind(fake),
      getAdminHealthRouter: fake.getAdminHealthRouter.bind(fake),
      registerWorkerJobs: fake.registerWorkerJobs.bind(fake),
      getAuditLogRecorder: fake.getAuditLogRecorder.bind(fake),
    };
    delete withoutHooks["getUserSessionLengths"];
    delete withoutHooks["forgetUserSessionLengths"];

    expect(EnterpriseServerModuleShape.findProblems(withoutHooks)).toEqual([]);
  });

  test("hooks that are there must be functions", () => {
    const fake: FakeEnterpriseModule = new FakeEnterpriseModule();
    const broken: Record<string, unknown> = {
      ...(fake as unknown as Record<string, unknown>),
      init: fake.init.bind(fake),
      getIdentityRouters: fake.getIdentityRouters.bind(fake),
      getApiRouters: fake.getApiRouters.bind(fake),
      getAdminHealthRouter: fake.getAdminHealthRouter.bind(fake),
      registerWorkerJobs: fake.registerWorkerJobs.bind(fake),
      getAuditLogRecorder: fake.getAuditLogRecorder.bind(fake),
      getUserSessionLengths: "lengths",
      forgetUserSessionLengths: 42,
    };

    const problems: Array<string> =
      EnterpriseServerModuleShape.findProblems(broken);

    expect(problems).toEqual(
      expect.arrayContaining([
        '"getUserSessionLengths", when present, must be a function',
        '"forgetUserSessionLengths", when present, must be a function',
      ]),
    );
  });
});
