import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Timezone from "Common/Types/Timezone";

/*
 * Regression tests for the IncidentOwner:SendCreatedResourceEmail cron's
 * per-owner fan-out - the line-for-line twin of the AlertOwner suite (keep the
 * two symmetric). The job used to re-run, INSIDE the per-owner loop, three
 * Markdown.convertToHTML conversions that never vary per owner: the incident
 * description, the remediation notes, and the root cause - 3xN marked parses
 * per incident. The perf fix hoists all three to once per incident, just above
 * the owner loop (still inside the per-incident scope). These tests pin:
 *   1. exactly THREE convertToHTML calls per incident regardless of owner
 *      count (the old code did all three once PER OWNER: 9 calls for 3),
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

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      findOwners: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
      getIncidentIdentifiedDate: jest.fn(),
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
      createIncidentCreatedNotification: jest.fn(() => {
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
import IncidentService from "Common/Server/Services/IncidentService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/IncidentOwners/SendCreatedResourceNotification";

interface IncidentServiceMock {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  findOwners: jest.Mock;
  getIncidentLinkInDashboard: jest.Mock;
  getIncidentIdentifiedDate: jest.Mock;
}

const incidentService: IncidentServiceMock =
  IncidentService as unknown as IncidentServiceMock;
const projectService: { getOwners: jest.Mock } = ProjectService as unknown as {
  getOwners: jest.Mock;
};
const notificationService: { sendUserNotification: jest.Mock } =
  UserNotificationSettingService as unknown as {
    sendUserNotification: jest.Mock;
  };
const feedService: { createIncidentFeedItem: jest.Mock } =
  IncidentFeedService as unknown as { createIncidentFeedItem: jest.Mock };
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const IDENTIFIED_AT: Date = new Date("2026-08-18T09:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const INCIDENT_ID: ObjectID = new ObjectID("incident-1");
const INCIDENT_LINK: string = "https://oneuptime.test/dashboard/incident-1";

const DESCRIPTION_MARKDOWN: string = "**Checkout** is returning 500s";
const REMEDIATION_MARKDOWN: string = "Fail over to the *replica* database";
const ROOT_CAUSE_MARKDOWN: string = "The **primary** database ran out of disk";
const DEFAULT_ROOT_CAUSE: string = "No root cause identified for this incident";

function makeIncident(data: {
  description?: string | undefined;
  remediationNotes?: string | undefined;
  rootCause?: string | undefined;
}): Incident {
  const incident: Incident = new Incident(INCIDENT_ID);
  incident.projectId = PROJECT_ID;
  incident.title = "Checkout is down";

  if (data.description !== undefined) {
    incident.description = data.description;
  }

  if (data.remediationNotes !== undefined) {
    incident.remediationNotes = data.remediationNotes;
  }

  if (data.rootCause !== undefined) {
    incident.rootCause = data.rootCause;
  }

  const project: Project = new Project();
  project.name = "Acme Status";
  incident.project = project;

  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  incident.currentIncidentState = state;

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Major";
  incident.incidentSeverity = severity;

  const monitorA: Monitor = new Monitor();
  monitorA.name = "Checkout Monitor";
  const monitorB: Monitor = new Monitor();
  monitorB.name = "Payments Monitor";
  incident.monitors = [monitorA, monitorB];

  incident.incidentNumber = 12;

  return incident;
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
    mockCapturedJobs["IncidentOwner:SendCreatedResourceEmail"];

  if (!handler) {
    throw new Error(
      "IncidentOwner:SendCreatedResourceEmail did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("IncidentOwner:SendCreatedResourceEmail worker", () => {
  let markdownSpy: jest.SpyInstance;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Real conversion, spied - call counts are the regression under test.
    markdownSpy = jest.spyOn(Markdown, "convertToHTML");

    incidentService.findAllBy.mockResolvedValue([]);
    incidentService.updateOneById.mockResolvedValue(undefined);
    incidentService.findOwners.mockResolvedValue([]);
    incidentService.getIncidentLinkInDashboard.mockResolvedValue({
      toString: (): string => {
        return INCIDENT_LINK;
      },
    });
    incidentService.getIncidentIdentifiedDate.mockResolvedValue(IDENTIFIED_AT);
    projectService.getOwners.mockResolvedValue([]);
    notificationService.sendUserNotification.mockResolvedValue(undefined);
    feedService.createIncidentFeedItem.mockResolvedValue(undefined);
  });

  test("converts description, remediation notes and root cause ONCE per incident for 3 owners - not once per owner", async () => {
    incidentService.findAllBy.mockResolvedValue([
      makeIncident({
        description: DESCRIPTION_MARKDOWN,
        remediationNotes: REMEDIATION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
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

    expect(expectedDescriptionHtml).toContain("<strong>Checkout</strong>");

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
      incidentTitle: "Checkout is down",
      incidentNumber: "#12",
      projectName: "Acme Status",
      currentState: "Identified",
      incidentDescription: expectedDescriptionHtml,
      resourcesAffected: "Checkout Monitor, Payments Monitor",
      incidentSeverity: "Major",
      declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: IDENTIFIED_AT,
        timezones: [],
      }),
      declaredBy: "OneUptime",
      remediationNotes: expectedRemediationHtml,
      rootCause: expectedRootCauseHtml,
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
      EmailTemplateType.IncidentOwnerResourceCreated,
    );
    expect(emailEnvelope.subject).toBe("[New Incident #12] - Checkout is down");

    /*
     * The dashboard link is NOT part of this fix: one call for the feed text
     * plus two per owner (vars + push payload), exactly as before.
     */
    expect(incidentService.getIncidentLinkInDashboard).toHaveBeenCalledTimes(7);

    expect(feedService.createIncidentFeedItem).toHaveBeenCalledTimes(1);
  });

  test("the timezone-dependent declaredAt var STAYS per-user while the conversions are still shared", async () => {
    incidentService.findAllBy.mockResolvedValue([
      makeIncident({
        description: DESCRIPTION_MARKDOWN,
        remediationNotes: REMEDIATION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
    ]);
    incidentService.findOwners.mockResolvedValue([
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
    incidentService.findAllBy.mockResolvedValue([
      makeIncident({
        description: DESCRIPTION_MARKDOWN,
        remediationNotes: REMEDIATION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
    ]);
    incidentService.findOwners.mockResolvedValue([
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
        feedService.createIncidentFeedItem.mock.calls[0]![0] as {
          moreInformationInMarkdown: string;
        }
      ).moreInformationInMarkdown,
    ).toBe(
      "**Notified**: Owner user-2 (user-2@acme.test)\n" +
        "**Notified**: Owner user-3 (user-3@acme.test)\n",
    );
  });

  test("an incident with no owners at all converts NOTHING - but is still marked owner-notified", async () => {
    incidentService.findAllBy.mockResolvedValue([
      makeIncident({
        description: DESCRIPTION_MARKDOWN,
        remediationNotes: REMEDIATION_MARKDOWN,
        rootCause: ROOT_CAUSE_MARKDOWN,
      }),
    ]);
    incidentService.findOwners.mockResolvedValue([]);
    projectService.getOwners.mockResolvedValue([]);

    markdownSpy.mockClear();

    await runWorkerTick();

    expect(incidentService.updateOneById).toHaveBeenCalledTimes(1);
    expect(markdownSpy).not.toHaveBeenCalled();
    expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
    expect(feedService.createIncidentFeedItem).not.toHaveBeenCalled();
  });

  test("empty description/remediation and a missing root cause fall back exactly as the old code did, one conversion each", async () => {
    incidentService.findAllBy.mockResolvedValue([makeIncident({})]);
    incidentService.findOwners.mockResolvedValue([
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
      expect(vars["incidentDescription"]).toBe(expectedEmptyHtml);
      expect(vars["remediationNotes"]).toBe(expectedEmptyHtml || "");
      expect(vars["rootCause"]).toBe(expectedDefaultRootCauseHtml);
    }
  });
});
