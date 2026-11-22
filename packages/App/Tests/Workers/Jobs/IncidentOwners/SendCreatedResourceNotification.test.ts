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
import { Red500, Yellow500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";

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
      findOneById: jest.fn(),
      findCreatedNotificationsDue: jest.fn(),
      takeCreatedNotification: jest.fn(),
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

/*
 * The notifications on-call pages sent, which the job reads to leave out an
 * owner the incident's page reached already (#7987): held in memory
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

import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentService from "Common/Server/Services/IncidentService";
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
import {
  InMemoryOnCallPages,
  useInMemoryOnCallPages,
} from "Common/Tests/Helpers/InMemoryOnCallPages";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import UserService from "Common/Server/Services/UserService";
import OwnerNotificationDeliveries from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { JSONObject } from "Common/Types/JSON";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/IncidentOwners/SendCreatedResourceNotification";

interface IncidentServiceMock {
  findAllBy: jest.Mock;
  findOneById: jest.Mock;
  findCreatedNotificationsDue: jest.Mock;
  takeCreatedNotification: jest.Mock;
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

  /*
   * With ids and the project: the job reads the incident's affected
   * resources back through IncidentService.findAllBy (mocked to return these
   * rows), and a resource of no known project is not named.
   */
  const monitorA: Monitor = new Monitor(new ObjectID("monitor-a"));
  monitorA.name = "Checkout Monitor";
  monitorA.projectId = PROJECT_ID;
  const monitorB: Monitor = new Monitor(new ObjectID("monitor-b"));
  monitorB.name = "Payments Monitor";
  monitorB.projectId = PROJECT_ID;
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
  let deliveries: InMemoryOwnerNotificationDeliveries;
  let pages: InMemoryOnCallPages;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    /*
     * Whom each incident tells is written down before it is taken, and each
     * owner told through it (OwnerNotificationDeliveries, #8199).
     */
    deliveries = useInMemoryOwnerNotificationDeliveries();

    // Nobody was paged, unless a test says so (#7987).
    pages = useInMemoryOnCallPages();

    // Real conversion, spied - call counts are the regression under test.
    markdownSpy = jest.spyOn(Markdown, "convertToHTML");

    incidentService.findAllBy.mockResolvedValue([]);
    /*
     * The job's own read answers what findAllBy is set to answer, as when
     * the job read through findAllBy itself: the rows a test sets are the
     * records due, and the relation reads after it.
     */
    incidentService.findCreatedNotificationsDue.mockImplementation(
      (args: unknown): Promise<unknown> => {
        return incidentService.findAllBy(args);
      },
    );
    incidentService.takeCreatedNotification.mockResolvedValue(true);
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
     * The dashboard link: two per owner (vars + push payload). The feed
     * entry no longer links to the incident whose feed it is in.
     */
    expect(incidentService.getIncidentLinkInDashboard).toHaveBeenCalledTimes(6);

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
    ).toBe("- Owner user-2\n" + "- Owner user-3\n");
  });

  test("the feed says the incident's own owners were notified", async () => {
    incidentService.findAllBy.mockResolvedValue([makeIncident({})]);
    incidentService.findOwners.mockResolvedValue([makeOwner("user-1")]);

    await runWorkerTick();

    expect(
      (
        feedService.createIncidentFeedItem.mock.calls[0]![0] as {
          feedInfoInMarkdown: string;
        }
      ).feedInfoInMarkdown,
    ).toBe("Owners were notified that this incident was created.");
  });

  /*
   * A new project's first incident has no owners: its creator, a project
   * owner, is emailed instead - and the feed says who, beside an Owners
   * field that reads "Add".
   */
  test("an incident nobody owns says the project's owners were notified in their place", async () => {
    incidentService.findAllBy.mockResolvedValue([makeIncident({})]);
    incidentService.findOwners.mockResolvedValue([]);
    projectService.getOwners.mockResolvedValue([makeOwner("user-2")]);

    await runWorkerTick();

    expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);
    expect(
      (
        feedService.createIncidentFeedItem.mock.calls[0]![0] as {
          feedInfoInMarkdown: string;
          moreInformationInMarkdown: string;
        }
      ).feedInfoInMarkdown,
    ).toBe(
      "The Project Owners were notified that this incident was created, as it has no owners yet.",
    );
    expect(
      (
        feedService.createIncidentFeedItem.mock.calls[0]![0] as {
          moreInformationInMarkdown: string;
        }
      ).moreInformationInMarkdown,
    ).toBe("- Owner user-2\n");
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

    expect(incidentService.takeCreatedNotification).toHaveBeenCalledTimes(1);
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

  /*
   * The title is user text. Compiled again by the mailer, "{{ ... }}" in it
   * rendered as nothing and a lone "{{" stopped the email being sent.
   */
  test("a title quoting template syntax reaches the subject as written, marked literal", async () => {
    const incident: Incident = makeIncident({});
    incident.title = "Rollout of {{ .Values.image.tag }} stalled";
    incidentService.findAllBy.mockResolvedValue([incident]);
    incidentService.findOwners.mockResolvedValue([makeOwner("user-1")]);

    await runWorkerTick();

    const envelope: EmailEnvelope = (
      notificationService.sendUserNotification.mock.calls[0]![0] as {
        emailEnvelope: EmailEnvelope;
      }
    ).emailEnvelope;
    expect(envelope.isSubjectLiteral).toBe(true);
    expect(envelope.subject).toBe(
      "[New Incident #12] - Rollout of {{ .Values.image.tag }} stalled",
    );
  });

  /*
   * The email paints the state and the severity in their own colours: a dot
   * in the colour and the name in a readable shade of it.
   */
  describe("severity and state colours", () => {
    test("reads each colour with its name", async () => {
      await runWorkerTick();

      const select: Record<string, unknown> = (
        incidentService.findAllBy.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }
      ).select;

      expect(select["currentIncidentState"]).toEqual({
        name: true,
        color: true,
      });
      expect(select["incidentSeverity"]).toEqual({ name: true, color: true });
    });

    test("sends each one's dot colour and name colour beside its name", async () => {
      const incident: Incident = makeIncident({});
      incident.currentIncidentState!.color = Red500;
      incident.incidentSeverity!.color = Yellow500;
      incidentService.findAllBy.mockResolvedValue([incident]);
      incidentService.findOwners.mockResolvedValue([makeOwner("user-1")]);

      await runWorkerTick();

      expect(sentVars()[0]).toMatchObject({
        currentState: "Identified",
        currentStateColor: Red500.toString(),
        currentStateTextColor: EmailColorUtil.getColorPair(Red500)!.textColor,
        incidentSeverity: "Major",
        incidentSeverityColor: Yellow500.toString(),
        incidentSeverityTextColor:
          EmailColorUtil.getColorPair(Yellow500)!.textColor,
      });
    });

    test("an unusable colour is left out, so the email shows the plain name", async () => {
      const incident: Incident = makeIncident({});
      incident.currentIncidentState!.color = new Color("transparent");
      incident.incidentSeverity!.color = new Color("#fff; position: fixed");
      incidentService.findAllBy.mockResolvedValue([incident]);
      incidentService.findOwners.mockResolvedValue([makeOwner("user-1")]);

      await runWorkerTick();

      const vars: Dictionary<string> = sentVars()[0]!;

      expect(vars["currentState"]).toBe("Identified");
      expect(vars["incidentSeverity"]).toBe("Major");
      for (const name of [
        "currentStateColor",
        "currentStateTextColor",
        "incidentSeverityColor",
        "incidentSeverityTextColor",
      ]) {
        expect(vars).not.toHaveProperty(name);
      }
    });

    test("every owner gets the same colours", async () => {
      const incident: Incident = makeIncident({});
      incident.incidentSeverity!.color = Yellow500;
      incidentService.findAllBy.mockResolvedValue([incident]);
      incidentService.findOwners.mockResolvedValue([
        makeOwner("user-1"),
        makeOwner("user-2", Timezone.AmericaNew_York),
      ]);

      await runWorkerTick();

      const colours: Array<string | undefined> = sentVars().map(
        (vars: Dictionary<string>): string | undefined => {
          return vars["incidentSeverityTextColor"];
        },
      );

      expect(colours).toHaveLength(2);
      expect(new Set(colours).size).toBe(1);
      expect(colours[0]).toBe(
        EmailColorUtil.getColorPair(Yellow500)!.textColor,
      );
    });
  });

  /*
   * WHICH INCIDENTS IT TELLS THEIR OWNERS ABOUT (#7571, #7573): the ones
   * IncidentService.findCreatedNotificationsDue reads as of the moment it
   * runs - let go a minute after their create, or held so long that nobody
   * will let them go - each taken first, in one write that matches only
   * while the incident is as it was read (takeCreatedNotification). One
   * another run took, or that was let go meanwhile, is not this run's.
   */
  describe("which incidents it tells their owners about", () => {
    const NOW: Date = new Date("2026-11-15T10:02:00.000Z");
    const OTHER_INCIDENT_ID: ObjectID = new ObjectID("incident-2");

    function secondIncident(): Incident {
      const incident: Incident = makeIncident({});
      incident._id = OTHER_INCIDENT_ID.toString();
      incident.title = "Payments are down";
      return incident;
    }

    // Who was sent what, by incident.
    function sentFor(incidentId: ObjectID): Array<string> {
      return notificationService.sendUserNotification.mock.calls
        .filter((args: Array<unknown>): boolean => {
          return (
            (args[0] as { incidentId: ObjectID }).incidentId.toString() ===
            incidentId.toString()
          );
        })
        .map((args: Array<unknown>): string => {
          return (args[0] as { userId: ObjectID }).userId.toString();
        });
    }

    test("reads the incidents due as of the moment it runs, with every column its email needs", async () => {
      jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

      await runWorkerTick();

      expect(incidentService.findCreatedNotificationsDue).toHaveBeenCalledTimes(
        1,
      );

      const read: { now: Date; select: Record<string, unknown> } =
        incidentService.findCreatedNotificationsDue.mock.calls[0]![0] as {
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
          remediationNotes: true,
          rootCause: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        }),
      );
    });

    test("writes whom it is to tell, then takes each incident it read, as it read it, before telling anyone", async () => {
      const first: Incident = makeIncident({});
      const second: Incident = secondIncident();
      incidentService.findAllBy.mockResolvedValue([first, second]);
      incidentService.findOwners.mockResolvedValue([makeOwner("user-1")]);

      await runWorkerTick();

      expect(
        incidentService.takeCreatedNotification.mock.calls.map(
          (args: Array<unknown>): unknown => {
            return args[0];
          },
        ),
      ).toEqual([first, second]);
      expect(incidentService.takeCreatedNotification.mock.calls[0]![0]).toBe(
        first,
      );

      const takenFirst: number =
        incidentService.takeCreatedNotification.mock.invocationCallOrder[0]!;

      /*
       * Its owners are read and written down first, so a worker stopped
       * after the take leaves them to be told (#8199) - and nobody is told
       * before the take.
       */
      expect(
        incidentService.findOwners.mock.invocationCallOrder[0]!,
      ).toBeLessThan(takenFirst);
      expect(
        (
          OwnerNotificationDeliveryService.writeOwnersToTell as unknown as jest.Mock
        ).mock.invocationCallOrder[0]!,
      ).toBeLessThan(takenFirst);
      expect(takenFirst).toBeLessThan(
        notificationService.sendUserNotification.mock.invocationCallOrder[0]!,
      );
      expect(sentFor(INCIDENT_ID)).toEqual(["user-1"]);
      expect(sentFor(OTHER_INCIDENT_ID)).toEqual(["user-1"]);
    });

    test("tells nobody of an incident it could not take - another run took it, or it was let go meanwhile - and goes on to the next", async () => {
      incidentService.findAllBy.mockResolvedValue([
        makeIncident({}),
        secondIncident(),
      ]);
      incidentService.takeCreatedNotification
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      incidentService.findOwners.mockResolvedValue([makeOwner("user-1")]);
      projectService.getOwners.mockResolvedValue([makeOwner("owner-1")]);

      await runWorkerTick();

      expect(sentFor(INCIDENT_ID)).toEqual([]);
      expect(sentFor(OTHER_INCIDENT_ID)).toEqual(["user-1"]);

      /*
       * Its owners were written down before the take, and wait, to be told,
       * for the run that takes it; nothing was sent or written for it.
       */
      expect(incidentService.findOwners).toHaveBeenCalledTimes(2);
      expect(deliveries.statusesOf(INCIDENT_ID)).toEqual({
        ["user-1"]: OwnerNotificationDeliveryStatus.Pending,
      });
      expect(deliveries.statusesOf(OTHER_INCIDENT_ID)).toEqual({
        ["user-1"]: OwnerNotificationDeliveryStatus.Sent,
      });
      expect(feedService.createIncidentFeedItem).toHaveBeenCalledTimes(1);
      expect(
        (
          feedService.createIncidentFeedItem.mock.calls[0]![0] as {
            incidentId: ObjectID;
          }
        ).incidentId.toString(),
      ).toBe(OTHER_INCIDENT_ID.toString());
    });

    test("an incident let go after the run read it is told once, by the run that takes it", async () => {
      incidentService.findAllBy.mockResolvedValue([makeIncident({})]);
      incidentService.findOwners.mockResolvedValue([makeOwner("user-1")]);
      incidentService.takeCreatedNotification
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false);

      await runWorkerTick();
      expect(sentFor(INCIDENT_ID)).toEqual([]);

      await runWorkerTick();
      expect(sentFor(INCIDENT_ID)).toEqual(["user-1"]);

      // Taken: a later run that reads it again can take it no more.
      await runWorkerTick();
      expect(sentFor(INCIDENT_ID)).toEqual(["user-1"]);
    });

    test("an incident whose take fails is left for the next run, and nothing is sent for it", async () => {
      incidentService.findAllBy.mockResolvedValue([makeIncident({})]);
      incidentService.findOwners.mockResolvedValue([makeOwner("user-1")]);
      incidentService.takeCreatedNotification.mockRejectedValue(
        new Error("The database is away"),
      );

      await expect(runWorkerTick()).rejects.toThrow("The database is away");

      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
      expect(feedService.createIncidentFeedItem).not.toHaveBeenCalled();
    });
  });

  /*
   * ONE NOTIFICATION FOR A NEW INCIDENT, NOT TWO (#7987) - as for an alert.
   * Someone who is both an owner (or a Project Owner standing in) and on
   * call was paged as the incident was declared, and a minute later sent
   * "[New Incident INC-12]" with the same facts. An owner the incident's
   * on-call page reached already is left out of the owners' notification;
   * everybody else is told as before.
   */
  describe("someone the incident's on-call page reached already", () => {
    const ANA: User = makeOwner("ana");
    const BO: User = makeOwner("bo");
    const CARA: User = makeOwner("cara");

    // A notification of the incident's page to `user`, in `status`.
    function paged(
      user: User,
      status: UserNotificationStatus = UserNotificationStatus.Sent,
    ): void {
      pages.add({
        projectId: PROJECT_ID,
        userId: user.id!,
        triggeredByIncidentId: INCIDENT_ID,
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
      return feedService.createIncidentFeedItem.mock.calls.map(
        (args: Array<unknown>) => {
          return args[0] as {
            feedInfoInMarkdown: string;
            moreInformationInMarkdown: string;
          };
        },
      );
    }

    beforeEach(() => {
      incidentService.findAllBy.mockResolvedValue([makeIncident({})]);
    });

    test("a project's one person, a Project Owner standing in and paged by the default policy, is sent the page alone", async () => {
      incidentService.findOwners.mockResolvedValue([]);
      projectService.getOwners.mockResolvedValue([ANA]);
      paged(ANA);

      await runWorkerTick();

      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
      // Nobody was notified, so no entry says the Project Owners were.
      expect(feedService.createIncidentFeedItem).not.toHaveBeenCalled();
      // Taken all the same, so it is not read again.
      expect(incidentService.takeCreatedNotification).toHaveBeenCalledTimes(1);
      // Never written down: no later run tells her either.
      expect(deliveries.statusesOf(INCIDENT_ID)).toEqual({});
    });

    test("an owner who is on call, and was paged, is not sent the owners' notification", async () => {
      incidentService.findOwners.mockResolvedValue([ANA]);
      paged(ANA);

      await runWorkerTick();

      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
      expect(feedService.createIncidentFeedItem).not.toHaveBeenCalled();
      expect(deliveries.statusesOf(INCIDENT_ID)).toEqual({});
    });

    test("an owner who is only an owner is sent it, as before - whoever else was paged", async () => {
      incidentService.findOwners.mockResolvedValue([BO]);
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
      ).toBe("[New Incident #12] - Checkout is down");
      expect(feedItems()).toEqual([
        expect.objectContaining({
          feedInfoInMarkdown:
            "Owners were notified that this incident was created.",
          moreInformationInMarkdown: "- Owner bo\n",
        }),
      ]);
    });

    test("a Project Owner standing in who was not paged is sent it, as before", async () => {
      incidentService.findOwners.mockResolvedValue([]);
      projectService.getOwners.mockResolvedValue([BO]);

      await runWorkerTick();

      expect(sentTo()).toEqual(["bo"]);
      expect(feedItems()).toEqual([
        expect.objectContaining({
          feedInfoInMarkdown:
            "The Project Owners were notified that this incident was created, as it has no owners yet.",
          moreInformationInMarkdown: "- Owner bo\n",
        }),
      ]);
    });

    test("two owners, one of them paged: only the other is told, and the feed says who was left out, and why", async () => {
      incidentService.findOwners.mockResolvedValue([ANA, BO]);
      paged(ANA);

      await runWorkerTick();

      expect(sentTo()).toEqual(["bo"]);
      expect(deliveries.statusesOf(INCIDENT_ID)).toEqual({
        ["bo"]: OwnerNotificationDeliveryStatus.Sent,
      });

      // Never listed among those notified: named apart, with the reason.
      expect(feedItems()).toEqual([
        expect.objectContaining({
          feedInfoInMarkdown:
            "Owners were notified that this incident was created.",
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
        incidentService.findOwners.mockResolvedValue([ANA, BO]);
        paged(ANA, status);

        await runWorkerTick();

        expect(sentTo()).toEqual(["bo"]);
      },
    );

    test.each([UserNotificationStatus.Error, UserNotificationStatus.Skipped])(
      "a page whose notification is %s did not reach them: they are told, and the feed names them as told",
      async (status: UserNotificationStatus) => {
        incidentService.findOwners.mockResolvedValue([ANA, BO]);
        paged(ANA, status);

        await runWorkerTick();

        expect(sentTo()).toEqual(["ana", "bo"]);
        expect(feedItems()[0]!.moreInformationInMarkdown).toBe(
          "- Owner ana\n- Owner bo\n",
        );
      },
    );

    test("a page that has sent nothing yet - held for working hours, or their first rule waits - leaves them to be told", async () => {
      incidentService.findOwners.mockResolvedValue([ANA, BO]);
      // Bo's page went out; Ana's is held, and wrote nothing to her timeline.
      paged(BO);

      await runWorkerTick();

      expect(sentTo()).toEqual(["ana"]);
    });

    test("a page about another record - the alert it was declared from, another incident - does not count", async () => {
      incidentService.findOwners.mockResolvedValue([ANA]);
      pages.add({
        projectId: PROJECT_ID,
        userId: ANA.id!,
        triggeredByAlertId: new ObjectID("alert-1"),
      });
      pages.add({
        projectId: PROJECT_ID,
        userId: ANA.id!,
        triggeredByIncidentId: new ObjectID("incident-2"),
      });

      await runWorkerTick();

      expect(sentTo()).toEqual(["ana"]);
    });

    test("the read failing tells everybody, as before, and says so", async () => {
      incidentService.findOwners.mockResolvedValue([ANA, BO]);
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
            `Could not read whom the on-call page of IncidentCreated ${INCIDENT_ID.toString()} reached`,
          );
        }),
      ).toBe(true);
    });

    test("reads the page once for all the incident's owners, after reading them and before writing them down", async () => {
      incidentService.findOwners.mockResolvedValue([ANA, BO, CARA]);

      await runWorkerTick();

      expect(pages.reads).toHaveLength(1);

      const query: Record<string, unknown> = pages.reads[0]!.query as Record<
        string,
        unknown
      >;

      expect(String(query["triggeredByIncidentId"])).toBe(
        INCIDENT_ID.toString(),
      );
      expect(String(query["projectId"])).toBe(PROJECT_ID.toString());

      const read: number = (
        UserOnCallLogTimelineService.findBy as unknown as jest.Mock
      ).mock.invocationCallOrder[0]!;

      expect(
        incidentService.findOwners.mock.invocationCallOrder[0]!,
      ).toBeLessThan(read);
      expect(read).toBeLessThan(
        (
          OwnerNotificationDeliveryService.writeOwnersToTell as unknown as jest.Mock
        ).mock.invocationCallOrder[0]!,
      );
      expect(read).toBeLessThan(
        incidentService.takeCreatedNotification.mock.invocationCallOrder[0]!,
      );
    });

    test("an owner left out is never written down, so a later run that takes up what a stopped one left never tells them", async () => {
      let now: Date = new Date("2026-11-15T10:02:00.000Z");
      jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
        return new Date(now.getTime());
      });

      incidentService.findOwners.mockResolvedValue([ANA, BO, CARA]);
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
      expect(deliveries.statusesOf(INCIDENT_ID)).toEqual({
        ["bo"]: OwnerNotificationDeliveryStatus.Sent,
        ["cara"]: OwnerNotificationDeliveryStatus.Pending,
      });

      // Started again, minutes later: the incident was taken, and is due no more.
      now = new Date(
        now.getTime() +
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES * 60 * 1000,
      );
      incidentService.findAllBy.mockResolvedValue([]);
      incidentService.findOneById.mockResolvedValue(makeIncident({}));

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
