import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { Blue500 } from "Common/Types/BrandColors";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * WHAT THE RESOLVED ALERT EMAIL SAYS.
 *
 * Twenty of the thirty-nine emails one flapping Kubernetes monitor sent were
 * state changes, and every one of them was content-free:
 *
 *   - it carried NO root cause, so a reader could not tell a real recovery
 *     from a monitor oscillating around its threshold, even though
 *     AlertStateTimeline.rootCause held the recovering criteria's reading the
 *     whole time and the worker already had the row in hand;
 *   - "Resources Affected" was the MONITOR's name - the fix the firing email
 *     already had (seriesLabels -> SeriesLabelDisplay) was simply never
 *     applied here, so a fire and its resolve named different things;
 *   - it previewed in the inbox as "Alert state has changed", identically for
 *     all twenty.
 *
 * The companion suite SendStateChangeNotification.test.ts pins this job's
 * QUERY SHAPE and per-owner fan-out. This one pins the CONTENT of the email
 * it produces, and is a separate file so the two sets of fixtures do not have
 * to agree.
 */

type CronHandler = () => Promise<void>;

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

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it. Replaced with a factory, not an
 * automock, which would still require the real file.
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

/*
 * Markdown is mocked with a deterministic transform so an assertion can name
 * exactly which string was converted and where its output landed.
 */
jest.mock("Common/Server/Types/Markdown", () => {
  return {
    __esModule: true,
    MarkdownContentType: {
      Docs: 0,
      Blog: 1,
      Email: 2,
      BlogValidation: 3,
    },
    default: {
      convertToHTML: jest.fn((markdown: string) => {
        return Promise.resolve(`<p data-md>${markdown}</p>`);
      }),
    },
  };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findOwners: jest.fn(),
      getAlertLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertStateTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertStateService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
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

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      getUserMarkdownString: jest.fn(),
    },
  };
});

import AlertFeedService from "Common/Server/Services/AlertFeedService";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import AlertStateTimelineService from "Common/Server/Services/AlertStateTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserService from "Common/Server/Services/UserService";
import Markdown from "Common/Server/Types/Markdown";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/AlertOwners/SendStateChangeNotification";

const alertService: {
  findOneById: jest.Mock;
  findOwners: jest.Mock;
  getAlertLinkInDashboard: jest.Mock;
} = AlertService as never;
const timelineService: {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  findOneBy: jest.Mock;
} = AlertStateTimelineService as never;
const stateService: { findOneById: jest.Mock } = AlertStateService as never;
const projectService: { getOwners: jest.Mock } = ProjectService as never;
const notificationService: { sendUserNotification: jest.Mock } =
  UserNotificationSettingService as never;
const feedService: { createAlertFeedItem: jest.Mock } =
  AlertFeedService as never;
const userService: { getUserMarkdownString: jest.Mock } = UserService as never;
const markdownMock: { convertToHTML: jest.Mock } = Markdown as never;

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const ALERT_ID: ObjectID = new ObjectID("alert-1");
const TIMELINE_ID: ObjectID = new ObjectID("timeline-1");
const ALERT_LINK: string = "https://oneuptime.test/dashboard/alert-1";

const RECOVERY_ROOT_CAUSE: string =
  "Alert autoresolved because autoresolve is set to true in monitor criteria. " +
  "(used_cpu / limit_cpu) * 100 peaked at 24.92 % which is less than 81 %.";

function makeTimeline(data: {
  rootCause?: string | undefined;
}): AlertStateTimeline {
  const timeline: AlertStateTimeline = new AlertStateTimeline();
  timeline.id = TIMELINE_ID;
  timeline.alertId = ALERT_ID;
  timeline.projectId = PROJECT_ID;
  timeline.createdAt = new Date("2026-08-18T10:00:00.000Z");

  if (data.rootCause !== undefined) {
    timeline.rootCause = data.rootCause;
  }

  const project: Project = new Project();
  project.name = "Prod Project";
  timeline.project = project;

  const state: AlertState = new AlertState();
  state.name = "Resolved";
  state.color = Blue500;
  timeline.alertState = state;

  return timeline;
}

function makeAlert(data: { seriesLabels?: JSONObject | undefined }): Alert {
  const alert: Alert = new Alert();
  alert.id = ALERT_ID;
  alert.projectId = PROJECT_ID;
  alert.title = "Pod CPU Saturating Container Limit";
  alert.description = "CPU above 90% of the limit";
  alert.alertNumber = 113;
  alert.alertNumberWithPrefix = "ALT-113";

  if (data.seriesLabels !== undefined) {
    alert.seriesLabels = data.seriesLabels;
  }

  const monitor: Monitor = new Monitor();
  monitor.name = "oneuptime-test - Pod CPU Saturating Container Limit";
  alert.monitor = monitor;

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Warning";
  alert.alertSeverity = severity;

  return alert;
}

function makeOwner(): User {
  const user: User = new User();
  user.id = new ObjectID("user-1");
  return user;
}

function firstVars(): Dictionary<string> {
  return (
    notificationService.sendUserNotification.mock.calls[0]![0] as {
      emailEnvelope: { vars: Dictionary<string> };
    }
  ).emailEnvelope.vars;
}

async function runWorkerTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["AlertOwner:SendStateChangeEmail"];

  if (!handler) {
    throw new Error(
      "AlertOwner:SendStateChangeEmail did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("AlertOwner:SendStateChangeEmail email content", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    markdownMock.convertToHTML.mockImplementation((markdown: string) => {
      return Promise.resolve(`<p data-md>${markdown}</p>`);
    });

    timelineService.findAllBy.mockResolvedValue([]);
    timelineService.updateOneById.mockResolvedValue(undefined);
    timelineService.findOneBy.mockResolvedValue(null);
    stateService.findOneById.mockResolvedValue(null);
    alertService.findOneById.mockResolvedValue(null);
    alertService.findOwners.mockResolvedValue([makeOwner()]);
    alertService.getAlertLinkInDashboard.mockResolvedValue({
      toString: (): string => {
        return ALERT_LINK;
      },
    });
    projectService.getOwners.mockResolvedValue([]);
    notificationService.sendUserNotification.mockResolvedValue(undefined);
    feedService.createAlertFeedItem.mockResolvedValue(undefined);
    userService.getUserMarkdownString.mockResolvedValue("owner");
  });

  describe("the recovery reading reaches the email", () => {
    test("a timeline row's rootCause is converted and shipped", async () => {
      timelineService.findAllBy.mockResolvedValue([
        makeTimeline({ rootCause: RECOVERY_ROOT_CAUSE }),
      ]);
      alertService.findOneById.mockResolvedValue(makeAlert({}));

      await runWorkerTick();

      /*
       * TWO conversions per ROW when a root cause is present - the
       * description first, then the root cause - and the second one's output
       * is what lands in the email.
       */
      expect(markdownMock.convertToHTML).toHaveBeenCalledTimes(2);
      expect(firstVars()["stateChangeRootCause"]).toBe(
        `<p data-md>${RECOVERY_ROOT_CAUSE}</p>`,
      );
      // The number a reader actually wants: what did it recover TO.
      expect(firstVars()["stateChangeRootCause"]).toContain("24.92");
    });

    /*
     * The empty-labelled-row failure mode. A manual state change has no root
     * cause, and the var must be present-and-empty so the template's guard
     * suppresses the whole row instead of rendering a bordered blank.
     */
    test("a row with no rootCause yields a present, empty var", async () => {
      timelineService.findAllBy.mockResolvedValue([makeTimeline({})]);
      alertService.findOneById.mockResolvedValue(makeAlert({}));

      await runWorkerTick();

      expect(markdownMock.convertToHTML).toHaveBeenCalledTimes(1);
      expect(firstVars()).toHaveProperty("stateChangeRootCause");
      expect(firstVars()["stateChangeRootCause"]).toBe("");
    });

    test("the worker asks the timeline query for rootCause", async () => {
      await runWorkerTick();

      const select: Record<string, unknown> = (
        timelineService.findAllBy.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }
      ).select;

      expect(select["rootCause"]).toBe(true);
    });

    // Once per ROW, not once per owner - three owners, still two conversions.
    test("the conversion is per row, not per owner", async () => {
      timelineService.findAllBy.mockResolvedValue([
        makeTimeline({ rootCause: RECOVERY_ROOT_CAUSE }),
      ]);
      alertService.findOneById.mockResolvedValue(makeAlert({}));
      alertService.findOwners.mockResolvedValue([
        makeOwner(),
        makeOwner(),
        makeOwner(),
      ]);

      await runWorkerTick();

      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(3);
      expect(markdownMock.convertToHTML).toHaveBeenCalledTimes(2);
    });
  });

  describe("the resolution names the same thing the firing named", () => {
    test("a grouped alert names the pod, not the monitor", async () => {
      timelineService.findAllBy.mockResolvedValue([makeTimeline({})]);
      alertService.findOneById.mockResolvedValue(
        makeAlert({
          seriesLabels: {
            "resource.k8s.pod.name": "kubernetes-agent-logs-7t88f",
            "resource.k8s.namespace.name": "oneuptime",
          },
        }),
      );

      await runWorkerTick();

      const resourcesAffected: string = firstVars()["resourcesAffected"]!;

      expect(resourcesAffected).toContain("kubernetes-agent-logs-7t88f");
      expect(resourcesAffected).not.toContain(
        "oneuptime-test - Pod CPU Saturating Container Limit",
      );
    });

    test("an ungrouped alert still falls back to the monitor name", async () => {
      timelineService.findAllBy.mockResolvedValue([makeTimeline({})]);
      alertService.findOneById.mockResolvedValue(makeAlert({}));

      await runWorkerTick();

      expect(firstVars()["resourcesAffected"]).toBe(
        "oneuptime-test - Pod CPU Saturating Container Limit",
      );
    });

    test("the worker asks the alert query for seriesLabels", async () => {
      timelineService.findAllBy.mockResolvedValue([makeTimeline({})]);
      alertService.findOneById.mockResolvedValue(makeAlert({}));

      await runWorkerTick();

      const select: Record<string, unknown> = (
        alertService.findOneById.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }
      ).select;

      expect(select["seriesLabels"]).toBe(true);
    });
  });

  describe("the inbox preview line", () => {
    test("names the new state and the resource instead of boilerplate", async () => {
      timelineService.findAllBy.mockResolvedValue([makeTimeline({})]);
      alertService.findOneById.mockResolvedValue(
        makeAlert({
          seriesLabels: {
            "resource.k8s.pod.name": "kubernetes-agent-logs-7t88f",
          },
        }),
      );

      await runWorkerTick();

      const preheader: string = firstVars()["preheader"]!;

      expect(preheader).toContain("Resolved");
      expect(preheader).toContain("kubernetes-agent-logs-7t88f");
      expect(preheader).not.toContain("Alert state has changed");
      expect(preheader.length).toBeLessThanOrEqual(160);
    });
  });
});
