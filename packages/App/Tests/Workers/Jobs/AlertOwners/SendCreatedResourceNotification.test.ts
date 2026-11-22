import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Host from "Common/Models/DatabaseModels/Host";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import Email from "Common/Types/Email";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Name from "Common/Types/Name";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Timezone from "Common/Types/Timezone";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";

/*
 * Regression tests for the AlertOwner:SendCreatedResourceEmail cron's
 * per-owner fan-out. The job used to re-run, INSIDE the per-owner loop, three
 * Markdown.convertToHTML conversions that never vary per owner: the alert
 * description, the remediation notes, and the root cause - 3xN marked parses
 * per alert. The perf fix hoists all three to once per alert, just above the
 * owner loop (still inside the per-alert scope). These tests pin:
 *   1. exactly THREE convertToHTML calls per alert regardless of owner count
 *      (the old code did all three once PER OWNER: 9 calls for 3 owners),
 *   2. the vars dictionary each owner receives is byte-identical to what the
 *      old per-owner conversion produced,
 *   3. the timezone-dependent declaredAt var still varies per user,
 *   4. the per-user try/catch still isolates one owner's send failure,
 *   5. the zero-owner continue still converts nothing at all.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to CAPTURE the handler (the same recorder the other
 * App/Tests/Workers/Jobs suites use) and each test drives one full tick.
 * Markdown itself is REAL (spied, not stubbed) so the pinned HTML is the
 * genuine marked output.
 */

type CronHandler = () => Promise<void>;

/*
 * Captured cron handlers, keyed by job name. Must be declared before the job
 * import below so the mock factory closure can see it.
 */
const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
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

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it. Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY - an automock would
 * still require (and type-check) the real file.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findOneById: jest.fn(),
      findCreatedNotificationsDue: jest.fn(),
      takeCreatedNotification: jest.fn(),
      findOwners: jest.fn(),
      getAlertLinkInDashboard: jest.fn(),
      getAlertIdentifiedDate: jest.fn(),
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getOwners: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return {
    __esModule: true,
    default: {
      sendUserNotification: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertFeedService", () => {
  return {
    __esModule: true,
    default: {
      createAlertFeedItem: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/PushNotificationUtil", () => {
  return {
    __esModule: true,
    default: {
      createAlertCreatedNotification: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Utils/WhatsAppTemplateUtil", () => {
  return {
    __esModule: true,
    createWhatsAppMessageFromTemplate: jest.fn(() => {
      return { templateVariables: {} };
    }),
  };
});

/*
 * The notifications on-call pages sent, which the job reads to leave out an
 * owner the alert's page reached already (#7987): held in memory
 * (InMemoryOnCallPages).
 */
jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

import AlertFeedService from "Common/Server/Services/AlertFeedService";
import AlertService from "Common/Server/Services/AlertService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveryService from "Common/Server/Services/OwnerNotificationDeliveryService";
import { OwnerNotificationDeliveryStatus } from "Common/Types/Notification/OwnerNotificationDelivery";
import {
  InMemoryOwnerNotificationDeliveries,
  useInMemoryOwnerNotificationDeliveries,
  usersNamedBy,
} from "Common/Tests/Helpers/InMemoryOwnerNotificationDeliveries";
import UserService from "Common/Server/Services/UserService";
import {
  InMemoryOnCallPages,
  useInMemoryOnCallPages,
} from "Common/Tests/Helpers/InMemoryOnCallPages";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import OwnerNotificationDeliveries from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/AlertOwners/SendCreatedResourceNotification";

interface AlertServiceMock {
  findAllBy: jest.Mock;
  findOneById: jest.Mock;
  findCreatedNotificationsDue: jest.Mock;
  takeCreatedNotification: jest.Mock;
  findOwners: jest.Mock;
  getAlertLinkInDashboard: jest.Mock;
  getAlertIdentifiedDate: jest.Mock;
  countBy: jest.Mock;
}

const alertService: AlertServiceMock =
  AlertService as unknown as AlertServiceMock;
const projectService: { getOwners: jest.Mock } = ProjectService as unknown as {
  getOwners: jest.Mock;
};
const notificationService: { sendUserNotification: jest.Mock } =
  UserNotificationSettingService as unknown as {
    sendUserNotification: jest.Mock;
  };
const feedService: { createAlertFeedItem: jest.Mock } =
  AlertFeedService as unknown as { createAlertFeedItem: jest.Mock };
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const IDENTIFIED_AT: Date = new Date("2026-08-18T09:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const ALERT_ID: ObjectID = new ObjectID("alert-1");
const ALERT_LINK: string = "https://oneuptime.test/dashboard/alert-1";

const MONITOR_ID: ObjectID = new ObjectID("monitor-1");
// Alert.createdCriteriaId is a ShortText column, not an ObjectID relation.
const CRITERIA_ID: string = "criteria-1";
const SERIES_FINGERPRINT: string = "fp-pod-checkout-cpu";

/*
 * The slate the detail rows use. The worker falls back to it when the
 * project's severity row carries no colour of its own, so the badge never
 * renders `border:1px solid ;`.
 */
const DEFAULT_SEVERITY_COLOR: string = "#64748b";

const DESCRIPTION_MARKDOWN: string = "**Latency** is above the SLO";
const REMEDIATION_MARKDOWN: string = "Restart the *ingest* pods";
const ROOT_CAUSE_MARKDOWN: string = "A **bad deploy** saturated the queue";
const DEFAULT_ROOT_CAUSE: string = "No root cause identified for this alert";

function makeAlert(data: {
  description?: string | undefined;
  remediationNotes?: string | undefined;
  rootCause?: string | undefined;
  seriesLabels?: JSONObject | undefined;
  monitorId?: ObjectID | undefined;
  seriesFingerprint?: string | undefined;
  createdCriteriaId?: string | undefined;
  severityColor?: Color | undefined;
  hosts?: Array<Host> | undefined;
  serviceLevelObjectives?: Array<ServiceLevelObjective> | undefined;
}): Alert {
  const alert: Alert = new Alert(ALERT_ID);
  alert.projectId = PROJECT_ID;
  alert.title = "High latency";

  if (data.description !== undefined) {
    alert.description = data.description;
  }

  if (data.remediationNotes !== undefined) {
    alert.remediationNotes = data.remediationNotes;
  }

  if (data.rootCause !== undefined) {
    alert.rootCause = data.rootCause;
  }

  if (data.seriesLabels !== undefined) {
    alert.seriesLabels = data.seriesLabels;
  }

  if (data.monitorId !== undefined) {
    alert.monitorId = data.monitorId;
  }

  if (data.seriesFingerprint !== undefined) {
    alert.seriesFingerprint = data.seriesFingerprint;
  }

  if (data.createdCriteriaId !== undefined) {
    alert.createdCriteriaId = data.createdCriteriaId;
  }

  const project: Project = new Project();
  project.name = "Acme Status";
  alert.project = project;

  const state: AlertState = new AlertState();
  state.name = "Created";
  alert.currentAlertState = state;

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Warning";

  if (data.severityColor !== undefined) {
    severity.color = data.severityColor;
  }

  alert.alertSeverity = severity;

  /*
   * With its id and project: the job reads the alert's affected resources
   * back through AlertService.findAllBy (mocked below to return these rows),
   * and a resource of no known project is not named.
   */
  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.name = "API Monitor";
  monitor.projectId = PROJECT_ID;
  alert.monitor = monitor;

  if (data.hosts !== undefined) {
    alert.hosts = data.hosts;
  }

  if (data.serviceLevelObjectives !== undefined) {
    alert.serviceLevelObjectives = data.serviceLevelObjectives;
  }

  alert.alertNumber = 7;

  return alert;
}

function makeHost(id: string, name: string): Host {
  const host: Host = new Host(new ObjectID(id));
  host.name = name;
  host.projectId = PROJECT_ID;
  return host;
}

function makeSlo(id: string, name: string): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(
    new ObjectID(id),
  );
  slo.name = name;
  slo.projectId = PROJECT_ID;
  return slo;
}

function makeOwner(id: string, timezone?: Timezone | undefined): User {
  const user: User = new User(new ObjectID(id));
  user.name = new Name(`Owner ${id}`);
  user.email = new Email(`${id}@acme.test`);

  if (timezone) {
    user.timezone = timezone;
  }

  return user;
}

// The vars of each sendUserNotification call's email envelope, in call order.
function sentVars(): Array<Dictionary<string>> {
  return notificationService.sendUserNotification.mock.calls.map(
    (args: Array<unknown>) => {
      return (args[0] as { emailEnvelope: EmailEnvelope }).emailEnvelope
        .vars as Dictionary<string>;
    },
  );
}

async function runWorkerTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["AlertOwner:SendCreatedResourceEmail"];

  if (!handler) {
    throw new Error(
      "AlertOwner:SendCreatedResourceEmail did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("AlertOwner:SendCreatedResourceEmail worker", () => {
  let markdownSpy: jest.SpyInstance;
  let deliveries: InMemoryOwnerNotificationDeliveries;
  let pages: InMemoryOnCallPages;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    /*
     * Whom each alert tells is written down before it is taken, and each
     * owner told through it (OwnerNotificationDeliveries, #8199).
     */
    deliveries = useInMemoryOwnerNotificationDeliveries();

    // Nobody was paged, unless a test says so (#7987).
    pages = useInMemoryOnCallPages();

    // Real conversion, spied - call counts are the regression under test.
    markdownSpy = jest.spyOn(Markdown, "convertToHTML");

    alertService.findAllBy.mockResolvedValue([]);
    /*
     * The job's own read answers what findAllBy is set to answer, as when
     * the job read through findAllBy itself: the rows a test sets are the
     * records due, and the relation reads after it.
     */
    alertService.findCreatedNotificationsDue.mockImplementation(
      (args: unknown): Promise<unknown> => {
        return alertService.findAllBy(args);
      },
    );
    alertService.takeCreatedNotification.mockResolvedValue(true);
    alertService.findOwners.mockResolvedValue([]);
    alertService.getAlertLinkInDashboard.mockResolvedValue({
      toString: (): string => {
        return ALERT_LINK;
      },
    });
    alertService.getAlertIdentifiedDate.mockResolvedValue(IDENTIFIED_AT);
    alertService.countBy.mockResolvedValue(new PositiveNumber(1));
    projectService.getOwners.mockResolvedValue([]);
    notificationService.sendUserNotification.mockResolvedValue(undefined);
    feedService.createAlertFeedItem.mockResolvedValue(undefined);
  });

  test("converts description, remediation notes and root cause ONCE per alert for 3 owners - not once per owner", async () => {
    alertService.findAllBy.mockResolvedValue([
      makeAlert({
        description: DESCRIPTION_MARKDOWN,
        remediationNotes: REMEDIATION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
    ]);
    alertService.findOwners.mockResolvedValue([
      makeOwner("user-1"),
      makeOwner("user-2"),
      makeOwner("user-3"),
    ]);

    // What the old per-owner code produced for every owner, byte for byte.
    const expectedDescriptionHtml: string = await Markdown.convertToHTML(
      DESCRIPTION_MARKDOWN,
      MarkdownContentType.Email,
    );
    const expectedRemediationHtml: string =
      (await Markdown.convertToHTML(
        REMEDIATION_MARKDOWN,
        MarkdownContentType.Email,
      )) || "";
    const expectedRootCauseHtml: string =
      (await Markdown.convertToHTML(
        ROOT_CAUSE_MARKDOWN,
        MarkdownContentType.Email,
      )) || "";

    expect(expectedDescriptionHtml).toContain("<strong>Latency</strong>");

    markdownSpy.mockClear();

    await runWorkerTick();

    // THE regression: the old code converted all three once per owner (9 calls).
    expect(markdownSpy).toHaveBeenCalledTimes(3);
    expect(markdownSpy.mock.calls).toEqual([
      [DESCRIPTION_MARKDOWN, MarkdownContentType.Email],
      [REMEDIATION_MARKDOWN, MarkdownContentType.Email],
      [ROOT_CAUSE_MARKDOWN, MarkdownContentType.Email],
    ]);

    expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(3);

    const allVars: Array<Dictionary<string>> = sentVars();

    const expectedVars: Dictionary<string> = {
      alertTitle: "High latency",
      alertNumber: "#7",
      projectName: "Acme Status",
      currentState: "Created",
      alertDescription: expectedDescriptionHtml,
      resourcesAffected: "API Monitor",
      alertSeverity: "Warning",
      declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: IDENTIFIED_AT,
        timezones: [],
      }),
      declaredBy: "OneUptime",
      remediationNotes: expectedRemediationHtml,
      rootCause: expectedRootCauseHtml,
      alertViewLink: ALERT_LINK,
      flapWarning: "",
      monitorName: "",
      severityBadgeText: "Warning",
      severityColor: DEFAULT_SEVERITY_COLOR,
      // The slate fallback already reads on white, so it is its own shade.
      severityTextColor: DEFAULT_SEVERITY_COLOR,
      preheader: "A bad deploy saturated the queue \u00b7 API Monitor",
      isOwner: "true",
    };

    expect(allVars).toEqual([expectedVars, expectedVars, expectedVars]);

    const emailEnvelope: EmailEnvelope = (
      notificationService.sendUserNotification.mock.calls[0]![0] as {
        emailEnvelope: EmailEnvelope;
      }
    ).emailEnvelope;

    expect(emailEnvelope.templateType).toBe(
      EmailTemplateType.AlertOwnerResourceCreated,
    );
    expect(emailEnvelope.subject).toBe("[New Alert #7] - High latency");

    /*
     * The dashboard link: one per owner. The feed entry no longer links to
     * the alert whose feed it is in.
     */
    expect(alertService.getAlertLinkInDashboard).toHaveBeenCalledTimes(3);

    expect(feedService.createAlertFeedItem).toHaveBeenCalledTimes(1);
  });

  /*
   * "Resources Affected" used to be `alert.monitor.name`.
   *
   * A grouped metric monitor raises one alert per breaching series, so a
   * customer's per-pod CPU alert read:
   *
   *   RESOURCES AFFECTED: oneuptime-test - Pod CPU Saturating Container Limit
   *
   * — the monitor's own name, which the subject line and the alert title
   * already carried, and which names the monitor rather than the pod. The
   * pod identity was on the alert row the whole time, under `seriesLabels`,
   * and the dashboard was already rendering it as "Affected Resource".
   */
  describe("resourcesAffected names the series, not the monitor", () => {
    test("a grouped metric alert names the pod that actually breached", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({
          seriesLabels: {
            "resource.k8s.pod.name": "kubernetes-agent-logs-7t88f",
            "resource.k8s.namespace.name": "default",
          },
        }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      const resourcesAffected: string = sentVars()[0]!["resourcesAffected"]!;

      expect(resourcesAffected).toContain("kubernetes-agent-logs-7t88f");
      expect(resourcesAffected).toContain("default");
      expect(resourcesAffected).not.toBe("API Monitor");
    });

    test("an ungrouped monitor still falls back to the monitor name", async () => {
      alertService.findAllBy.mockResolvedValue([makeAlert({})] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]!["resourcesAffected"]).toBe("API Monitor");
    });

    test("empty series labels fall back rather than rendering blank", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({ seriesLabels: {} }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]!["resourcesAffected"]).toBe("API Monitor");
    });

    test("the rest of the alert's Affected Resources card follows the monitor", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({
          hosts: [makeHost("host-1", "web-01")],
          serviceLevelObjectives: [makeSlo("slo-1", "Checkout availability")],
        }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]!["resourcesAffected"]).toBe(
        "API Monitor, web-01, Checkout availability",
      );
      // The monitor is already named, so no separate Monitor row.
      expect(sentVars()[0]!["monitorName"]).toBe("");
    });

    test("a grouped alert names the pod, then the rest, and keeps the Monitor row", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({
          seriesLabels: {
            "resource.k8s.pod.name": "checkout-7d9f-2xk",
            "resource.k8s.namespace.name": "shop",
          },
          hosts: [makeHost("host-1", "web-01")],
        }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]!["resourcesAffected"]).toBe(
        "Pod: checkout-7d9f-2xk | Namespace: shop, web-01",
      );
      expect(sentVars()[0]!["monitorName"]).toBe("API Monitor");
    });

    test("another project's host, linked before the write guard, is not named", async () => {
      const foreignHost: Host = makeHost("host-9", "db-of-another-project");
      foreignHost.projectId = new ObjectID("project-9");

      alertService.findAllBy.mockResolvedValue([
        makeAlert({ hosts: [foreignHost] }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]!["resourcesAffected"]).toBe("API Monitor");
    });

    test("the resources are read as root, inside the alert's project", async () => {
      alertService.findAllBy.mockResolvedValue([makeAlert({})] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      // The first read is the job's own query; the rest are the relation reads.
      const relationReads: Array<{
        query: Record<string, unknown>;
        props: Record<string, unknown>;
      }> = alertService.findAllBy.mock.calls
        .slice(1)
        .map((args: Array<unknown>) => {
          return args[0] as {
            query: Record<string, unknown>;
            props: Record<string, unknown>;
          };
        });

      expect(relationReads.length).toBeGreaterThan(0);

      for (const read of relationReads) {
        expect(read.props).toEqual({ isRoot: true });
        expect(read.query["projectId"]).toBe(PROJECT_ID);
      }
    });

    test("the worker selects seriesLabels, or the column comes back undefined", async () => {
      alertService.findAllBy.mockResolvedValue([]);

      await runWorkerTick();

      const select: Record<string, unknown> = (
        alertService.findAllBy.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }
      ).select;

      expect(select["seriesLabels"]).toBe(true);
    });
  });

  test("the timezone-dependent declaredAt var STAYS per-user while the conversions are still shared", async () => {
    alertService.findAllBy.mockResolvedValue([
      makeAlert({
        description: DESCRIPTION_MARKDOWN,
        remediationNotes: REMEDIATION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
    ]);
    alertService.findOwners.mockResolvedValue([
      makeOwner("user-1"),
      makeOwner("user-2", Timezone.AmericaNew_York),
    ]);

    markdownSpy.mockClear();

    await runWorkerTick();

    expect(markdownSpy).toHaveBeenCalledTimes(3);

    const allVars: Array<Dictionary<string>> = sentVars();

    expect(allVars).toHaveLength(2);
    expect(allVars[1]!["declaredAt"]).toBe(
      OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: IDENTIFIED_AT,
        timezones: [Timezone.AmericaNew_York],
      }),
    );
    expect(allVars[0]!["declaredAt"]).not.toBe(allVars[1]!["declaredAt"]);

    // Every owner-invariant field is still identical across the two owners.
    const invariantFields0: Dictionary<string> = { ...allVars[0]! };
    const invariantFields1: Dictionary<string> = { ...allVars[1]! };
    delete invariantFields0["declaredAt"];
    delete invariantFields1["declaredAt"];

    expect(invariantFields0).toEqual(invariantFields1);
  });

  test("one owner's send failure is still isolated by the per-user try/catch - and conversions still ran only once", async () => {
    alertService.findAllBy.mockResolvedValue([
      makeAlert({
        description: DESCRIPTION_MARKDOWN,
        remediationNotes: REMEDIATION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
    ]);
    alertService.findOwners.mockResolvedValue([
      makeOwner("user-1"),
      makeOwner("user-2"),
      makeOwner("user-3"),
    ]);

    notificationService.sendUserNotification.mockImplementation(
      (args: { userId: ObjectID }) => {
        if (args.userId.toString() === "user-1") {
          return Promise.reject(new Error("smtp connection reset"));
        }
        return Promise.resolve(undefined);
      },
    );

    markdownSpy.mockClear();

    await expect(runWorkerTick()).resolves.toBeUndefined();

    expect(markdownSpy).toHaveBeenCalledTimes(3);

    // All three sends were attempted; the failure only logged.
    expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(3);
    expect(mockedLogger.error).toHaveBeenCalled();

    // Only the two owners whose send succeeded appear in the feed item.
    expect(
      (
        feedService.createAlertFeedItem.mock.calls[0]![0] as {
          moreInformationInMarkdown: string;
        }
      ).moreInformationInMarkdown,
    ).toBe(
      "- Owner user-2\n" +
        "- Owner user-3\n",
    );
  });

  test("an alert with no owners at all converts NOTHING - but is still marked owner-notified", async () => {
    alertService.findAllBy.mockResolvedValue([
      makeAlert({
        description: DESCRIPTION_MARKDOWN,
        remediationNotes: REMEDIATION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
    ]);
    alertService.findOwners.mockResolvedValue([]);
    projectService.getOwners.mockResolvedValue([]);

    markdownSpy.mockClear();

    await runWorkerTick();

    expect(alertService.takeCreatedNotification).toHaveBeenCalledTimes(1);
    expect(markdownSpy).not.toHaveBeenCalled();
    expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
    expect(feedService.createAlertFeedItem).not.toHaveBeenCalled();
  });

  test("empty description/remediation and a missing root cause fall back exactly as the old code did, one conversion each", async () => {
    alertService.findAllBy.mockResolvedValue([makeAlert({})]);
    alertService.findOwners.mockResolvedValue([
      makeOwner("user-1"),
      makeOwner("user-2"),
      makeOwner("user-3"),
    ]);

    // The old code's exact expressions for the three fallback inputs.
    const expectedEmptyHtml: string = await Markdown.convertToHTML(
      "",
      MarkdownContentType.Email,
    );
    const expectedDefaultRootCauseHtml: string =
      (await Markdown.convertToHTML(
        DEFAULT_ROOT_CAUSE,
        MarkdownContentType.Email,
      )) || "";

    markdownSpy.mockClear();

    await runWorkerTick();

    expect(markdownSpy).toHaveBeenCalledTimes(3);
    expect(markdownSpy.mock.calls).toEqual([
      ["", MarkdownContentType.Email],
      ["", MarkdownContentType.Email],
      [DEFAULT_ROOT_CAUSE, MarkdownContentType.Email],
    ]);

    const allVars: Array<Dictionary<string>> = sentVars();

    expect(allVars).toHaveLength(3);

    for (const vars of allVars) {
      expect(vars["alertDescription"]).toBe(expectedEmptyHtml);
      expect(vars["remediationNotes"]).toBe(expectedEmptyHtml || "");
      expect(vars["rootCause"]).toBe(expectedDefaultRootCauseHtml);
    }
  });

  /*
   * The title is user text. Compiled again by the mailer, "{{ ... }}" in it
   * rendered as nothing and a lone "{{" stopped the email being sent.
   */
  test("a title quoting template syntax reaches the subject as written, marked literal", async () => {
    const alert: Alert = makeAlert({});
    alert.title = "Rollout of {{ .Values.image.tag }} stalled";
    alertService.findAllBy.mockResolvedValue([alert]);
    alertService.findOwners.mockResolvedValue([makeOwner("user-1")]);

    await runWorkerTick();

    const emailEnvelope: EmailEnvelope = (
      notificationService.sendUserNotification.mock.calls[0]![0] as {
        emailEnvelope: EmailEnvelope;
      }
    ).emailEnvelope;

    expect(emailEnvelope.isSubjectLiteral).toBe(true);
    expect(emailEnvelope.subject).toBe(
      "[New Alert #7] - Rollout of {{ .Values.image.tag }} stalled",
    );
  });
  /*
   * "IS THIS THE NINETEENTH COPY OF AN EMAIL I ALREADY READ?"
   *
   * A criteria whose recovery threshold sits on top of its firing threshold
   * oscillates. Every oscillation is a new alert row, a new alert number and
   * a new email, and email nineteen was byte-identical to email one - so the
   * reader concluded the product was broken rather than that the monitor was
   * flapping. The identity to count on (monitorId + createdCriteriaId +
   * seriesFingerprint) was on the row and indexed the whole time.
   */
  describe("flap detection", () => {
    function flappingAlert(): Alert {
      return makeAlert({
        rootCause: ROOT_CAUSE_MARKDOWN,
        monitorId: MONITOR_ID,
        createdCriteriaId: CRITERIA_ID,
        seriesFingerprint: SERIES_FINGERPRINT,
      });
    }

    test("19 firings of one condition put the count in the banner", async () => {
      alertService.findAllBy.mockResolvedValue([flappingAlert()] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);
      alertService.countBy.mockResolvedValue(new PositiveNumber(19));

      await runWorkerTick();

      const flapWarning: string = sentVars()[0]!["flapWarning"]!;

      expect(flapWarning).toContain("fired 19 times");
      expect(flapWarning).toContain("last 2 hours");
      expect(flapWarning).toContain("flapping");
    });

    /*
     * The boundary IS the design. A banner that appears on an ordinary alert
     * teaches the reader to ignore it, so two firings in two hours - a busy
     * day - must stay silent and three must not.
     */
    test("two firings stay silent and three do not", async () => {
      alertService.findAllBy.mockResolvedValue([flappingAlert()] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);
      alertService.countBy.mockResolvedValue(new PositiveNumber(2));

      await runWorkerTick();

      expect(sentVars()[0]!["flapWarning"]).toBe("");

      jest.clearAllMocks();
      // Another firing: another alert's owners to tell, not this one's again.
      deliveries = useInMemoryOwnerNotificationDeliveries();
      alertService.findAllBy.mockResolvedValue([flappingAlert()] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);
      alertService.getAlertLinkInDashboard.mockResolvedValue({
        toString: (): string => {
          return ALERT_LINK;
        },
      });
      alertService.getAlertIdentifiedDate.mockResolvedValue(IDENTIFIED_AT);
      alertService.countBy.mockResolvedValue(new PositiveNumber(3));

      await runWorkerTick();

      expect(sentVars()[0]!["flapWarning"]).toContain("fired 3 times");
    });

    /*
     * The banner says "this condition", so the count must be scoped to the
     * condition. Counting on monitorId alone would fold a CPU criteria and a
     * memory criteria on the same pod into one number.
     */
    test("counts on monitor + criteria + series, never on the alert id", async () => {
      alertService.findAllBy.mockResolvedValue([flappingAlert()] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(alertService.countBy).toHaveBeenCalledTimes(1);

      const query: Record<string, unknown> = (
        alertService.countBy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query;

      expect(query["monitorId"]).toBe(MONITOR_ID);
      expect(query["createdCriteriaId"]).toBe(CRITERIA_ID);
      expect(query["seriesFingerprint"]).toBe(SERIES_FINGERPRINT);
      expect(query["createdAt"]).toBeDefined();
      expect(query["alertId"]).toBeUndefined();
      expect(query["_id"]).toBeUndefined();
    });

    test("a criteria alert with no series still counts, on the criteria", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({ monitorId: MONITOR_ID, createdCriteriaId: CRITERIA_ID }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      const query: Record<string, unknown> = (
        alertService.countBy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query;

      expect(query["createdCriteriaId"]).toBe(CRITERIA_ID);
      expect(query["seriesFingerprint"]).toBeUndefined();
    });

    /*
     * The degenerate case the guard exists for. An alert with a monitor but
     * NO condition identity - a manually raised one - would otherwise be
     * counted monitor-wide, and five unrelated conditions firing once each
     * would render as "this condition has fired 5 times".
     */
    test("an alert with no condition identity is not counted at all", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({ monitorId: MONITOR_ID }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);
      alertService.countBy.mockResolvedValue(new PositiveNumber(19));

      await runWorkerTick();

      expect(alertService.countBy).not.toHaveBeenCalled();
      expect(sentVars()[0]!["flapWarning"]).toBe("");
      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);
    });

    test("an alert with no monitor is not counted at all", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({ createdCriteriaId: CRITERIA_ID }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(alertService.countBy).not.toHaveBeenCalled();
      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);
    });

    // The whole point of the try/catch: a banner is never worth an email.
    test("a failing count costs the banner, not the email", async () => {
      alertService.findAllBy.mockResolvedValue([flappingAlert()] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);
      alertService.countBy.mockRejectedValue(new Error("statement timeout"));

      await expect(runWorkerTick()).resolves.toBeUndefined();

      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);
      expect(sentVars()[0]!["flapWarning"]).toBe("");
      expect(mockedLogger.error).toHaveBeenCalled();
    });

    // One indexed COUNT per ALERT, not per owner.
    test("three owners still cost exactly one count", async () => {
      alertService.findAllBy.mockResolvedValue([flappingAlert()] as never);
      alertService.findOwners.mockResolvedValue([
        makeOwner("user-1"),
        makeOwner("user-2"),
        makeOwner("user-3"),
      ]);

      await runWorkerTick();

      expect(alertService.countBy).toHaveBeenCalledTimes(1);
      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(3);
    });

    test("the worker selects the three columns the count needs", async () => {
      alertService.findAllBy.mockResolvedValue([]);

      await runWorkerTick();

      const select: Record<string, unknown> = (
        alertService.findAllBy.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }
      ).select;

      expect(select["monitorId"]).toBe(true);
      expect(select["seriesFingerprint"]).toBe(true);
      expect(select["createdCriteriaId"]).toBe(true);
    });
  });

  describe("severity badge, preheader and unsubscribe link", () => {
    test("the badge carries the severity's OWN colour", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({ severityColor: new Color("#dc2626") }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]!["severityBadgeText"]).toBe("Warning");
      expect(sentVars()[0]!["severityColor"]).toBe("#dc2626");
    });

    /*
     * A severity row with no colour must not produce
     * `border:1px solid ;` in the badge's style attribute.
     */
    test("a colourless severity falls back rather than rendering blank", async () => {
      alertService.findAllBy.mockResolvedValue([makeAlert({})] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]!["severityColor"]).toBe(DEFAULT_SEVERITY_COLOR);
      expect(sentVars()[0]!["severityTextColor"]).toBe(DEFAULT_SEVERITY_COLOR);
      expect(sentVars()[0]!["severityColor"]).not.toBe("");
    });

    /*
     * The badge's name sits on white in the severity's colour, so a pale
     * severity gets the nearest shade of it that reads, while the dot and
     * the outline keep the colour itself.
     */
    test("the badge's name takes a readable shade of a pale severity colour", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({ severityColor: new Color("#FACC15") }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]!["severityColor"]).toBe("#facc15");
      expect(sentVars()[0]!["severityTextColor"]).toBe(
        EmailColorUtil.getColorPair("#facc15")!.textColor,
      );
      expect(sentVars()[0]!["severityTextColor"]).not.toBe("#facc15");
    });

    /*
     * Severity colours are project data and the API takes any string for
     * them. What lands in the badge's style attribute is either a colour
     * EmailColorUtil wrote or the slate fallback - never the raw value.
     */
    test.each([
      "#fff; background-image: url(https://evil.example/t.gif)",
      '#fff" onmouseover="alert(1)',
      "tomato",
    ])(
      "the unusable severity colour %p falls back to slate",
      async (stored: string) => {
        alertService.findAllBy.mockResolvedValue([
          makeAlert({ severityColor: new Color(stored) }),
        ] as never);
        alertService.findOwners.mockResolvedValue([makeOwner("a")]);

        await runWorkerTick();

        expect(sentVars()[0]!["severityColor"]).toBe(DEFAULT_SEVERITY_COLOR);
        expect(sentVars()[0]!["severityTextColor"]).toBe(
          DEFAULT_SEVERITY_COLOR,
        );
        expect(sentVars()[0]).not.toHaveProperty("alertSeverityColor");
        expect(JSON.stringify(sentVars()[0])).not.toContain(stored);
      },
    );

    test("the Severity and Current State rows get their own colour pairs", async () => {
      const alert: Alert = makeAlert({ severityColor: new Color("#dc2626") });
      const state: AlertState = new AlertState();
      state.name = "Identified";
      state.color = new Color("#f97316");
      alert.currentAlertState = state;
      alertService.findAllBy.mockResolvedValue([alert] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]).toMatchObject({
        alertSeverityColor: "#dc2626",
        alertSeverityTextColor:
          EmailColorUtil.getColorPair("#dc2626")!.textColor,
        currentStateColor: "#f97316",
        currentStateTextColor:
          EmailColorUtil.getColorPair("#f97316")!.textColor,
      });

      const select: Record<string, unknown> = (
        alertService.findAllBy.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }
      ).select;

      expect(select["currentAlertState"]).toEqual({ name: true, color: true });
      expect(select["alertSeverity"]).toEqual({ name: true, color: true });
    });

    /*
     * THE INBOX PREVIEW LINE. Before it, thirty-nine rows in the inbox all
     * previewed as "A new alert has been created in the project".
     */
    test("the preheader leads with the root cause and names the resource", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({
          rootCause: ROOT_CAUSE_MARKDOWN,
          seriesLabels: {
            "resource.k8s.pod.name": "kubernetes-agent-logs-7t88f",
          },
        }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      const preheader: string = sentVars()[0]!["preheader"]!;

      expect(preheader).toContain("A bad deploy saturated the queue");
      expect(preheader).toContain("kubernetes-agent-logs-7t88f");
      // Plain text: no client renders markup in the preview line.
      expect(preheader).not.toContain("**");
      expect(preheader).not.toContain("<");
    });

    /*
     * A root cause can quote what a monitored service answered. Its typed
     * markup comes out of the preview line completely - where taking a tag
     * out joins the text either side into another one, that one goes too -
     * and a "<" typed as text stays.
     */
    test("the preheader takes a root cause's typed markup out completely", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({
          rootCause:
            "Response <scr<script>ipt>alert(1)</script> while p99 < 200 ms",
          seriesLabels: {
            "resource.k8s.pod.name": "kubernetes-agent-logs-7t88f",
          },
        }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]!["preheader"]).toBe(
        "Response alert(1) while p99 < 200 ms \u00b7 Pod: kubernetes-agent-logs-7t88f",
      );
    });

    test("the preheader announces a flap and is capped at 160 characters", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({
          rootCause: "x".repeat(400),
          monitorId: MONITOR_ID,
          createdCriteriaId: CRITERIA_ID,
        }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);
      alertService.countBy.mockResolvedValue(new PositiveNumber(19));

      await runWorkerTick();

      expect(sentVars()[0]!["preheader"]!.length).toBe(160);

      alertService.findAllBy.mockResolvedValue([
        makeAlert({
          monitorId: MONITOR_ID,
          createdCriteriaId: CRITERIA_ID,
        }),
      ] as never);
      notificationService.sendUserNotification.mockClear();
      // Another firing: another alert's owners to tell, not this one's again.
      deliveries = useInMemoryOwnerNotificationDeliveries();

      await runWorkerTick();

      expect(sentVars()[0]!["preheader"]).toContain("19 firings in 2h");
    });

    /*
     * An ungrouped monitor's affected resource IS the monitor name, and a
     * Monitor row would print it a second time.
     */
    test("monitorName is suppressed when it duplicates the affected resource", async () => {
      alertService.findAllBy.mockResolvedValue([makeAlert({})] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]!["resourcesAffected"]).toBe("API Monitor");
      expect(sentVars()[0]!["monitorName"]).toBe("");
    });

    test("monitorName is carried when the resource is a series", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({
          seriesLabels: {
            "resource.k8s.pod.name": "kubernetes-agent-logs-7t88f",
          },
        }),
      ] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(sentVars()[0]!["monitorName"]).toBe("API Monitor");
      expect(sentVars()[0]!["resourcesAffected"]).toContain(
        "kubernetes-agent-logs-7t88f",
      );
    });
  });

  /*
   * WHICH ALERTS IT TELLS THEIR OWNERS ABOUT (#7571, #7573): the ones
   * AlertService.findCreatedNotificationsDue reads as of the moment it runs -
   * let go a minute after their create, or held so long that nobody will
   * let them go - each taken first, in one write that matches only while
   * the alert is as it was read (takeCreatedNotification). One another run
   * took, or that was let go meanwhile, is not this run's.
   */
  describe("which alerts it tells their owners about", () => {
    const NOW: Date = new Date("2026-11-15T10:02:00.000Z");
    const OTHER_ALERT_ID: ObjectID = new ObjectID("alert-2");

    function secondAlert(): Alert {
      const alert: Alert = makeAlert({});
      alert._id = OTHER_ALERT_ID.toString();
      alert.title = "Error rate is up";
      return alert;
    }

    // Who was sent what, by alert.
    function sentFor(alertId: ObjectID): Array<string> {
      return notificationService.sendUserNotification.mock.calls
        .filter((args: Array<unknown>): boolean => {
          return (
            (args[0] as { alertId: ObjectID }).alertId.toString() ===
            alertId.toString()
          );
        })
        .map((args: Array<unknown>): string => {
          return (args[0] as { userId: ObjectID }).userId.toString();
        });
    }

    test("reads the alerts due as of the moment it runs, with every column its email needs", async () => {
      jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

      await runWorkerTick();

      expect(alertService.findCreatedNotificationsDue).toHaveBeenCalledTimes(1);

      const read: { now: Date; select: Record<string, unknown> } = alertService
        .findCreatedNotificationsDue.mock.calls[0]![0] as {
        now: Date;
        select: Record<string, unknown>;
      };

      expect(read.now).toBe(NOW);
      expect(read.select).toEqual(
        expect.objectContaining({
          _id: true,
          title: true,
          description: true,
          projectId: true,
          monitorId: true,
          remediationNotes: true,
          rootCause: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
          seriesLabels: true,
          seriesFingerprint: true,
          createdCriteriaId: true,
        }),
      );
    });

    test("writes whom it is to tell, then takes each alert it read, as it read it, before telling anyone", async () => {
      const first: Alert = makeAlert({});
      const second: Alert = secondAlert();
      alertService.findAllBy.mockResolvedValue([first, second] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);

      await runWorkerTick();

      expect(
        alertService.takeCreatedNotification.mock.calls.map(
          (args: Array<unknown>): unknown => {
            return args[0];
          },
        ),
      ).toEqual([first, second]);
      expect(alertService.takeCreatedNotification.mock.calls[0]![0]).toBe(
        first,
      );

      const takenFirst: number =
        alertService.takeCreatedNotification.mock.invocationCallOrder[0]!;

      /*
       * Its owners are read and written down first, so a worker stopped
       * after the take leaves them to be told (#8199) - and nobody is told
       * before the take.
       */
      expect(alertService.findOwners.mock.invocationCallOrder[0]!).toBeLessThan(
        takenFirst,
      );
      expect(
        (
          OwnerNotificationDeliveryService.writeOwnersToTell as unknown as jest.Mock
        ).mock.invocationCallOrder[0]!,
      ).toBeLessThan(takenFirst);
      expect(takenFirst).toBeLessThan(
        notificationService.sendUserNotification.mock.invocationCallOrder[0]!,
      );
      expect(sentFor(ALERT_ID)).toEqual(["a"]);
      expect(sentFor(OTHER_ALERT_ID)).toEqual(["a"]);
    });

    test("tells nobody of an alert it could not take - another run took it, or it was let go meanwhile - and goes on to the next", async () => {
      alertService.findAllBy.mockResolvedValue([
        makeAlert({}),
        secondAlert(),
      ] as never);
      alertService.takeCreatedNotification
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);
      projectService.getOwners.mockResolvedValue([makeOwner("owner-1")]);

      await runWorkerTick();

      expect(sentFor(ALERT_ID)).toEqual([]);
      expect(sentFor(OTHER_ALERT_ID)).toEqual(["a"]);

      /*
       * Its owners were written down before the take, and wait, to be told,
       * for the run that takes it; nothing was sent or written for it.
       */
      expect(alertService.findOwners).toHaveBeenCalledTimes(2);
      expect(deliveries.statusesOf(ALERT_ID)).toEqual({
        ["a"]: OwnerNotificationDeliveryStatus.Pending,
      });
      expect(deliveries.statusesOf(OTHER_ALERT_ID)).toEqual({
        ["a"]: OwnerNotificationDeliveryStatus.Sent,
      });
      expect(feedService.createAlertFeedItem).toHaveBeenCalledTimes(1);
      expect(
        (
          feedService.createAlertFeedItem.mock.calls[0]![0] as {
            alertId: ObjectID;
          }
        ).alertId.toString(),
      ).toBe(OTHER_ALERT_ID.toString());
    });

    test("an alert let go after the run read it is told once, by the run that takes it", async () => {
      alertService.findAllBy.mockResolvedValue([makeAlert({})] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);
      alertService.takeCreatedNotification
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false);

      await runWorkerTick();
      expect(sentFor(ALERT_ID)).toEqual([]);

      await runWorkerTick();
      expect(sentFor(ALERT_ID)).toEqual(["a"]);

      // Taken: a later run that reads it again can take it no more.
      await runWorkerTick();
      expect(sentFor(ALERT_ID)).toEqual(["a"]);
    });

    test("an alert whose take fails is left for the next run, and nothing is sent for it", async () => {
      alertService.findAllBy.mockResolvedValue([makeAlert({})] as never);
      alertService.findOwners.mockResolvedValue([makeOwner("a")]);
      alertService.takeCreatedNotification.mockRejectedValue(
        new Error("The database is away"),
      );

      await expect(runWorkerTick()).rejects.toThrow("The database is away");

      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
      expect(feedService.createAlertFeedItem).not.toHaveBeenCalled();
    });
  });

  /*
   * ONE NOTIFICATION FOR A NEW ALERT, NOT TWO (#7987).
   *
   * A project with one person, its owner, and the "Default on-call policy"
   * the guided setup made: when a monitor opened ALT-1 she was paged
   * ("ACTION REQUIRED: Alert ALT-1 created"), and a minute later sent the
   * owners' "[New Alert ALT-1]" with the same facts - and read the second as
   * a second alert. An owner the alert's on-call page reached already is
   * left out of the owners' notification; everybody else is told as before.
   */
  describe("someone the alert's on-call page reached already", () => {
    const ANA: User = makeOwner("ana");
    const BO: User = makeOwner("bo");
    const CARA: User = makeOwner("cara");

    // A notification of the alert's page to `user`, in `status`.
    function paged(
      user: User,
      status: UserNotificationStatus = UserNotificationStatus.Sent,
    ): void {
      pages.add({
        projectId: PROJECT_ID,
        userId: user.id!,
        triggeredByAlertId: ALERT_ID,
        status: status,
      });
    }

    // Whom the owners' notification was sent to, in order.
    function sentTo(): Array<string> {
      return notificationService.sendUserNotification.mock.calls.map(
        (args: Array<unknown>): string => {
          return (args[0] as { userId: ObjectID }).userId.toString();
        },
      );
    }

    function feedItems(): Array<{
      feedInfoInMarkdown: string;
      moreInformationInMarkdown: string;
    }> {
      return feedService.createAlertFeedItem.mock.calls.map(
        (args: Array<unknown>) => {
          return args[0] as {
            feedInfoInMarkdown: string;
            moreInformationInMarkdown: string;
          };
        },
      );
    }

    beforeEach(() => {
      alertService.findAllBy.mockResolvedValue([makeAlert({})] as never);
    });

    test("the issue's project: its one person, a Project Owner standing in and paged by the default policy, is sent the page alone", async () => {
      alertService.findOwners.mockResolvedValue([]);
      projectService.getOwners.mockResolvedValue([ANA]);
      paged(ANA);

      await runWorkerTick();

      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
      // Nobody was notified, so no entry says the Project Owners were.
      expect(feedService.createAlertFeedItem).not.toHaveBeenCalled();
      // Taken all the same, so it is not read again.
      expect(alertService.takeCreatedNotification).toHaveBeenCalledTimes(1);
      // Never written down: no later run tells her either.
      expect(deliveries.statusesOf(ALERT_ID)).toEqual({});
    });

    test("an owner who is on call, and was paged, is not sent the owners' notification", async () => {
      alertService.findOwners.mockResolvedValue([ANA]);
      paged(ANA);

      await runWorkerTick();

      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
      expect(feedService.createAlertFeedItem).not.toHaveBeenCalled();
      expect(deliveries.statusesOf(ALERT_ID)).toEqual({});
    });

    test("an owner who is only an owner is sent it, as before - whoever else was paged", async () => {
      alertService.findOwners.mockResolvedValue([BO]);
      // The engineer on call, who owns nothing.
      paged(CARA);

      await runWorkerTick();

      expect(sentTo()).toEqual(["bo"]);
      expect(
        (
          notificationService.sendUserNotification.mock.calls[0]![0] as {
            emailEnvelope: EmailEnvelope;
          }
        ).emailEnvelope.subject,
      ).toBe("[New Alert #7] - High latency");
      expect(feedItems()).toEqual([
        expect.objectContaining({
          feedInfoInMarkdown:
            "Owners were notified that this alert was created.",
          moreInformationInMarkdown: "- Owner bo\n",
        }),
      ]);
    });

    test("a Project Owner standing in who was not paged is sent it, as before", async () => {
      alertService.findOwners.mockResolvedValue([]);
      projectService.getOwners.mockResolvedValue([BO]);

      await runWorkerTick();

      expect(sentTo()).toEqual(["bo"]);
      expect(feedItems()).toEqual([
        expect.objectContaining({
          feedInfoInMarkdown:
            "The Project Owners were notified that this alert was created, as it has no owners yet.",
          moreInformationInMarkdown: "- Owner bo\n",
        }),
      ]);
    });

    test("two owners, one of them paged: only the other is told, and the feed says who was left out, and why", async () => {
      alertService.findOwners.mockResolvedValue([ANA, BO]);
      paged(ANA);

      await runWorkerTick();

      expect(sentTo()).toEqual(["bo"]);
      expect(deliveries.statusesOf(ALERT_ID)).toEqual({
        ["bo"]: OwnerNotificationDeliveryStatus.Sent,
      });

      // Never listed among those notified: named apart, with the reason.
      expect(feedItems()).toEqual([
        expect.objectContaining({
          feedInfoInMarkdown:
            "Owners were notified that this alert was created.",
          moreInformationInMarkdown:
            "- Owner bo\n" +
            "\nNot notified again, as the on-call page reached them: Owner ana.\n",
        }),
      ]);
    });

    test.each([
      UserNotificationStatus.Sending,
      UserNotificationStatus.Sent,
      UserNotificationStatus.Acknowledged,
      UserNotificationStatus.PassedOn,
      UserNotificationStatus.NotAnswered,
    ])(
      "a notification of the page that is %s reached them: they are left out",
      async (status: UserNotificationStatus) => {
        alertService.findOwners.mockResolvedValue([ANA, BO]);
        paged(ANA, status);

        await runWorkerTick();

        expect(sentTo()).toEqual(["bo"]);
      },
    );

    test.each([UserNotificationStatus.Error, UserNotificationStatus.Skipped])(
      "a page whose notification is %s did not reach them: they are told, and the feed names them as told",
      async (status: UserNotificationStatus) => {
        alertService.findOwners.mockResolvedValue([ANA, BO]);
        paged(ANA, status);

        await runWorkerTick();

        expect(sentTo()).toEqual(["ana", "bo"]);
        expect(feedItems()[0]!.moreInformationInMarkdown).toBe(
          "- Owner ana\n- Owner bo\n",
        );
      },
    );

    test("a page that has sent nothing yet - held for working hours, or their first rule waits - leaves them to be told", async () => {
      alertService.findOwners.mockResolvedValue([ANA, BO]);
      // Bo's page went out; Ana's is held, and wrote nothing to her timeline.
      paged(BO);

      await runWorkerTick();

      expect(sentTo()).toEqual(["ana"]);
    });

    test("a page about another record - another alert, the incident declared from this one - does not count", async () => {
      alertService.findOwners.mockResolvedValue([ANA]);
      pages.add({
        projectId: PROJECT_ID,
        userId: ANA.id!,
        triggeredByAlertId: new ObjectID("alert-2"),
      });
      pages.add({
        projectId: PROJECT_ID,
        userId: ANA.id!,
        triggeredByIncidentId: new ObjectID("incident-1"),
      });

      await runWorkerTick();

      expect(sentTo()).toEqual(["ana"]);
    });

    test("the read failing tells everybody, as before, and says so", async () => {
      alertService.findOwners.mockResolvedValue([ANA, BO]);
      paged(ANA);
      pages.failWith(new Error("The database is away"));

      await runWorkerTick();

      expect(sentTo()).toEqual(["ana", "bo"]);
      expect(feedItems()[0]!.moreInformationInMarkdown).toBe(
        "- Owner ana\n- Owner bo\n",
      );
      expect(
        mockedLogger.error.mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).startsWith(
            `Could not read whom the on-call page of AlertCreated ${ALERT_ID.toString()} reached`,
          );
        }),
      ).toBe(true);
    });

    test("reads the page once for all the alert's owners, after reading them and before writing them down", async () => {
      alertService.findOwners.mockResolvedValue([ANA, BO, CARA]);

      await runWorkerTick();

      expect(pages.reads).toHaveLength(1);

      const query: Record<string, unknown> = pages.reads[0]!.query as Record<
        string,
        unknown
      >;

      expect(String(query["triggeredByAlertId"])).toBe(ALERT_ID.toString());
      expect(String(query["projectId"])).toBe(PROJECT_ID.toString());

      const read: number = (
        UserOnCallLogTimelineService.findBy as unknown as jest.Mock
      ).mock.invocationCallOrder[0]!;

      expect(alertService.findOwners.mock.invocationCallOrder[0]!).toBeLessThan(
        read,
      );
      expect(read).toBeLessThan(
        (
          OwnerNotificationDeliveryService.writeOwnersToTell as unknown as jest.Mock
        ).mock.invocationCallOrder[0]!,
      );
      expect(read).toBeLessThan(
        alertService.takeCreatedNotification.mock.invocationCallOrder[0]!,
      );
    });

    test("an owner left out is never written down, so a later run that takes up what a stopped one left never tells them", async () => {
      let now: Date = new Date("2026-11-15T10:02:00.000Z");
      jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
        return new Date(now.getTime());
      });

      alertService.findOwners.mockResolvedValue([ANA, BO, CARA]);
      // The owners a later run takes up, read back by their ids.
      jest.spyOn(UserService, "findBy").mockImplementation((async (data: {
        query: JSONObject;
      }) => {
        return usersNamedBy([ANA, BO, CARA], data.query);
      }) as never);
      paged(ANA);
      // The worker is killed as it sets out to tell Cara.
      deliveries.stopAt({ statement: "startTelling", userId: "cara" });

      void runWorkerTick();

      for (
        let turn: number = 0;
        turn < 500 && deliveries.stops() === 0;
        turn++
      ) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      }

      expect(deliveries.stops()).toBe(1);
      expect(sentTo()).toEqual(["bo"]);
      expect(deliveries.statusesOf(ALERT_ID)).toEqual({
        ["bo"]: OwnerNotificationDeliveryStatus.Sent,
        ["cara"]: OwnerNotificationDeliveryStatus.Pending,
      });

      // Started again, minutes later: the alert was taken, and is due no more.
      now = new Date(
        now.getTime() +
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES * 60 * 1000,
      );
      alertService.findAllBy.mockResolvedValue([]);
      alertService.findOneById.mockResolvedValue(makeAlert({}));

      await runWorkerTick();

      expect(sentTo()).toEqual(["bo", "cara"]);

      // The later run's entry names whom the two runs told - never Ana.
      expect(feedItems()).toHaveLength(1);
      expect(feedItems()[0]!.moreInformationInMarkdown).toBe(
        "- Owner bo\n- Owner cara\n",
      );

      now = new Date(now.getTime() + 60 * 60 * 1000);
      await runWorkerTick();

      expect(sentTo()).toEqual(["bo", "cara"]);
    });
  });
});
