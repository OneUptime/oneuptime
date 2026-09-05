import ObjectID from "../../../../Types/ObjectID";

/*
 * The DB-row -> policy mapping for the Wave 4 columns. Everything else
 * about the gate cache (invalidation, kill key, fail-closed lookups) has
 * its own suites; this one pins that the correlation and performance
 * columns actually reach the policy object - and that a checkout whose
 * model predates the columns degrades to the feature-off values instead
 * of exploding, which is the entire reason the columns are read through
 * an index signature.
 */

const projectFindOneByMock: jest.Mock = jest.fn();
const appFindOneByMock: jest.Mock = jest.fn();

jest.mock("../../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return projectFindOneByMock(...args);
      },
    },
  };
});

jest.mock("../../../../Server/Services/RumApplicationService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return appFindOneByMock(...args);
      },
    },
  };
});

/*
 * The store is memory+Redis; both sides are irrelevant here, so every
 * cache read misses and the kill key never fires.
 */
jest.mock(
  "../../../../Server/Utils/SessionReplay/SessionReplayGateCacheStore",
  () => {
    return {
      __esModule: true,
      POLICY_CACHE_TTL_MS: 60_000,
      default: {
        getPolicyEntry: jest.fn().mockReturnValue(undefined),
        setPolicyEntry: jest.fn(),
        isProjectKilled: jest.fn((): Promise<boolean> => {
          return Promise.resolve(false);
        }),
      },
    };
  },
);

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import SessionReplayGateCache, {
  SessionReplayGatePolicy,
  SessionReplayPolicyRefusal,
  SessionReplayPolicyResolution,
} from "../../../../Server/Utils/SessionReplay/SessionReplayGateCache";
import SessionReplayGateCacheStore from "../../../../Server/Utils/SessionReplay/SessionReplayGateCacheStore";
import SessionReplayCaptureTrigger from "../../../../Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "../../../../Types/Rum/SessionReplayConsentMode";

const isProjectKilledMock: jest.Mock =
  SessionReplayGateCacheStore.isProjectKilled as unknown as jest.Mock;

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();

function projectRow(): unknown {
  return { isSessionReplayAllowed: true };
}

function appRow(overrides?: Record<string, unknown>): unknown {
  return {
    id: RUM_APPLICATION_ID,
    isSessionReplayEnabled: true,
    sessionReplayAllowedOrigins: ["https://shop.example.com"],
    updatedAt: new Date(1_800_000_000_000),
    ...overrides,
  };
}

describe("SessionReplayGateCache wave 4 policy columns", (): void => {
  beforeEach((): void => {
    jest.clearAllMocks();
    projectFindOneByMock.mockResolvedValue(projectRow());
  });

  it("maps the correlation and performance columns onto the policy", async (): Promise<void> => {
    appFindOneByMock.mockResolvedValue(
      appRow({
        sessionReplayTracePropagationOrigins: [
          "https://api.example.com",
          "https://payments.example.com",
        ],
        sessionReplayLcpBudgetMs: 4000,
        sessionReplayLongTaskBudgetMs: 250,
        sessionReplaySlowRequestBudgetMs: 6000,
      }),
    );

    const policy: SessionReplayGatePolicy | null =
      await SessionReplayGateCache.getPolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      });

    expect(policy).not.toBeNull();
    expect(policy?.tracePropagationOrigins).toEqual([
      "https://api.example.com",
      "https://payments.example.com",
    ]);
    expect(policy?.lcpBudgetMs).toBe(4000);
    expect(policy?.longTaskBudgetMs).toBe(250);
    expect(policy?.slowRequestBudgetMs).toBe(6000);
  });

  /*
   * A row from before the migration ran (or a model that predates the
   * columns): every reader defaults to OFF - empty origins, 0 budgets.
   */
  it("degrades to feature-off values when the columns are absent", async (): Promise<void> => {
    appFindOneByMock.mockResolvedValue(appRow());

    const policy: SessionReplayGatePolicy | null =
      await SessionReplayGateCache.getPolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      });

    expect(policy).not.toBeNull();
    expect(policy?.tracePropagationOrigins).toEqual([]);
    expect(policy?.lcpBudgetMs).toBe(0);
    expect(policy?.longTaskBudgetMs).toBe(0);
    expect(policy?.slowRequestBudgetMs).toBe(0);
  });

  it("drops non-string entries from the trace origins column", async (): Promise<void> => {
    appFindOneByMock.mockResolvedValue(
      appRow({
        sessionReplayTracePropagationOrigins: [
          "https://api.example.com",
          42,
          null,
          "",
        ],
        sessionReplayLcpBudgetMs: "4000",
        sessionReplayLongTaskBudgetMs: "not-a-number",
      }),
    );

    const policy: SessionReplayGatePolicy | null =
      await SessionReplayGateCache.getPolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      });

    expect(policy?.tracePropagationOrigins).toEqual([
      "https://api.example.com",
    ]);

    /*
     * Postgres drivers hand integer columns back as strings in some
     * configurations, so readNumber coerces numeric strings on purpose -
     * and anything that does not parse falls back to OFF.
     */
    expect(policy?.lcpBudgetMs).toBe(4000);
    expect(policy?.longTaskBudgetMs).toBe(0);
  });
});

/*
 * Audit finding read-api-10. The gate used to fall back to
 * OnErrorOrFrustration / 0% / RequireExplicit when a policy column was
 * null, which is exactly the "recorder buffers, nothing uploads"
 * configuration of issue #3527 - and the opposite of the model defaults
 * the settings page shows (Always / 100 / NotRequired). A null column now
 * reads as the model default.
 */
describe("SessionReplayGateCache null-column fallbacks match the model defaults", (): void => {
  beforeEach((): void => {
    jest.clearAllMocks();
    projectFindOneByMock.mockResolvedValue(projectRow());
  });

  it("captureTrigger falls back to Always", async (): Promise<void> => {
    appFindOneByMock.mockResolvedValue(
      appRow({ sessionReplayCaptureTrigger: null }),
    );

    const policy: SessionReplayGatePolicy | null =
      await SessionReplayGateCache.getPolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      });

    expect(policy?.captureTrigger).toBe(SessionReplayCaptureTrigger.Always);
  });

  it("samplePercentage falls back to 100", async (): Promise<void> => {
    appFindOneByMock.mockResolvedValue(
      appRow({ sessionReplaySamplePercentage: null }),
    );

    const policy: SessionReplayGatePolicy | null =
      await SessionReplayGateCache.getPolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      });

    expect(policy?.samplePercentage).toBe(100);
  });

  it("consentMode falls back to NotRequired", async (): Promise<void> => {
    appFindOneByMock.mockResolvedValue(
      appRow({ sessionReplayConsentMode: undefined }),
    );

    const policy: SessionReplayGatePolicy | null =
      await SessionReplayGateCache.getPolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      });

    expect(policy?.consentMode).toBe(SessionReplayConsentMode.NotRequired);
  });

  it("an explicit non-default value is still honoured", async (): Promise<void> => {
    appFindOneByMock.mockResolvedValue(
      appRow({
        sessionReplayCaptureTrigger:
          SessionReplayCaptureTrigger.OnErrorOrFrustration,
        sessionReplaySamplePercentage: 5,
        sessionReplayConsentMode: SessionReplayConsentMode.RequireExplicit,
      }),
    );

    const policy: SessionReplayGatePolicy | null =
      await SessionReplayGateCache.getPolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      });

    expect(policy?.captureTrigger).toBe(
      SessionReplayCaptureTrigger.OnErrorOrFrustration,
    );
    expect(policy?.samplePercentage).toBe(5);
    expect(policy?.consentMode).toBe(SessionReplayConsentMode.RequireExplicit);
  });
});

/*
 * Audit finding ingest-9. getPolicy() answers null for four different
 * causes; resolvePolicy names each so the config endpoint, the validate
 * probe and the health surface can send the customer to the right switch.
 */
describe("SessionReplayGateCache.resolvePolicy names the refusal", (): void => {
  beforeEach((): void => {
    jest.clearAllMocks();
    projectFindOneByMock.mockResolvedValue(projectRow());
  });

  it("a switched-off project is project-not-allowed, even when the app is on", async (): Promise<void> => {
    projectFindOneByMock.mockResolvedValue({ isSessionReplayAllowed: false });
    appFindOneByMock.mockResolvedValue(appRow());

    const resolution: SessionReplayPolicyResolution =
      await SessionReplayGateCache.resolvePolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      });

    expect(resolution.policy).toBeNull();
    expect(resolution.refusal).toBe(
      SessionReplayPolicyRefusal.ProjectNotAllowed,
    );
  });

  it("a switched-off application is application-not-enabled", async (): Promise<void> => {
    appFindOneByMock.mockResolvedValue(
      appRow({ isSessionReplayEnabled: false }),
    );

    const resolution: SessionReplayPolicyResolution =
      await SessionReplayGateCache.resolvePolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      });

    expect(resolution.policy).toBeNull();
    expect(resolution.refusal).toBe(
      SessionReplayPolicyRefusal.ApplicationNotEnabled,
    );
  });

  it("an identifier that matches nothing under a project that does not allow replay is project-not-allowed", async (): Promise<void> => {
    projectFindOneByMock.mockResolvedValue({ isSessionReplayAllowed: false });
    appFindOneByMock.mockResolvedValue(null);

    const resolution: SessionReplayPolicyResolution =
      await SessionReplayGateCache.resolvePolicy({
        projectId: PROJECT_ID,
        appIdentifier: "no-such-app",
      });

    expect(resolution.refusal).toBe(
      SessionReplayPolicyRefusal.ProjectNotAllowed,
    );
  });

  it("a blank identifier is app-identifier-missing without touching Postgres", async (): Promise<void> => {
    const resolution: SessionReplayPolicyResolution =
      await SessionReplayGateCache.resolvePolicy({
        projectId: PROJECT_ID,
        appIdentifier: "   ",
      });

    expect(resolution.refusal).toBe(
      SessionReplayPolicyRefusal.IdentifierMissing,
    );
    expect(projectFindOneByMock).not.toHaveBeenCalled();
  });

  it("a killed project is project-killed and getPolicy still answers null", async (): Promise<void> => {
    isProjectKilledMock.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    appFindOneByMock.mockResolvedValue(appRow());

    const resolution: SessionReplayPolicyResolution =
      await SessionReplayGateCache.resolvePolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      });

    expect(resolution.policy).toBeNull();
    expect(resolution.refusal).toBe(SessionReplayPolicyRefusal.ProjectKilled);

    expect(
      await SessionReplayGateCache.getPolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      }),
    ).toBeNull();
  });

  it("a granted policy carries no refusal", async (): Promise<void> => {
    appFindOneByMock.mockResolvedValue(appRow());

    const resolution: SessionReplayPolicyResolution =
      await SessionReplayGateCache.resolvePolicy({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
      });

    expect(resolution.policy).not.toBeNull();
    expect(resolution.refusal).toBeNull();
  });
});
