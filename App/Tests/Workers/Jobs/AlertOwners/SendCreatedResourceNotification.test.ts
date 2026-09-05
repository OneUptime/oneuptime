import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import Email from "Common/Types/Email";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Timezone from "Common/Types/Timezone";

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
      updateOneById: jest.fn(),
      findOwners: jest.fn(),
      getAlertLinkInDashboard: jest.fn(),
      getAlertIdentifiedDate: jest.fn(),
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

import AlertFeedService from "Common/Server/Services/AlertFeedService";
import AlertService from "Common/Server/Services/AlertService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/AlertOwners/SendCreatedResourceNotification";

interface AlertServiceMock {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  findOwners: jest.Mock;
  getAlertLinkInDashboard: jest.Mock;
  getAlertIdentifiedDate: jest.Mock;
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

const DESCRIPTION_MARKDOWN: string = "**Latency** is above the SLO";
const REMEDIATION_MARKDOWN: string = "Restart the *ingest* pods";
const ROOT_CAUSE_MARKDOWN: string = "A **bad deploy** saturated the queue";
const DEFAULT_ROOT_CAUSE: string = "No root cause identified for this alert";

function makeAlert(data: {
  description?: string | undefined;
  remediationNotes?: string | undefined;
  rootCause?: string | undefined;
  seriesLabels?: JSONObject | undefined;
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

  const project: Project = new Project();
  project.name = "Acme Status";
  alert.project = project;

  const state: AlertState = new AlertState();
  state.name = "Created";
  alert.currentAlertState = state;

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Warning";
  alert.alertSeverity = severity;

  const monitor: Monitor = new Monitor();
  monitor.name = "API Monitor";
  alert.monitor = monitor;

  alert.alertNumber = 7;

  return alert;
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Real conversion, spied - call counts are the regression under test.
    markdownSpy = jest.spyOn(Markdown, "convertToHTML");

    alertService.findAllBy.mockResolvedValue([]);
    alertService.updateOneById.mockResolvedValue(undefined);
    alertService.findOwners.mockResolvedValue([]);
    alertService.getAlertLinkInDashboard.mockResolvedValue({
      toString: (): string => {
        return ALERT_LINK;
      },
    });
    alertService.getAlertIdentifiedDate.mockResolvedValue(IDENTIFIED_AT);
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
     * The dashboard link is NOT part of this fix: one call for the feed text
     * plus one per owner, exactly as before.
     */
    expect(alertService.getAlertLinkInDashboard).toHaveBeenCalledTimes(4);

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
      "**Notified**: Owner user-2 (user-2@acme.test)\n" +
        "**Notified**: Owner user-3 (user-3@acme.test)\n",
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

    expect(alertService.updateOneById).toHaveBeenCalledTimes(1);
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
});
