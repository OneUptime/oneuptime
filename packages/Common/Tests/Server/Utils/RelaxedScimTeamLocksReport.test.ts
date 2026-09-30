import RelaxedScimTeamLocksReport, {
  MAX_IDS_LISTED,
  RelaxedScimTeamLocksSummary,
} from "../../../Server/Utils/RelaxedScimTeamLocksReport";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import FakeEnterpriseModule, {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * Moving an install from the Enterprise image to the Community one keeps its
 * database, so a SCIM configuration with Push Groups on still says so - and
 * the Community Edition relaxes its team locks (it has no SCIM endpoint, so
 * the identity provider that owns those teams cannot reach it). The same
 * happens on an Enterprise install whose license stops covering SCIM: the
 * locks are relaxed until a license is activated. Neither may happen
 * silently:
 *
 *   - a Community Edition process logs, once at boot, which locks it is not
 *     enforcing;
 *   - an Enterprise process watches the license and logs the same report
 *     each time SCIM stops (a license already lapsed at boot included).
 *
 * It never throws, and it reads nothing while the license covers SCIM.
 *
 * Single sign-on is not part of the report: it is part of the Community
 * Edition, and a configured "Require SSO for login" is enforced in every
 * edition, so there is nothing relaxed to report. The report never reads the
 * SSO requirement columns.
 */

const LAPSE_REPORT_PREFIX: string = "OneUptime Enterprise license lapsed:";

// Lets the fire-and-forget report triggered by a license change finish.
const flush: () => Promise<void> = async (): Promise<void> => {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
};

const PROJECT_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "12222222-2222-4222-8222-222222222222",
);

const scim: (projectId: ObjectID) => ProjectSCIM = (
  projectId: ObjectID,
): ProjectSCIM => {
  const model: ProjectSCIM = new ProjectSCIM();
  model.projectId = projectId;
  return model;
};

let scimCount: SpyInstance;
let scimFind: SpyInstance;
let instanceRequiresSso: SpyInstance;
let projectCount: SpyInstance;
let projectFind: SpyInstance;
let statusPageCount: SpyInstance;
let statusPageFind: SpyInstance;
let warn: SpyInstance;
let error: SpyInstance;

const scimQuerySpies: () => Array<SpyInstance> = (): Array<SpyInstance> => {
  return [scimCount, scimFind];
};

// The SSO requirement reads the report used to make; it must make none.
const ssoRequirementSpies: () => Array<SpyInstance> =
  (): Array<SpyInstance> => {
    return [
      instanceRequiresSso,
      projectCount,
      projectFind,
      statusPageCount,
      statusPageFind,
    ];
  };

const loggedWarnings: () => Array<string> = (): Array<string> => {
  return warn.mock.calls
    .map((call: Array<unknown>): unknown => {
      return call[0];
    })
    .filter((message: unknown): message is string => {
      return typeof message === "string";
    });
};

const expectNoSingleSignOnWording: (message: string) => void = (
  message: string,
): void => {
  expect(message).not.toMatch(/\bSSO\b/);
  expect(message).not.toMatch(/single sign-on/i);
  expect(message).not.toContain("sign in with email and password");
  expect(message).not.toContain("reset their password");
};

describe("RelaxedScimTeamLocksReport", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();
    RelaxedScimTeamLocksReport.resetForTests();

    scimCount = getJestSpyOn(ProjectSCIMService, "countBy").mockResolvedValue(
      new PositiveNumber(3),
    );
    scimFind = getJestSpyOn(ProjectSCIMService, "findBy").mockResolvedValue([
      scim(PROJECT_A),
      scim(PROJECT_B),
    ]);
    instanceRequiresSso = getJestSpyOn(
      GlobalConfigService,
      "getRequireSsoForLogin",
    ).mockResolvedValue(true);
    projectCount = getJestSpyOn(ProjectService, "countBy").mockResolvedValue(
      new PositiveNumber(3),
    );
    projectFind = getJestSpyOn(ProjectService, "findBy").mockResolvedValue([]);
    statusPageCount = getJestSpyOn(
      StatusPageService,
      "countBy",
    ).mockResolvedValue(new PositiveNumber(1));
    statusPageFind = getJestSpyOn(
      StatusPageService,
      "findBy",
    ).mockResolvedValue([]);
    warn = getJestSpyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    error = getJestSpyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    RelaxedScimTeamLocksReport.resetForTests();
    jest.restoreAllMocks();
  });

  test.each([false, true])(
    "does nothing on the Enterprise Edition while the license covers SCIM (billing=%p)",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);
      installFakeEnterpriseModule();

      await expect(
        RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce(),
      ).resolves.toBeNull();
      await flush();

      for (const spy of [...scimQuerySpies(), ...ssoRequirementSpies()]) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(warn).not.toHaveBeenCalled();
    },
  );

  test("billing on never reports a lapse, whatever the license says", async () => {
    setTestBillingEnabled(true);
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();
    await flush();

    for (const spy of [...scimQuerySpies(), ...ssoRequirementSpies()]) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  describe("on an Enterprise install whose license lapses", () => {
    const lapseReports: () => Array<string> = (): Array<string> => {
      return loggedWarnings().filter((message: string): boolean => {
        return message.startsWith(LAPSE_REPORT_PREFIX);
      });
    };

    test("a license already lapsed at boot is reported at boot, once", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      await expect(
        RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce(),
      ).resolves.toBeNull();
      await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();
      await flush();

      // Later checks by requests see no new change, so no new report.
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.AuditLogs);
      await flush();

      expect(lapseReports()).toHaveLength(1);

      const message: string = lapseReports()[0]!;

      expect(message).toContain(
        "because SCIM provisioning has stopped until a license that includes it is activated",
      );
      expect(message).toContain(
        `3 SCIM configuration(s) with Push Groups on, whose teams can be edited in OneUptime again (project ids: ${PROJECT_A.toString()}, ${PROJECT_B.toString()} and 1 more)`,
      );
      expect(message).toContain("without a restart");
      expect(message).not.toContain("Community Edition");
      expectNoSingleSignOnWording(message);

      for (const spy of ssoRequirementSpies()) {
        expect(spy).not.toHaveBeenCalled();
      }
    });

    test("a lapse at runtime is reported when it is first noticed, and again after a renewal and a new lapse", async () => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

      await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();
      await flush();
      expect(lapseReports()).toHaveLength(0);

      fake.setSnapshot(createLicenseSnapshotWithStatus("missing"));
      // A request asks, e.g. TeamService through EditionEnforcement.
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
      await flush();
      expect(lapseReports()).toHaveLength(1);

      fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
      await flush();
      expect(lapseReports()).toHaveLength(1);

      fake.setSnapshot(createLicenseSnapshotWithStatus("invalid"));
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.AuditLogs);
      await flush();
      expect(lapseReports()).toHaveLength(2);
    });

    test("a license without SCIM reports the SCIM locks", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: [
            EnterpriseFeature.AuditLogs,
            EnterpriseFeature.TeamCompliance,
          ],
        }),
      });

      await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();
      await flush();

      expect(lapseReports()).toHaveLength(1);

      const message: string = lapseReports()[0]!;

      expect(message).toContain("because SCIM provisioning has stopped");
      expect(message).toContain("SCIM configuration(s) with Push Groups on");
      expectNoSingleSignOnWording(message);
    });

    test("a lapse of audit logging alone reads nothing and reports nothing", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: [EnterpriseFeature.SCIM],
        }),
      });

      await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.AuditLogs);
      await flush();

      for (const spy of [...scimQuerySpies(), ...ssoRequirementSpies()]) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(lapseReports()).toHaveLength(0);
    });

    test("a lapse with no SCIM Push Groups configured reports nothing", async () => {
      scimCount.mockResolvedValue(new PositiveNumber(0));
      scimFind.mockResolvedValue([]);
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();
      await flush();

      expect(scimCount).toHaveBeenCalledTimes(1);
      expect(lapseReports()).toHaveLength(0);
    });

    test("a failed check is logged, never thrown", async () => {
      scimCount.mockRejectedValue(new Error("database unavailable"));
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      await expect(
        RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce(),
      ).resolves.toBeNull();
      await flush();

      expect(error).toHaveBeenCalledWith(
        "OneUptime Enterprise license lapsed: could not check which SCIM Push Groups team locks are no longer enforced.",
      );
      expect(lapseReports()).toHaveLength(0);
    });

    test("an unknown license state is not a lapse", async () => {
      installFakeEnterpriseModule({ snapshot: null });

      await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();
      await flush();

      for (const spy of scimQuerySpies()) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(lapseReports()).toHaveLength(0);
    });

    /*
     * The first boot of an upgraded install whose first-run stamp could not
     * be written: no license, and no known trial start. Not a lapse - and the
     * control below, the same install once the trial is known to be over, is.
     */
    test("no license and an unknown trial start is not a lapse", async () => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("missing", {
          graceEndsAt: undefined,
        }),
      });

      await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();
      await flush();

      for (const spy of scimQuerySpies()) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(lapseReports()).toHaveLength(0);

      fake.setSnapshot(createLicenseSnapshotWithStatus("missing"));
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
      await flush();

      expect(lapseReports()).toHaveLength(1);
    });
  });

  test("on the Community Edition, logs the relaxed SCIM locks once, with the count and ids", async () => {
    const summary: RelaxedScimTeamLocksSummary | null =
      await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();

    expect(summary).toEqual({
      scimConfigurationsWithPushGroups: 3,
      projectIdsWithScimPushGroups: [
        PROJECT_A.toString(),
        PROJECT_B.toString(),
      ],
    });

    expect(warn).toHaveBeenCalledTimes(1);

    const message: string = warn.mock.calls[0]![0] as string;

    expect(message).toContain("Community Edition");
    expect(message).toContain("Enterprise Edition");
    expect(message).toContain(
      `3 SCIM configuration(s) with Push Groups on, whose teams can be edited in OneUptime again (project ids: ${PROJECT_A.toString()}, ${PROJECT_B.toString()} and 1 more)`,
    );
    expect(message).toContain("kept unchanged");
    /*
     * Running the Enterprise image is not enough on its own: an Enterprise
     * install enforces them only while its license (or trial, or grace)
     * covers SCIM. The trial and the grace period are different lengths, and
     * the message names each with its own.
     */
    expect(message).toContain(
      `enforced again when this server runs the Enterprise Edition image with a valid license (or during its ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial, or the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period after a license expires)`,
    );
    expect(message).toContain("14-day trial");
    expect(message).toContain("30-day grace period");
    expect(message).not.toContain("14-day trial or grace period");
    expectNoSingleSignOnWording(message);
  });

  test.each([false, true])(
    "on the Community Edition (billing=%p) it never reads the SSO requirements",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);

      await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();

      for (const spy of ssoRequirementSpies()) {
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );

  test("reads the stored settings as root, with a bounded id list", async () => {
    await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();

    for (const spy of scimQuerySpies()) {
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ props: { isRoot: true } }),
      );
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ query: { enablePushGroups: true } }),
      );
    }

    expect(scimFind).toHaveBeenCalledWith(
      expect.objectContaining({ limit: MAX_IDS_LISTED }),
    );
  });

  test("logs once per process", async () => {
    await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();

    await expect(
      RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce(),
    ).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(scimCount).toHaveBeenCalledTimes(1);
  });

  test("stays quiet when nothing is relaxed", async () => {
    scimCount.mockResolvedValue(new PositiveNumber(0));
    scimFind.mockResolvedValue([]);

    const summary: RelaxedScimTeamLocksSummary | null =
      await RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce();

    expect(summary).toEqual({
      scimConfigurationsWithPushGroups: 0,
      projectIdsWithScimPushGroups: [],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  test("never throws: a failed check is logged and boot carries on", async () => {
    scimFind.mockRejectedValue(new Error("database unavailable"));

    await expect(
      RelaxedScimTeamLocksReport.logRelaxedEnforcementOnce(),
    ).resolves.toBeNull();

    expect(error).toHaveBeenCalledWith(
      "Community Edition: could not check for SCIM Push Groups team locks left over from an Enterprise Edition install.",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  describe("describe()", () => {
    const empty: RelaxedScimTeamLocksSummary = {
      scimConfigurationsWithPushGroups: 0,
      projectIdsWithScimPushGroups: [],
    };

    test("returns null when nothing is relaxed, in either context", () => {
      expect(RelaxedScimTeamLocksReport.describe(empty)).toBeNull();
      expect(
        RelaxedScimTeamLocksReport.describe(empty, {
          reason: "lapsed-license",
          isScimRelaxed: true,
        }),
      ).toBeNull();
    });

    test("the lapsed-license wording names SCIM, only when SCIM stopped", () => {
      const summary: RelaxedScimTeamLocksSummary = {
        scimConfigurationsWithPushGroups: 1,
        projectIdsWithScimPushGroups: ["p"],
      };

      const lapsed: string | null = RelaxedScimTeamLocksReport.describe(
        summary,
        { reason: "lapsed-license", isScimRelaxed: true },
      );

      expect(lapsed).toContain(LAPSE_REPORT_PREFIX);
      expect(lapsed).toContain("because SCIM provisioning has stopped");
      expect(lapsed).toContain(
        "1 SCIM configuration(s) with Push Groups on, whose teams can be edited in OneUptime again (project ids: p)",
      );
      expectNoSingleSignOnWording(lapsed!);

      expect(
        RelaxedScimTeamLocksReport.describe(summary, {
          reason: "lapsed-license",
          isScimRelaxed: false,
        }),
      ).toBeNull();
    });

    test("the Community wording says SCIM is part of the Enterprise Edition", () => {
      const message: string | null = RelaxedScimTeamLocksReport.describe({
        scimConfigurationsWithPushGroups: 2,
        projectIdsWithScimPushGroups: ["a", "b"],
      });

      expect(message).toContain(
        "because SCIM provisioning is part of the OneUptime Enterprise Edition",
      );
      expect(message).toContain("(project ids: a, b)");
      expect(message).not.toContain("and 0 more");
      expectNoSingleSignOnWording(message!);
    });

    test("a count without ids still reads well", () => {
      const message: string | null = RelaxedScimTeamLocksReport.describe({
        scimConfigurationsWithPushGroups: 4,
        projectIdsWithScimPushGroups: [],
      });

      expect(message).toContain(
        "4 SCIM configuration(s) with Push Groups on, whose teams can be edited in OneUptime again.",
      );
    });
  });
});
