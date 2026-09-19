import CommunityEditionSsoReport, {
  MAX_IDS_LISTED_PER_KIND,
  RelaxedEnforcementSummary,
} from "../../../Server/Utils/CommunityEditionSsoReport";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
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
 * database, so projects and status pages that required SSO still say so - and
 * the Community Edition relaxes those requirements (it has no SSO login). The
 * same happens on an Enterprise install whose license lapses: SSO and SCIM
 * stop, and their requirements and locks are relaxed until a license is
 * activated. Neither may happen silently:
 *
 *   - a Community Edition process logs, once at boot, which settings it is
 *     not enforcing;
 *   - an Enterprise process watches the license and logs the same report
 *     each time SSO or SCIM stops (a license already lapsed at boot
 *     included), naming only what stopped.
 *
 * It never throws, and it reads nothing while the license covers SSO and SCIM.
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
const STATUS_PAGE_A: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const project: (id: ObjectID) => Project = (id: ObjectID): Project => {
  const model: Project = new Project();
  model._id = id.toString();
  return model;
};

const statusPage: (id: ObjectID) => StatusPage = (id: ObjectID): StatusPage => {
  const model: StatusPage = new StatusPage();
  model._id = id.toString();
  return model;
};

const scim: (projectId: ObjectID) => ProjectSCIM = (
  projectId: ObjectID,
): ProjectSCIM => {
  const model: ProjectSCIM = new ProjectSCIM();
  model.projectId = projectId;
  return model;
};

let instanceRequiresSso: SpyInstance;
let projectCount: SpyInstance;
let projectFind: SpyInstance;
let statusPageCount: SpyInstance;
let statusPageFind: SpyInstance;
let scimCount: SpyInstance;
let scimFind: SpyInstance;
let warn: SpyInstance;
let error: SpyInstance;

const allQuerySpies: () => Array<SpyInstance> = (): Array<SpyInstance> => {
  return [
    instanceRequiresSso,
    projectCount,
    projectFind,
    statusPageCount,
    statusPageFind,
    scimCount,
    scimFind,
  ];
};

describe("CommunityEditionSsoReport", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();
    CommunityEditionSsoReport.resetForTests();

    instanceRequiresSso = getJestSpyOn(
      GlobalConfigService,
      "getRequireSsoForLogin",
    ).mockResolvedValue(true);
    projectCount = getJestSpyOn(ProjectService, "countBy").mockResolvedValue(
      new PositiveNumber(3),
    );
    projectFind = getJestSpyOn(ProjectService, "findBy").mockResolvedValue([
      project(PROJECT_A),
      project(PROJECT_B),
    ]);
    statusPageCount = getJestSpyOn(
      StatusPageService,
      "countBy",
    ).mockResolvedValue(new PositiveNumber(1));
    statusPageFind = getJestSpyOn(
      StatusPageService,
      "findBy",
    ).mockResolvedValue([statusPage(STATUS_PAGE_A)]);
    scimCount = getJestSpyOn(ProjectSCIMService, "countBy").mockResolvedValue(
      new PositiveNumber(1),
    );
    scimFind = getJestSpyOn(ProjectSCIMService, "findBy").mockResolvedValue([
      scim(PROJECT_B),
    ]);
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
    CommunityEditionSsoReport.resetForTests();
    jest.restoreAllMocks();
  });

  test.each([false, true])(
    "does nothing on the Enterprise Edition while the license covers SSO and SCIM (billing=%p)",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);
      installFakeEnterpriseModule();

      await expect(
        CommunityEditionSsoReport.logRelaxedEnforcementOnce(),
      ).resolves.toBeNull();
      await flush();

      for (const spy of allQuerySpies()) {
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

    await CommunityEditionSsoReport.logRelaxedEnforcementOnce();
    await flush();

    for (const spy of allQuerySpies()) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  describe("on an Enterprise install whose license lapses", () => {
    const lapseReports: () => Array<string> = (): Array<string> => {
      return warn.mock.calls
        .map((call: Array<unknown>): unknown => {
          return call[0];
        })
        .filter((message: unknown): message is string => {
          return (
            typeof message === "string" &&
            message.startsWith(LAPSE_REPORT_PREFIX)
          );
        });
    };

    test("a license already lapsed at boot is reported at boot, once", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      await expect(
        CommunityEditionSsoReport.logRelaxedEnforcementOnce(),
      ).resolves.toBeNull();
      await CommunityEditionSsoReport.logRelaxedEnforcementOnce();
      await flush();

      // Later checks by requests see no new change, so no new report.
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
      await flush();

      expect(lapseReports()).toHaveLength(1);

      const message: string = lapseReports()[0]!;

      expect(message).toContain(
        "because SSO login and SCIM provisioning have stopped until a license that includes them is activated",
      );
      expect(message).toContain('"Require SSO for Login"');
      expect(message).toContain(
        `3 project(s) that require SSO for login (ids: ${PROJECT_A.toString()}, ${PROJECT_B.toString()} and 1 more)`,
      );
      expect(message).toContain(
        `1 SCIM configuration(s) with Push Groups on, whose teams can be edited in OneUptime again (project ids: ${PROJECT_B.toString()})`,
      );
      expect(message).toContain("reset their password");
      expect(message).toContain("without a restart");
      expect(message).not.toContain("Community Edition");
    });

    test("a lapse at runtime is reported when it is first noticed, and again after a renewal and a new lapse", async () => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

      await CommunityEditionSsoReport.logRelaxedEnforcementOnce();
      await flush();
      expect(lapseReports()).toHaveLength(0);

      fake.setSnapshot(createLicenseSnapshotWithStatus("missing"));
      // A request asks, e.g. UserAuthorization through EditionEnforcement.
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
      await flush();
      expect(lapseReports()).toHaveLength(1);

      fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
      await flush();
      expect(lapseReports()).toHaveLength(1);

      fake.setSnapshot(createLicenseSnapshotWithStatus("invalid"));
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
      await flush();
      expect(lapseReports()).toHaveLength(2);
    });

    test("a license without SCIM reports the SCIM locks only, not the SSO requirements", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: [EnterpriseFeature.SSO, EnterpriseFeature.AuditLogs],
        }),
      });

      await CommunityEditionSsoReport.logRelaxedEnforcementOnce();
      await flush();

      expect(lapseReports()).toHaveLength(1);

      const message: string = lapseReports()[0]!;

      expect(message).toContain("because SCIM provisioning has stopped");
      expect(message).toContain("SCIM configuration(s) with Push Groups on");
      expect(message).not.toContain("project(s) that require SSO");
      expect(message).not.toContain("Require SSO for Login");
      expect(message).not.toContain("sign in with email and password");
    });

    test("a lapse of audit logging alone reads nothing and reports nothing", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: [EnterpriseFeature.SSO, EnterpriseFeature.SCIM],
        }),
      });

      await CommunityEditionSsoReport.logRelaxedEnforcementOnce();
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.AuditLogs);
      await flush();

      for (const spy of allQuerySpies()) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(lapseReports()).toHaveLength(0);
    });

    test("a failed check is logged, never thrown", async () => {
      projectCount.mockRejectedValue(new Error("database unavailable"));
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      await expect(
        CommunityEditionSsoReport.logRelaxedEnforcementOnce(),
      ).resolves.toBeNull();
      await flush();

      expect(error).toHaveBeenCalledWith(
        "OneUptime Enterprise license lapsed: could not check which SSO requirements and SCIM team locks are no longer enforced.",
      );
      expect(lapseReports()).toHaveLength(0);
    });

    test("an unknown license state is not a lapse", async () => {
      installFakeEnterpriseModule({ snapshot: null });

      await CommunityEditionSsoReport.logRelaxedEnforcementOnce();
      await flush();

      for (const spy of allQuerySpies()) {
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

      await CommunityEditionSsoReport.logRelaxedEnforcementOnce();
      await flush();

      for (const spy of allQuerySpies()) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(lapseReports()).toHaveLength(0);

      fake.setSnapshot(createLicenseSnapshotWithStatus("missing"));
      EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
      await flush();

      expect(lapseReports()).toHaveLength(1);
    });
  });

  test("on the Community Edition, logs every relaxed setting once, with counts and ids", async () => {
    const summary: RelaxedEnforcementSummary | null =
      await CommunityEditionSsoReport.logRelaxedEnforcementOnce();

    expect(summary).toEqual({
      instanceRequiresSso: true,
      projectsRequiringSso: 3,
      projectIdsRequiringSso: [PROJECT_A.toString(), PROJECT_B.toString()],
      statusPagesRequiringSso: 1,
      statusPageIdsRequiringSso: [STATUS_PAGE_A.toString()],
      scimConfigurationsWithPushGroups: 1,
      projectIdsWithScimPushGroups: [PROJECT_B.toString()],
    });

    expect(warn).toHaveBeenCalledTimes(1);

    const message: string = warn.mock.calls[0]![0] as string;

    expect(message).toContain("Community Edition");
    expect(message).toContain("Enterprise Edition");
    expect(message).toContain('"Require SSO for Login"');
    expect(message).toContain(
      `3 project(s) that require SSO for login (ids: ${PROJECT_A.toString()}, ${PROJECT_B.toString()} and 1 more)`,
    );
    expect(message).toContain(
      `1 private status page(s) that require SSO for login (ids: ${STATUS_PAGE_A.toString()})`,
    );
    expect(message).toContain(
      `1 SCIM configuration(s) with Push Groups on, whose teams can be edited in OneUptime again (project ids: ${PROJECT_B.toString()})`,
    );
    expect(message).toContain("kept unchanged");
    /*
     * Running the Enterprise image is not enough on its own: an Enterprise
     * install enforces them only while its license (or trial, or grace)
     * covers SSO and SCIM.
     */
    expect(message).toContain(
      "enforced again when this server runs the Enterprise Edition image with a valid license (or during its 14-day trial or grace period)",
    );
  });

  test("reads the stored settings as root, with bounded id lists", async () => {
    await CommunityEditionSsoReport.logRelaxedEnforcementOnce();

    for (const spy of [
      projectCount,
      projectFind,
      statusPageCount,
      statusPageFind,
      scimCount,
      scimFind,
    ]) {
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ props: { isRoot: true } }),
      );
    }

    expect(projectCount).toHaveBeenCalledWith(
      expect.objectContaining({ query: { requireSsoForLogin: true } }),
    );
    expect(statusPageCount).toHaveBeenCalledWith(
      expect.objectContaining({ query: { requireSsoForLogin: true } }),
    );
    expect(scimCount).toHaveBeenCalledWith(
      expect.objectContaining({ query: { enablePushGroups: true } }),
    );

    for (const spy of [projectFind, statusPageFind, scimFind]) {
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ limit: MAX_IDS_LISTED_PER_KIND }),
      );
    }
  });

  test("logs once per process", async () => {
    await CommunityEditionSsoReport.logRelaxedEnforcementOnce();

    await expect(
      CommunityEditionSsoReport.logRelaxedEnforcementOnce(),
    ).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(projectCount).toHaveBeenCalledTimes(1);
  });

  test("stays quiet when nothing is relaxed", async () => {
    instanceRequiresSso.mockResolvedValue(false);
    projectCount.mockResolvedValue(new PositiveNumber(0));
    projectFind.mockResolvedValue([]);
    statusPageCount.mockResolvedValue(new PositiveNumber(0));
    statusPageFind.mockResolvedValue([]);
    scimCount.mockResolvedValue(new PositiveNumber(0));
    scimFind.mockResolvedValue([]);

    const summary: RelaxedEnforcementSummary | null =
      await CommunityEditionSsoReport.logRelaxedEnforcementOnce();

    expect(summary?.projectsRequiringSso).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  test("never throws: a failed check is logged and boot carries on", async () => {
    projectCount.mockRejectedValue(new Error("database unavailable"));

    await expect(
      CommunityEditionSsoReport.logRelaxedEnforcementOnce(),
    ).resolves.toBeNull();

    expect(error).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  describe("describe()", () => {
    const empty: RelaxedEnforcementSummary = {
      instanceRequiresSso: false,
      projectsRequiringSso: 0,
      projectIdsRequiringSso: [],
      statusPagesRequiringSso: 0,
      statusPageIdsRequiringSso: [],
      scimConfigurationsWithPushGroups: 0,
      projectIdsWithScimPushGroups: [],
    };

    test("returns null when nothing is relaxed", () => {
      expect(CommunityEditionSsoReport.describe(empty)).toBeNull();
    });

    test("names only what is relaxed", () => {
      const message: string | null = CommunityEditionSsoReport.describe({
        ...empty,
        statusPagesRequiringSso: 2,
        statusPageIdsRequiringSso: ["a", "b"],
      });

      expect(message).toContain(
        "2 private status page(s) that require SSO for login (ids: a, b)",
      );
      expect(message).not.toContain("project(s) that require SSO");
      expect(message).not.toContain("Require SSO for Login");
      expect(message).not.toContain("SCIM configuration(s)");
    });

    test("the lapsed-license wording names only what stopped", () => {
      const summary: RelaxedEnforcementSummary = {
        ...empty,
        instanceRequiresSso: true,
        scimConfigurationsWithPushGroups: 1,
        projectIdsWithScimPushGroups: ["p"],
      };

      const ssoOnly: string | null = CommunityEditionSsoReport.describe(
        summary,
        { reason: "lapsed-license", isSsoRelaxed: true, isScimRelaxed: false },
      );

      expect(ssoOnly).toContain(LAPSE_REPORT_PREFIX);
      expect(ssoOnly).toContain("because SSO login has stopped");
      expect(ssoOnly).toContain('"Require SSO for Login"');
      expect(ssoOnly).not.toContain("SCIM configuration(s)");

      expect(
        CommunityEditionSsoReport.describe(
          { ...empty, instanceRequiresSso: true },
          {
            reason: "lapsed-license",
            isSsoRelaxed: false,
            isScimRelaxed: true,
          },
        ),
      ).toBeNull();
    });

    test("a count without ids still reads well", () => {
      const message: string | null = CommunityEditionSsoReport.describe({
        ...empty,
        projectsRequiringSso: 4,
      });

      expect(message).toContain("4 project(s) that require SSO for login.");
    });
  });
});
