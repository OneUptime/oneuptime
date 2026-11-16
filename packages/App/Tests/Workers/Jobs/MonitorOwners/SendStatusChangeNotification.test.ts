import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { Green } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Timezone from "Common/Types/Timezone";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";

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
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
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
      findBy: jest.fn(),
      findOneById: jest.fn(),
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
  findBy: jest.Mock;
  findOneBy: jest.Mock;
  updateOneById: jest.Mock;
  compareAndSetColumnsByIdWithoutHooks: jest.Mock;
}

interface MonitorServiceMock {
  findBy: jest.Mock;
  findOneById: jest.Mock;
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

/*
 * The status changes the job's page read finds - those a test hands it -
 * until the job takes each (OwnerNotificationBacklog): the read is a page,
 * and the take a compare-and-set that only the first to make wins. The
 * monitor of each is read with the page, as the job reads it.
 */
let dueTimelines: Array<MonitorStatusTimeline> = [];
const takenTimelineIds: Set<string> = new Set<string>();

function due(timelines: Array<MonitorStatusTimeline>): void {
  dueTimelines = timelines;
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

    dueTimelines = [];
    takenTimelineIds.clear();
    timelineService.findAllBy.mockResolvedValue([]);
    timelineService.findBy.mockImplementation(async () => {
      return dueTimelines.filter((timeline: MonitorStatusTimeline) => {
        return !takenTimelineIds.has(timeline.id!.toString());
      });
    });
    timelineService.compareAndSetColumnsByIdWithoutHooks.mockImplementation(
      async (data: { id: ObjectID }): Promise<boolean> => {
        if (takenTimelineIds.has(data.id.toString())) {
          return false;
        }

        takenTimelineIds.add(data.id.toString());
        return true;
      },
    );
    timelineService.findOneBy.mockResolvedValue(null);
    timelineService.updateOneById.mockResolvedValue(undefined);
    monitorService.findBy.mockImplementation(async () => {
      return dueTimelines
        .map((timeline: MonitorStatusTimeline): Monitor | undefined => {
          return timeline.monitor;
        })
        .filter((monitor: Monitor | undefined): monitor is Monitor => {
          return Boolean(monitor);
        });
    });
    monitorService.findOneById.mockResolvedValue(null);
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
    due([
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
      // The readable shade of the status colour, for its name.
      currentStatusTextColor: EmailColorUtil.getColorPair(Green)!.textColor,
      /*
       * No previous status, so no previous colour either: the template drops
       * the whole previous column when previousStatus is empty.
       */
      previousStatus: "",
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

    due([
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
    due([
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
    due([
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

    // Taken all the same, by its one hook-free write.
    expect(
      timelineService.compareAndSetColumnsByIdWithoutHooks,
    ).toHaveBeenCalledTimes(1);
    expect(
      timelineService.compareAndSetColumnsByIdWithoutHooks.mock.calls[0]![0],
    ).toMatchObject({
      data: { isOwnerNotified: true },
      expectedData: { isOwnerNotified: false },
    });
    expect(timelineService.updateOneById).not.toHaveBeenCalled();
    expect(markdownSpy).not.toHaveBeenCalled();
    expect(monitorService.getMonitorLinkInDashboard).not.toHaveBeenCalled();
    expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
  });

  test("empty description and missing rootCause convert to the same (empty) HTML the old code produced, once each", async () => {
    due([makeTimeline({ id: "timeline-1" })]);
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

  /*
   * The monitor name is user text. Compiled again by the mailer, "{{ ... }}"
   * in it rendered as nothing and a lone "{{" stopped the email being sent.
   */
  test("a monitor name quoting template syntax reaches the subject as written, marked literal", async () => {
    const timeline: MonitorStatusTimeline = makeTimeline({ id: "timeline-1" });
    timeline.monitor!.name = "{{ .Release.Name }}-api";
    due([timeline]);
    monitorService.findOwners.mockResolvedValue([makeOwner("user-1")]);

    await runWorkerTick();

    const emailEnvelope: EmailEnvelope = (
      notificationService.sendUserNotification.mock.calls[0]![0] as {
        emailEnvelope: EmailEnvelope;
      }
    ).emailEnvelope;

    expect(emailEnvelope.isSubjectLiteral).toBe(true);
    expect(emailEnvelope.subject).toBe(
      "[Operational Monitor] {{ .Release.Name }}-api",
    );
  });

  /*
   * The transition paints both statuses: a dot in each one's own colour and
   * the name in a readable shade of it. A colour that is not a hex or rgb()
   * colour never reaches the email - the old code passed it on as written.
   */
  describe("status colours", () => {
    test("paints the previous and the new status in their own colours", async () => {
      due([makeTimeline({ id: "timeline-1" })]);
      const previousTimeline: MonitorStatusTimeline = new MonitorStatusTimeline(
        new ObjectID("timeline-0"),
      );
      previousTimeline.monitorStatusId = new ObjectID("status-offline");
      previousTimeline.startsAt = new Date(CHANGED_AT.getTime() - 60000);
      timelineService.findOneBy.mockResolvedValue(previousTimeline);
      const offline: MonitorStatus = new MonitorStatus();
      offline.name = "Offline";
      offline.color = new Color("#EF4444");
      monitorStatusService.findOneById.mockResolvedValue(offline);
      monitorService.findOwners.mockResolvedValue([makeOwner("user-1")]);

      await runWorkerTick();

      expect(sentVars()[0]).toMatchObject({
        previousStatus: "Offline",
        previousStatusColor: "#ef4444",
        previousStatusTextColor:
          EmailColorUtil.getColorPair("#ef4444")!.textColor,
        currentStatus: "Operational",
        currentStatusColor: Green.toString(),
        currentStatusTextColor: EmailColorUtil.getColorPair(Green)!.textColor,
      });
    });

    test("a status colour that is not a colour is dropped, not passed on as written", async () => {
      const timeline: MonitorStatusTimeline = makeTimeline({
        id: "timeline-1",
      });
      timeline.monitorStatus!.color = new Color(
        "#fff; background: url(https://evil.example/t.gif)",
      );
      due([timeline]);
      monitorService.findOwners.mockResolvedValue([makeOwner("user-1")]);

      await runWorkerTick();

      expect(sentVars()[0]!["currentStatus"]).toBe("Operational");
      expect(sentVars()[0]).not.toHaveProperty("currentStatusColor");
      expect(sentVars()[0]).not.toHaveProperty("currentStatusTextColor");
      expect(JSON.stringify(sentVars()[0])).not.toContain("evil.example");
    });
  });

  /*
   * Issue #7974. A flapping monitor writes many status changes a minute.
   * The job read every one not yet told with the monitor's whole steps
   * joined to it, looked up the monitor's owners for each, read the
   * previous status for each, and marked each through updateOneById and its
   * every hook. Now a run reads a page of status changes, the page's
   * monitors in one query, each monitor's owners and each status once for
   * the page, and takes each status change with one hook-free write.
   */
  describe("a page of status changes of a few flapping monitors", () => {
    const MONITOR_IDS: Array<ObjectID> = [1, 2, 3, 4].map(
      (index: number): ObjectID => {
        return new ObjectID(`monitor-${index}`);
      },
    );

    // Five status changes of each of the four monitors, interleaved.
    function flapping(): Array<MonitorStatusTimeline> {
      const timelines: Array<MonitorStatusTimeline> = [];

      for (let change: number = 0; change < 5; change++) {
        for (const monitorId of MONITOR_IDS) {
          const timeline: MonitorStatusTimeline = makeTimeline({
            id: `timeline-${monitorId.toString()}-${change}`,
            description: DESCRIPTION_MARKDOWN,
            rootCause: ROOT_CAUSE_MARKDOWN,
          });
          timeline.monitorId = monitorId;
          const monitor: Monitor = new Monitor(monitorId);
          monitor.name = `Monitor ${monitorId.toString()}`;
          monitor.description = DESCRIPTION_MARKDOWN;
          timeline.monitor = monitor;
          timeline.startsAt = new Date(CHANGED_AT.getTime() + change * 60000);
          timelines.push(timeline);
        }
      }

      return timelines;
    }

    beforeEach(() => {
      monitorService.findOwners.mockResolvedValue([
        makeOwner("user-1"),
        makeOwner("user-2"),
      ]);

      // Every status change has a previous one, Offline.
      const previousTimeline: MonitorStatusTimeline = new MonitorStatusTimeline(
        new ObjectID("timeline-previous"),
      );
      previousTimeline.monitorStatusId = new ObjectID("status-offline");
      previousTimeline.startsAt = new Date(CHANGED_AT.getTime() - 60000);
      timelineService.findOneBy.mockResolvedValue(previousTimeline);
      const offline: MonitorStatus = new MonitorStatus();
      offline.name = "Offline";
      monitorStatusService.findOneById.mockResolvedValue(offline);
    });

    test("reads the page's monitors in one query, and never a monitor's steps with each status change", async () => {
      due(flapping());

      await runWorkerTick();

      // One page of status changes, one query for its four monitors.
      expect(timelineService.findBy).toHaveBeenCalledTimes(1);
      expect(monitorService.findBy).toHaveBeenCalledTimes(1);
      expect(monitorService.findOneById).not.toHaveBeenCalled();

      const pageRead: { select: Record<string, unknown> } = timelineService
        .findBy.mock.calls[0]![0] as { select: Record<string, unknown> };

      expect(pageRead.select).not.toHaveProperty("monitor");
      expect(pageRead.select["monitorId"]).toBe(true);

      // Every owner of every status change told, once each.
      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(
        40,
      );
    });

    test("looks up each monitor's owners once for the page, not once per status change", async () => {
      due(flapping());

      await runWorkerTick();

      // Was 20: one lookup per status change.
      expect(monitorService.findOwners).toHaveBeenCalledTimes(4);
      expect(
        monitorService.findOwners.mock.calls
          .map((call: Array<unknown>): string => {
            return String(call[0]);
          })
          .sort(),
      ).toEqual(
        MONITOR_IDS.map((id: ObjectID): string => {
          return id.toString();
        }).sort(),
      );
    });

    test("reads the project's owners once for the page, for monitors with none of their own", async () => {
      monitorService.findOwners.mockResolvedValue([]);
      projectService.getOwners.mockResolvedValue([makeOwner("user-9")]);
      due(flapping());

      await runWorkerTick();

      // Was 20: one per status change of an ownerless monitor.
      expect(projectService.getOwners).toHaveBeenCalledTimes(1);
      expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(
        20,
      );
    });

    test("reads each previous status once for the page", async () => {
      due(flapping());

      await runWorkerTick();

      // The previous status change is still read for each: 20.
      expect(timelineService.findOneBy).toHaveBeenCalledTimes(20);
      // Its status, the same one each time, once (was 20).
      expect(monitorStatusService.findOneById).toHaveBeenCalledTimes(1);
      expect(sentVars()[0]!["previousStatus"]).toBe("Offline");
    });

    test("takes each status change with one hook-free write, and never updateOneById", async () => {
      due(flapping());

      await runWorkerTick();

      expect(
        timelineService.compareAndSetColumnsByIdWithoutHooks,
      ).toHaveBeenCalledTimes(20);
      expect(timelineService.updateOneById).not.toHaveBeenCalled();
      expect(timelineService.findAllBy).not.toHaveBeenCalled();
    });

    test("tells them in the order they happened", async () => {
      const timelines: Array<MonitorStatusTimeline> = flapping();
      due(timelines);

      await runWorkerTick();

      const toldOf: Array<string> =
        notificationService.sendUserNotification.mock.calls
          .map((call: Array<unknown>): string => {
            return String((call[0] as { monitorId: ObjectID }).monitorId);
          })
          .filter((_: string, index: number): boolean => {
            // Two owners each: one entry per status change.
            return index % 2 === 0;
          });

      expect(toldOf).toEqual(
        timelines.map((timeline: MonitorStatusTimeline): string => {
          return timeline.monitorId!.toString();
        }),
      );
      // The page is read oldest first.
      expect(
        (timelineService.findBy.mock.calls[0]![0] as { sort: unknown }).sort,
      ).toEqual({ createdAt: SortOrder.Ascending });
    });
  });

  test("a status change another run took first is not told again", async () => {
    const timeline: MonitorStatusTimeline = makeTimeline({
      id: "timeline-1",
    });
    due([timeline]);
    monitorService.findOwners.mockResolvedValue([makeOwner("user-1")]);
    // The other run's take landed between this run's read and its own.
    takenTimelineIds.add(timeline.id!.toString());
    timelineService.findBy.mockResolvedValueOnce([timeline]);

    await runWorkerTick();

    expect(
      timelineService.compareAndSetColumnsByIdWithoutHooks,
    ).toHaveBeenCalledTimes(1);
    expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
  });

  test("a status change of a monitor that is gone is taken, and nobody is told", async () => {
    const timeline: MonitorStatusTimeline = makeTimeline({
      id: "timeline-1",
    });
    due([timeline]);
    monitorService.findOwners.mockResolvedValue([makeOwner("user-1")]);
    // Neither the page's read nor the monitor's own finds it.
    monitorService.findBy.mockResolvedValue([]);
    monitorService.findOneById.mockResolvedValue(null);

    await runWorkerTick();

    expect(monitorService.findOneById).toHaveBeenCalledTimes(1);
    expect(
      timelineService.compareAndSetColumnsByIdWithoutHooks,
    ).toHaveBeenCalledTimes(1);
    expect(monitorService.findOwners).not.toHaveBeenCalled();
    expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
  });
});
