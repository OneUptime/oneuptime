import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { Green } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import Timezone from "Common/Types/Timezone";

/*
 * Regression tests for the MonitorOwner:SendStatusChangeEmail cron's per-owner
 * fan-out. The job used to re-run, INSIDE the per-owner loop, three values
 * that never vary per owner: Markdown.convertToHTML(monitor.description),
 * Markdown.convertToHTML(timeline.rootCause), and the awaited
 * MonitorService.getMonitorLinkInDashboard call - N marked parses and N link
 * builds per status change. The perf fix hoists all three to once per status
 * timeline (per timeline, NOT per tick: rootCause varies per timeline row).
 * These tests pin:
 *   1. exactly TWO convertToHTML calls (description + rootCause) and ONE
 *      getMonitorLinkInDashboard call per timeline regardless of owner count
 *      (the old code did each once PER OWNER),
 *   2. the vars dictionary each owner receives is byte-identical to what the
 *      old per-owner computation produced,
 *   3. two timelines with different root causes each get their OWN rootCause
 *      conversion - the hoist is per timeline, never per tick,
 *   4. the timezone-dependent statusChangedAt var still varies per user,
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

jest.mock("Common/Server/Services/MonitorStatusTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOwners: jest.fn(),
      getMonitorLinkInDashboard: jest.fn(),
      getMonitorDestinationInfo: jest.fn(),
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

jest.mock("Common/Server/Utils/PushNotificationUtil", () => {
  return {
    __esModule: true,
    default: {
      createMonitorStatusChangedNotification: jest.fn(() => {
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

import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/MonitorOwners/SendStatusChangeNotification";

interface TimelineServiceMock {
  findAllBy: jest.Mock;
  findOneBy: jest.Mock;
  updateOneById: jest.Mock;
}

interface MonitorServiceMock {
  findOwners: jest.Mock;
  getMonitorLinkInDashboard: jest.Mock;
  getMonitorDestinationInfo: jest.Mock;
}

const timelineService: TimelineServiceMock =
  MonitorStatusTimelineService as unknown as TimelineServiceMock;
const monitorStatusService: { findOneById: jest.Mock } =
  MonitorStatusService as unknown as { findOneById: jest.Mock };
const monitorService: MonitorServiceMock =
  MonitorService as unknown as MonitorServiceMock;
const projectService: { getOwners: jest.Mock } = ProjectService as unknown as {
  getOwners: jest.Mock;
};
const notificationService: { sendUserNotification: jest.Mock } =
  UserNotificationSettingService as unknown as {
    sendUserNotification: jest.Mock;
  };

const CHANGED_AT: Date = new Date("2026-08-18T09:30:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const MONITOR_ID: ObjectID = new ObjectID("monitor-1");
const MONITOR_LINK: string = "https://oneuptime.test/dashboard/monitor-1";

const DESCRIPTION_MARKDOWN: string = "Checks the **public API** every minute";
const ROOT_CAUSE_MARKDOWN: string = "Upstream **database** is unreachable";

const DESTINATION_INFO: {
  monitorDestination: string;
  requestType: string;
  monitorType: string;
} = {
  monitorDestination: "https://api.acme.test/health",
  requestType: "GET",
  monitorType: "Website",
};

function makeTimeline(data: {
  id: string;
  description?: string | undefined;
  rootCause?: string | undefined;
}): MonitorStatusTimeline {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline(
    new ObjectID(data.id),
  );
  timeline.projectId = PROJECT_ID;
  timeline.createdAt = CHANGED_AT;
  timeline.startsAt = CHANGED_AT;
  timeline.monitorId = MONITOR_ID;

  const project: Project = new Project();
  project.name = "Acme Status";
  timeline.project = project;

  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.name = "API Monitor";

  if (data.description !== undefined) {
    monitor.description = data.description;
  }

  timeline.monitor = monitor;

  const status: MonitorStatus = new MonitorStatus();
  status.name = "Operational";
  status.color = Green;
  timeline.monitorStatus = status;

  if (data.rootCause !== undefined) {
    timeline.rootCause = data.rootCause;
  }

  return timeline;
}

function makeOwner(id: string, timezone?: Timezone | undefined): User {
  const user: User = new User(new ObjectID(id));

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
    mockCapturedJobs["MonitorOwner:SendStatusChangeEmail"];

  if (!handler) {
    throw new Error(
      "MonitorOwner:SendStatusChangeEmail did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("MonitorOwner:SendStatusChangeEmail worker", () => {
  let markdownSpy: jest.SpyInstance;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Real conversion, spied - call counts are the regression under test.
    markdownSpy = jest.spyOn(Markdown, "convertToHTML");

    timelineService.findAllBy.mockResolvedValue([]);
    timelineService.findOneBy.mockResolvedValue(null);
    timelineService.updateOneById.mockResolvedValue(undefined);
    monitorStatusService.findOneById.mockResolvedValue(null);
    monitorService.findOwners.mockResolvedValue([]);
    monitorService.getMonitorLinkInDashboard.mockResolvedValue({
      toString: (): string => {
        return MONITOR_LINK;
      },
    });
    monitorService.getMonitorDestinationInfo.mockReturnValue(DESTINATION_INFO);
    projectService.getOwners.mockResolvedValue([]);
    notificationService.sendUserNotification.mockResolvedValue(undefined);
  });

  test("converts description and rootCause ONCE per timeline for 3 owners - and builds the dashboard link once, not per owner", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({
        id: "timeline-1",
        description: DESCRIPTION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
    ]);
    monitorService.findOwners.mockResolvedValue([
      makeOwner("user-1"),
      makeOwner("user-2"),
      makeOwner("user-3"),
    ]);

    // What the old per-owner code produced for every owner, byte for byte.
    const expectedDescriptionHtml: string = await Markdown.convertToHTML(
      DESCRIPTION_MARKDOWN,
      MarkdownContentType.Email,
    );
    const expectedRootCauseHtml: string = await Markdown.convertToHTML(
      ROOT_CAUSE_MARKDOWN,
      MarkdownContentType.Email,
    );

    expect(expectedRootCauseHtml).toContain("<strong>database</strong>");

    markdownSpy.mockClear();

    await runWorkerTick();

    /*
     * THE regression: the old code converted BOTH values once per owner
     * (6 calls here) and awaited the dashboard link once per owner (3 calls).
     */
    expect(markdownSpy).toHaveBeenCalledTimes(2);
    expect(markdownSpy).toHaveBeenNthCalledWith(
      1,
      DESCRIPTION_MARKDOWN,
      MarkdownContentType.Email,
    );
    expect(markdownSpy).toHaveBeenNthCalledWith(
      2,
      ROOT_CAUSE_MARKDOWN,
      MarkdownContentType.Email,
    );
    expect(monitorService.getMonitorLinkInDashboard).toHaveBeenCalledTimes(1);

    expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(3);

    const allVars: Array<Dictionary<string>> = sentVars();

    const expectedVars: Dictionary<string> = {
      monitorName: "API Monitor",
      projectName: "Acme Status",
      currentStatus: "Operational",
      currentStatusColor: Green.toString(),
      previousStatus: "",
      previousStatusColor: "#94a3b8",
      previousStatusDurationText: "",
      monitorDescription: expectedDescriptionHtml,
      statusChangedAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: CHANGED_AT,
        timezones: [],
      }),
      monitorViewLink: MONITOR_LINK,
      rootCause: expectedRootCauseHtml,
      monitorDestination: DESTINATION_INFO.monitorDestination,
      requestType: DESTINATION_INFO.requestType,
      monitorType: DESTINATION_INFO.monitorType,
      isOwner: "true",
    };

    expect(allVars).toEqual([expectedVars, expectedVars, expectedVars]);

    const emailEnvelope: EmailEnvelope = (
      notificationService.sendUserNotification.mock.calls[0]![0] as {
        emailEnvelope: EmailEnvelope;
      }
    ).emailEnvelope;

    expect(emailEnvelope.templateType).toBe(
      EmailTemplateType.MonitorOwnerStatusChanged,
    );
    expect(emailEnvelope.subject).toBe("[Operational Monitor] API Monitor");
  });

  test("two timelines with different root causes each get their OWN conversion - the hoist is per timeline, not per tick", async () => {
    const otherRootCause: string = "A **deploy** rolled back";

    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({
        id: "timeline-1",
        description: DESCRIPTION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
      makeTimeline({
        id: "timeline-2",
        description: DESCRIPTION_MARKDOWN,
        rootCause: otherRootCause,
      }),
    ]);
    monitorService.findOwners.mockResolvedValue([
      makeOwner("user-1"),
      makeOwner("user-2"),
    ]);

    const expectedFirstRootCauseHtml: string = await Markdown.convertToHTML(
      ROOT_CAUSE_MARKDOWN,
      MarkdownContentType.Email,
    );
    const expectedSecondRootCauseHtml: string = await Markdown.convertToHTML(
      otherRootCause,
      MarkdownContentType.Email,
    );

    markdownSpy.mockClear();

    await runWorkerTick();

    // 2 timelines x (1 description + 1 rootCause), independent of owner count.
    expect(markdownSpy).toHaveBeenCalledTimes(4);
    expect(markdownSpy.mock.calls).toEqual([
      [DESCRIPTION_MARKDOWN, MarkdownContentType.Email],
      [ROOT_CAUSE_MARKDOWN, MarkdownContentType.Email],
      [DESCRIPTION_MARKDOWN, MarkdownContentType.Email],
      [otherRootCause, MarkdownContentType.Email],
    ]);
    expect(monitorService.getMonitorLinkInDashboard).toHaveBeenCalledTimes(2);

    const allVars: Array<Dictionary<string>> = sentVars();

    // 2 owners per timeline, first timeline's sends first.
    expect(allVars).toHaveLength(4);
    expect(allVars[0]!["rootCause"]).toBe(expectedFirstRootCauseHtml);
    expect(allVars[1]!["rootCause"]).toBe(expectedFirstRootCauseHtml);
    expect(allVars[2]!["rootCause"]).toBe(expectedSecondRootCauseHtml);
    expect(allVars[3]!["rootCause"]).toBe(expectedSecondRootCauseHtml);
  });

  test("the timezone-dependent statusChangedAt var STAYS per-user while the conversions are still shared", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({
        id: "timeline-1",
        description: DESCRIPTION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
    ]);
    monitorService.findOwners.mockResolvedValue([
      makeOwner("user-1"),
      makeOwner("user-2", Timezone.AmericaNew_York),
    ]);

    markdownSpy.mockClear();

    await runWorkerTick();

    expect(markdownSpy).toHaveBeenCalledTimes(2);

    const allVars: Array<Dictionary<string>> = sentVars();

    expect(allVars).toHaveLength(2);
    expect(allVars[1]!["statusChangedAt"]).toBe(
      OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: CHANGED_AT,
        timezones: [Timezone.AmericaNew_York],
      }),
    );
    expect(allVars[0]!["statusChangedAt"]).not.toBe(
      allVars[1]!["statusChangedAt"],
    );

    // Every owner-invariant field is still identical across the two owners.
    const invariantFields0: Dictionary<string> = { ...allVars[0]! };
    const invariantFields1: Dictionary<string> = { ...allVars[1]! };
    delete invariantFields0["statusChangedAt"];
    delete invariantFields1["statusChangedAt"];

    expect(invariantFields0).toEqual(invariantFields1);
  });

  test("a timeline with no owners at all converts NOTHING - but is still marked owner-notified", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({
        id: "timeline-1",
        description: DESCRIPTION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
    ]);
    monitorService.findOwners.mockResolvedValue([]);
    projectService.getOwners.mockResolvedValue([]);

    markdownSpy.mockClear();

    await runWorkerTick();

    expect(timelineService.updateOneById).toHaveBeenCalledTimes(1);
    expect(markdownSpy).not.toHaveBeenCalled();
    expect(monitorService.getMonitorLinkInDashboard).not.toHaveBeenCalled();
    expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
  });

  test("empty description and missing rootCause convert to the same (empty) HTML the old code produced, once each", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: "timeline-1" }),
    ]);
    monitorService.findOwners.mockResolvedValue([
      makeOwner("user-1"),
      makeOwner("user-2"),
      makeOwner("user-3"),
    ]);

    // The old code's exact expressions for both empty inputs.
    const expectedEmptyDescriptionHtml: string = await Markdown.convertToHTML(
      "",
      MarkdownContentType.Email,
    );
    const expectedEmptyRootCauseHtml: string =
      (await Markdown.convertToHTML("", MarkdownContentType.Email)) || "";

    markdownSpy.mockClear();

    await runWorkerTick();

    expect(markdownSpy).toHaveBeenCalledTimes(2);
    expect(markdownSpy.mock.calls).toEqual([
      ["", MarkdownContentType.Email],
      ["", MarkdownContentType.Email],
    ]);

    const allVars: Array<Dictionary<string>> = sentVars();

    expect(allVars).toHaveLength(3);

    for (const vars of allVars) {
      expect(vars["monitorDescription"]).toBe(expectedEmptyDescriptionHtml);
      expect(vars["rootCause"]).toBe(expectedEmptyRootCauseHtml);
    }
  });
});
