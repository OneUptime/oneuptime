import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentReminderRule from "Common/Models/DatabaseModels/IncidentReminderRule";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import Timezone from "Common/Types/Timezone";

/*
 * Regression tests for the IncidentOwner:SendUnresolvedReminderNotification
 * cron's markdown fan-out. The job used to re-run
 * Markdown.convertToHTML(incident.description) INSIDE the per-owner loop even
 * though the description never varies per owner - N marked parses per
 * reminder. The perf fix hoists the conversion next to the already-hoisted
 * incidentViewLink, once per incident. These tests pin:
 *   1. exactly ONE convertToHTML call per incident regardless of owner count
 *      (the old code called it once PER OWNER),
 *   2. the vars dictionary each owner receives is byte-identical to what the
 *      old per-owner conversion produced,
 *   3. the timezone-dependent declaredAt var still varies per user,
 *   4. the zero-owner early return still converts nothing at all.
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

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      findOwners: jest.fn(),
      isIncidentResolved: jest.fn(),
      isIncidentAcknowledged: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentReminderRuleService", () => {
  return {
    __esModule: true,
    default: {
      findMatchingRule: jest.fn(),
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

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      getUserMarkdownString: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentFeedService", () => {
  return {
    __esModule: true,
    default: {
      createIncidentFeedItem: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/PushNotificationUtil", () => {
  return {
    __esModule: true,
    default: {
      createGenericNotification: jest.fn(() => {
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

import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentReminderRuleService from "Common/Server/Services/IncidentReminderRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserService from "Common/Server/Services/UserService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/IncidentOwners/SendUnresolvedReminderNotification";

interface IncidentServiceMock {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  findOwners: jest.Mock;
  isIncidentResolved: jest.Mock;
  isIncidentAcknowledged: jest.Mock;
  getIncidentLinkInDashboard: jest.Mock;
}

const incidentService: IncidentServiceMock =
  IncidentService as unknown as IncidentServiceMock;
const reminderRuleService: { findMatchingRule: jest.Mock } =
  IncidentReminderRuleService as unknown as { findMatchingRule: jest.Mock };
const projectService: { getOwners: jest.Mock } = ProjectService as unknown as {
  getOwners: jest.Mock;
};
const notificationService: { sendUserNotification: jest.Mock } =
  UserNotificationSettingService as unknown as {
    sendUserNotification: jest.Mock;
  };
const userService: { getUserMarkdownString: jest.Mock } =
  UserService as unknown as { getUserMarkdownString: jest.Mock };
const feedService: { createIncidentFeedItem: jest.Mock } =
  IncidentFeedService as unknown as { createIncidentFeedItem: jest.Mock };

const NOW: Date = new Date("2026-08-18T10:00:00.000Z");
const DECLARED_AT: Date = new Date("2026-08-18T08:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const INCIDENT_ID: ObjectID = new ObjectID("incident-1");
const INCIDENT_LINK: string = "https://oneuptime.test/dashboard/incident-1";

const DESCRIPTION_MARKDOWN: string = "**Everything** is on _fire_";

function makeIncident(description: string | undefined): Incident {
  const incident: Incident = new Incident(INCIDENT_ID);
  incident.projectId = PROJECT_ID;
  incident.title = "API is down";

  if (description !== undefined) {
    incident.description = description;
  }

  const project: Project = new Project();
  project.name = "Acme Status";
  incident.project = project;

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  incident.incidentSeverity = severity;

  const state: IncidentState = new IncidentState();
  state.name = "Investigating";
  incident.currentIncidentState = state;

  const monitorA: Monitor = new Monitor();
  monitorA.name = "API Monitor";
  const monitorB: Monitor = new Monitor();
  monitorB.name = "Web Monitor";
  incident.monitors = [monitorA, monitorB];

  incident.labels = [];
  incident.incidentNumber = 42;
  incident.declaredAt = DECLARED_AT;
  incident.createdAt = DECLARED_AT;
  incident.enableReminders = true;
  incident.reminderNotificationSentCount = 0;

  return incident;
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
    mockCapturedJobs["IncidentOwner:SendUnresolvedReminderNotification"];

  if (!handler) {
    throw new Error(
      "IncidentOwner:SendUnresolvedReminderNotification did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("IncidentOwner:SendUnresolvedReminderNotification worker", () => {
  let markdownSpy: jest.SpyInstance;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    // Real conversion, spied - call counts are the regression under test.
    markdownSpy = jest.spyOn(Markdown, "convertToHTML");

    const rule: IncidentReminderRule = new IncidentReminderRule();
    rule.reminderIntervalInMinutes = 30;

    incidentService.findAllBy.mockResolvedValue([]);
    incidentService.updateOneById.mockResolvedValue(undefined);
    incidentService.findOwners.mockResolvedValue([]);
    incidentService.isIncidentResolved.mockResolvedValue(false);
    incidentService.isIncidentAcknowledged.mockResolvedValue(false);
    incidentService.getIncidentLinkInDashboard.mockResolvedValue({
      toString: (): string => {
        return INCIDENT_LINK;
      },
    });
    reminderRuleService.findMatchingRule.mockResolvedValue(rule);
    projectService.getOwners.mockResolvedValue([]);
    notificationService.sendUserNotification.mockResolvedValue(undefined);
    userService.getUserMarkdownString.mockResolvedValue("[Owner](profile)");
    feedService.createIncidentFeedItem.mockResolvedValue(undefined);
  });

  test("converts the description ONCE per incident for 3 owners - not once per owner - and every owner gets byte-identical vars", async () => {
    incidentService.findAllBy.mockResolvedValue([
      makeIncident(DESCRIPTION_MARKDOWN),
    ]);
    incidentService.findOwners.mockResolvedValue([
      makeOwner("user-1"),
      makeOwner("user-2"),
      makeOwner("user-3"),
    ]);

    // What the old per-owner code produced for every owner, byte for byte.
    const expectedDescriptionHtml: string = await Markdown.convertToHTML(
      DESCRIPTION_MARKDOWN,
      MarkdownContentType.Email,
    );

    expect(expectedDescriptionHtml).toContain("<strong>Everything</strong>");

    markdownSpy.mockClear();

    await runWorkerTick();

    // THE regression: the old code converted once per owner (3 calls here).
    expect(markdownSpy).toHaveBeenCalledTimes(1);
    expect(markdownSpy).toHaveBeenCalledWith(
      DESCRIPTION_MARKDOWN,
      MarkdownContentType.Email,
    );

    // The view link was already hoisted before this fix - keep it that way.
    expect(incidentService.getIncidentLinkInDashboard).toHaveBeenCalledTimes(1);

    expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(3);

    const allVars: Array<Dictionary<string>> = sentVars();

    const expectedVars: Dictionary<string> = {
      incidentTitle: "API is down",
      incidentNumber: "#42",
      projectName: "Acme Status",
      currentState: "Investigating",
      openDuration: OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
        OneUptimeDate.getDifferenceInSeconds(NOW, DECLARED_AT),
      ),
      declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: DECLARED_AT,
        timezones: [],
      }),
      incidentDescription: expectedDescriptionHtml,
      resourcesAffected: "API Monitor, Web Monitor",
      incidentSeverity: "Critical",
      incidentViewLink: INCIDENT_LINK,
      isOwner: "true",
    };

    expect(allVars).toEqual([expectedVars, expectedVars, expectedVars]);

    const emailEnvelope: EmailEnvelope = (
      notificationService.sendUserNotification.mock.calls[0]![0] as {
        emailEnvelope: EmailEnvelope;
      }
    ).emailEnvelope;

    expect(emailEnvelope.templateType).toBe(
      EmailTemplateType.IncidentOwnerUnresolvedReminder,
    );
    expect(emailEnvelope.subject).toBe(
      "[Reminder] Incident #42 is still Investigating - API is down",
    );

    // One feed item naming every notified owner, exactly as before.
    expect(feedService.createIncidentFeedItem).toHaveBeenCalledTimes(1);
    expect(
      (
        feedService.createIncidentFeedItem.mock.calls[0]![0] as {
          moreInformationInMarkdown: string;
        }
      ).moreInformationInMarkdown,
    ).toBe("**Notified:** [Owner](profile)\n".repeat(3));
  });

  test("the timezone-dependent declaredAt var STAYS per-user while the description conversion is still shared", async () => {
    incidentService.findAllBy.mockResolvedValue([
      makeIncident(DESCRIPTION_MARKDOWN),
    ]);
    incidentService.findOwners.mockResolvedValue([
      makeOwner("user-1"),
      makeOwner("user-2", Timezone.AmericaNew_York),
    ]);

    markdownSpy.mockClear();

    await runWorkerTick();

    expect(markdownSpy).toHaveBeenCalledTimes(1);

    const allVars: Array<Dictionary<string>> = sentVars();

    expect(allVars).toHaveLength(2);
    expect(allVars[0]!["declaredAt"]).toBe(
      OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: DECLARED_AT,
        timezones: [],
      }),
    );
    expect(allVars[1]!["declaredAt"]).toBe(
      OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: DECLARED_AT,
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

  test("an incident with no owners at all converts NOTHING and sends nothing", async () => {
    incidentService.findAllBy.mockResolvedValue([
      makeIncident(DESCRIPTION_MARKDOWN),
    ]);
    incidentService.findOwners.mockResolvedValue([]);
    projectService.getOwners.mockResolvedValue([]);

    markdownSpy.mockClear();

    await runWorkerTick();

    expect(markdownSpy).not.toHaveBeenCalled();
    expect(incidentService.getIncidentLinkInDashboard).not.toHaveBeenCalled();
    expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
    expect(feedService.createIncidentFeedItem).not.toHaveBeenCalled();
  });

  test("an empty description converts to the same (empty) HTML the old code produced, still exactly once", async () => {
    incidentService.findAllBy.mockResolvedValue([makeIncident(undefined)]);
    incidentService.findOwners.mockResolvedValue([
      makeOwner("user-1"),
      makeOwner("user-2"),
      makeOwner("user-3"),
    ]);

    const expectedEmptyHtml: string = await Markdown.convertToHTML(
      "",
      MarkdownContentType.Email,
    );

    markdownSpy.mockClear();

    await runWorkerTick();

    expect(markdownSpy).toHaveBeenCalledTimes(1);
    expect(markdownSpy).toHaveBeenCalledWith("", MarkdownContentType.Email);

    const allVars: Array<Dictionary<string>> = sentVars();

    expect(allVars).toHaveLength(3);

    for (const vars of allVars) {
      expect(vars["incidentDescription"]).toBe(expectedEmptyHtml);
    }
  });

  test("project owners (fallback) get the shared conversion too, without the isOwner flag", async () => {
    incidentService.findAllBy.mockResolvedValue([
      makeIncident(DESCRIPTION_MARKDOWN),
    ]);
    incidentService.findOwners.mockResolvedValue([]);
    projectService.getOwners.mockResolvedValue([
      makeOwner("project-owner-1"),
      makeOwner("project-owner-2"),
    ]);

    markdownSpy.mockClear();

    await runWorkerTick();

    expect(markdownSpy).toHaveBeenCalledTimes(1);
    expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(2);

    const allVars: Array<Dictionary<string>> = sentVars();

    for (const vars of allVars) {
      expect(vars["isOwner"]).toBeUndefined();
    }
    expect(allVars[0]).toEqual(allVars[1]);
  });
});
