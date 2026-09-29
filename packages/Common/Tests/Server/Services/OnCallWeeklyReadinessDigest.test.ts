import DatabaseConfig from "../../../Server/DatabaseConfig";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallReadinessService, {
  ReadinessStatus,
  ReadinessSummary,
  ResponderSource,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import ProjectService from "../../../Server/Services/ProjectService";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import { EVERY_WEEK } from "../../../Utils/CronTime";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import fs from "fs";
import Path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PHASE 4, the weekly digest.
 *
 * Everything else built for on-call readiness is either reactive (the fallback,
 * which rescues a page at the moment it would otherwise be dropped) or
 * on-demand (the readiness page, which answers the question for whoever thinks
 * to ask it). Nobody thinks to ask it. This job is the only thing in the system
 * that tells a project owner about an unreachable responder WITHOUT being
 * asked, which puts an unusual amount of weight on properties that are easy to
 * get wrong and invisible when they are:
 *
 *   1. IT IS SILENT WHEN THERE IS NOTHING TO SAY. A weekly "everything is fine"
 *      mail teaches its recipients to filter it, and the filter is still there
 *      the week it says something different. The silence is pinned here as hard
 *      as the sending is.
 *
 *   2. IT NAMES THE RIGHT PEOPLE. A digest that lists a Ready responder among
 *      the broken ones is a digest an owner learns to distrust, and an owner
 *      who distrusts it is an owner who does not read the one that matters.
 *
 *   3. IT NEVER FAILS SILENTLY. ProjectService.getOwners returns [] for a
 *      project where no team holds ProjectOwner, and sendEmailToProjectOwners
 *      then sends nothing and says nothing - so the last-resort warning about
 *      responders nobody can page would itself reach nobody, with no trace
 *      anywhere that it had not. That case has to be LOUD in the log even
 *      though it is silent in the inbox.
 *
 *   4. IT ESCAPES WHAT IT INTERPOLATES. sendEmailToProjectOwners hands the
 *      message to SimpleMessage.hbs, which renders it through a triple stache -
 *      i.e. as RAW HTML. Responder names, reason sentences and project names
 *      are all user-controlled strings.
 *
 *   5. IT IS REGISTERED. RunCron registers a job purely as a module side
 *      effect, so a job file nothing imports is never scheduled. That exact
 *      omission was a Phase 1 blocker, and it is invisible to every test that
 *      imports the job directly - which is why one test below reads
 *      App/FeatureSet/Workers/Index.ts as text.
 *
 * This suite lives beside SeverityRuleBackfill.test.ts, the Phase 1 worker
 * tests, for the same reason they do: the job is an App module that imports
 * Common through the `Common/*` specifier, and Common's tsconfig is the one
 * that maps that specifier back to this tree.
 */

/*
 * The job registers itself with RunCron at import time, which would otherwise
 * reach for the Worker queue (and therefore Redis) as a side effect of
 * importing this file. Mocked before the job module is imported, both to keep
 * the import inert and to capture the registration itself.
 */
type CronHandler = () => Promise<void>;

interface CapturedCronOptions {
  schedule: string;
  runOnStartup: boolean;
}

const mockCapturedJobs: Record<string, CronHandler> = {};
const mockCapturedOptions: Record<string, CapturedCronOptions> = {};

jest.mock("../../../../App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CapturedCronOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCapturedOptions[jobName] = options;
      },
    ),
  };
});

// Imported AFTER the mock above so the registration lands in it.
import {
  JOB_NAME,
  MAX_RESPONDERS_LISTED_PER_SECTION,
  ProjectDigest,
  buildProjectDigest,
  findProjectsWithOnCallPolicies,
  sendDigestForProject,
  sendWeeklyReadinessDigests,
} from "../../../../App/FeatureSet/Workers/Jobs/OnCallDutyPolicy/WeeklyReadinessDigest";

const WORKERS_INDEX_PATH: string = Path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Workers/Index.ts",
);

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const OTHER_PROJECT_ID: ObjectID = new ObjectID("project-2");

const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";

type MakeProjectFunction = (data?: {
  id?: ObjectID;
  // null means "this project has no name", which is a different case from "default".
  name?: string | null;
}) => Project;

const makeProject: MakeProjectFunction = (data?: {
  id?: ObjectID;
  name?: string | null;
}): Project => {
  const project: Project = new Project();
  project.id = data?.id || PROJECT_ID;

  const name: string | null =
    data && "name" in data ? data.name ?? null : "Acme Production";

  if (name) {
    project.name = name;
  }

  return project;
};

type MakePolicyFunction = (
  policyProjectId: ObjectID | undefined,
) => OnCallDutyPolicy;

const makePolicy: MakePolicyFunction = (
  policyProjectId: ObjectID | undefined,
): OnCallDutyPolicy => {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = new ObjectID(`policy-${policyProjectId?.toString() || "none"}`);

  if (policyProjectId) {
    policy.projectId = policyProjectId;
  }

  return policy;
};

type MakeUserReadinessFunction = (
  overrides?: Partial<UserReadiness>,
) => UserReadiness;

const makeUserReadiness: MakeUserReadinessFunction = (
  overrides?: Partial<UserReadiness>,
): UserReadiness => {
  return {
    userId: new ObjectID("user-1"),
    userName: "Ada Lovelace",
    userEmail: "ada@example.com",
    status: ReadinessStatus.NotReachable,
    methods: [],
    coverage: [],
    reasons: ["No verified notification method - cannot be paged"],
    reachedVia: [ResponderSource.Direct],
    teams: [],
    ...overrides,
  };
};

type MakeSummaryFunction = (
  overrides?: Partial<ReadinessSummary>,
) => ReadinessSummary;

const makeSummary: MakeSummaryFunction = (
  overrides?: Partial<ReadinessSummary>,
): ReadinessSummary => {
  const users: Array<UserReadiness> = overrides?.users || [];

  const countOf: (status: ReadinessStatus) => number = (
    status: ReadinessStatus,
  ): number => {
    return users.filter((user: UserReadiness): boolean => {
      return user.status === status;
    }).length;
  };

  return {
    projectId: PROJECT_ID,
    readyCount: countOf(ReadinessStatus.Ready),
    partiallyReadyCount: countOf(ReadinessStatus.PartiallyReady),
    notReachableCount: countOf(ReadinessStatus.NotReachable),
    isFallbackEnabled: true,
    isTruncated: false,
    ...overrides,
    users: users,
  };
};

type MakeOwnerFunction = (name: string) => User;

const makeOwner: MakeOwnerFunction = (name: string): User => {
  const user: User = new User();
  user.id = new ObjectID(`owner-${name}`);

  return user;
};

/* Every spy the suite drives, refreshed per test. */
let policyFindAllBySpy: jest.SpyInstance;
let policyFindBySpy: jest.SpyInstance;
let projectFindAllBySpy: jest.SpyInstance;
let projectFindBySpy: jest.SpyInstance;
let getOwnersSpy: jest.SpyInstance;
let sendEmailSpy: jest.SpyInstance;
let readinessSpy: jest.SpyInstance;
let loggerWarnSpy: jest.SpyInstance;
let loggerErrorSpy: jest.SpyInstance;

/* The (projectId, subject, message) of the nth mail the job asked to send. */
type SentMail = {
  projectId: ObjectID;
  subject: string;
  message: string;
};

type GetSentMailFunction = (index: number) => SentMail;

const getSentMail: GetSentMailFunction = (index: number): SentMail => {
  const call: Array<unknown> = sendEmailSpy.mock.calls[index] as Array<unknown>;

  return {
    projectId: call[0] as ObjectID,
    subject: call[1] as string,
    message: call[2] as string,
  };
};

beforeEach(() => {
  policyFindAllBySpy = jest
    .spyOn(OnCallDutyPolicyService, "findAllBy")
    .mockResolvedValue([]);

  policyFindBySpy = jest
    .spyOn(OnCallDutyPolicyService, "findBy")
    .mockResolvedValue([]);

  projectFindAllBySpy = jest
    .spyOn(ProjectService, "findAllBy")
    .mockResolvedValue([]);

  projectFindBySpy = jest.spyOn(ProjectService, "findBy").mockResolvedValue([]);

  getOwnersSpy = jest
    .spyOn(ProjectService, "getOwners")
    .mockResolvedValue([makeOwner("first")]);

  sendEmailSpy = jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockResolvedValue(undefined);

  readinessSpy = jest
    .spyOn(OnCallReadinessService, "getReadinessForProject")
    .mockResolvedValue(makeSummary());

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL));

  // Silenced, and asserted on: the log IS the product in the no-owners case.
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  loggerWarnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {});
  loggerErrorSpy = jest
    .spyOn(logger, "error")
    .mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WeeklyReadinessDigest - registration", () => {
  test("registers itself with RunCron on a weekly schedule, and never on startup", () => {
    expect(JOB_NAME).toBe("OnCallDutyPolicy:WeeklyReadinessDigest");
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();

    const options: CapturedCronOptions | undefined =
      mockCapturedOptions[JOB_NAME];

    expect(options?.schedule).toBe(EVERY_WEEK);

    /*
     * runOnStartup would email every project owner in the instance on every
     * worker boot - every deploy, every crash-loop, every scale-up. An owner
     * whose inbox gets three digests during one rollout writes a filter rule,
     * and that filter rule is still there the week the digest matters.
     */
    expect(options?.runOnStartup).toBe(false);
  });

  test("the registered cron handler runs the sweep", async () => {
    const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];

    expect(handler).toBeDefined();

    await handler!();

    // The sweep starts by asking which projects have an on-call policy at all.
    expect(policyFindAllBySpy).toHaveBeenCalledTimes(1);
  });

  test("is imported by App/FeatureSet/Workers/Index.ts, without which it never runs", () => {
    /*
     * Not a stylistic check. RunCron registers a job purely as a module side
     * effect, so a job file that nothing imports is never scheduled and cannot
     * be enqueued by name either. Every other test in this file imports the job
     * directly, so every other test would still pass with the import missing;
     * reading the index as TEXT is the only assertion that can fail for the
     * right reason. Phase 1 shipped this exact omission.
     */
    const indexSource: string = fs.readFileSync(WORKERS_INDEX_PATH, {
      encoding: "utf-8",
    });

    expect(indexSource).toContain(
      'import "./Jobs/OnCallDutyPolicy/WeeklyReadinessDigest";',
    );
  });
});

describe("WeeklyReadinessDigest - finding the projects to check", () => {
  test("collapses many policies into one read of their distinct projects", async () => {
    policyFindAllBySpy.mockResolvedValue([
      makePolicy(PROJECT_ID),
      makePolicy(PROJECT_ID),
      makePolicy(OTHER_PROJECT_ID),
    ]);

    projectFindAllBySpy.mockResolvedValue([
      makeProject({ id: PROJECT_ID }),
      makeProject({ id: OTHER_PROJECT_ID, name: "Acme Staging" }),
    ]);

    const projects: Array<Project> = await findProjectsWithOnCallPolicies();

    expect(projects).toHaveLength(2);
    expect(projectFindAllBySpy).toHaveBeenCalledTimes(1);

    const findBy: Record<string, unknown> = projectFindAllBySpy.mock
      .calls[0]![0] as Record<string, unknown>;
    const query: Record<string, unknown> = findBy["query"] as Record<
      string,
      unknown
    >;
    const includes: Includes = query["_id"] as Includes;

    expect(includes).toBeInstanceOf(Includes);
    expect(
      (includes.values as Array<ObjectID>).map((value: ObjectID): string => {
        return value.toString();
      }),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]);
  });

  test("reads nothing about projects when no project has an on-call policy", async () => {
    policyFindAllBySpy.mockResolvedValue([]);

    const projects: Array<Project> = await findProjectsWithOnCallPolicies();

    expect(projects).toEqual([]);
    expect(projectFindAllBySpy).not.toHaveBeenCalled();
  });

  test("skips policy rows with no project id rather than querying for undefined", async () => {
    policyFindAllBySpy.mockResolvedValue([
      makePolicy(undefined),
      makePolicy(PROJECT_ID),
    ]);

    await findProjectsWithOnCallPolicies();

    const findBy: Record<string, unknown> = projectFindAllBySpy.mock
      .calls[0]![0] as Record<string, unknown>;
    const query: Record<string, unknown> = findBy["query"] as Record<
      string,
      unknown
    >;
    const includes: Includes = query["_id"] as Includes;

    expect(includes.values).toHaveLength(1);
  });

  test("pages both reads instead of taking whatever the first page returns", async () => {
    /*
     * findAllBy pages until the table is exhausted; findBy stops at its limit.
     * A project whose only policy row falls off the end of a single page is a
     * project whose unreachable responders are reported to nobody - which is
     * indistinguishable from a project that is fine. Same reasoning as
     * OnCallReadinessService's readEveryPage, and the same defect that made
     * TeamComplianceService's `limit: 100` a comfortable lie.
     */
    policyFindAllBySpy.mockResolvedValue([makePolicy(PROJECT_ID)]);
    projectFindAllBySpy.mockResolvedValue([makeProject()]);

    await findProjectsWithOnCallPolicies();

    expect(policyFindAllBySpy).toHaveBeenCalledTimes(1);
    expect(projectFindAllBySpy).toHaveBeenCalledTimes(1);
    expect(policyFindBySpy).not.toHaveBeenCalled();
    expect(projectFindBySpy).not.toHaveBeenCalled();

    const policyFindBy: Record<string, any> = policyFindAllBySpy.mock
      .calls[0]![0] as Record<string, any>;
    const projectFindBy: Record<string, any> = projectFindAllBySpy.mock
      .calls[0]![0] as Record<string, any>;

    expect(policyFindBy["props"].isRoot).toBe(true);
    expect(projectFindBy["props"].isRoot).toBe(true);
  });
});

describe("WeeklyReadinessDigest - saying nothing", () => {
  test("sends no digest when every responder is ready", async () => {
    readinessSpy.mockResolvedValue(
      makeSummary({
        users: [
          makeUserReadiness({ status: ReadinessStatus.Ready, reasons: [] }),
          makeUserReadiness({
            userId: new ObjectID("user-2"),
            userName: "Grace Hopper",
            status: ReadinessStatus.Ready,
            reasons: [],
          }),
        ],
      }),
    );

    await sendDigestForProject(makeProject());

    expect(sendEmailSpy).not.toHaveBeenCalled();

    /*
     * Not even the owner lookup happens: a healthy project costs one readiness
     * computation and nothing else, which is what makes running this over every
     * project in the instance affordable.
     */
    expect(getOwnersSpy).not.toHaveBeenCalled();
  });

  test("sends no digest when the project's policies have no responders at all", async () => {
    readinessSpy.mockResolvedValue(makeSummary({ users: [] }));

    await sendDigestForProject(makeProject());

    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  test("warns in the log, and still sends nothing, when a clean result came from a truncated read", async () => {
    /*
     * "We found no problems" and "we could not finish looking" are the same
     * silence in an inbox. There is nobody to name, so there is no digest to
     * send - but the difference has to survive somewhere, and the worker log is
     * the only place left.
     */
    readinessSpy.mockResolvedValue(
      makeSummary({ users: [], isTruncated: true }),
    );

    await sendDigestForProject(makeProject());

    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
    expect(loggerWarnSpy.mock.calls[0]![0]).toContain(PROJECT_ID.toString());
  });
});

describe("WeeklyReadinessDigest - saying something", () => {
  test("emails the owners, naming the unreachable responder and their reasons", async () => {
    readinessSpy.mockResolvedValue(
      makeSummary({
        users: [
          makeUserReadiness({
            userName: "Ada Lovelace",
            userEmail: "ada@example.com",
            reasons: [
              "No verified notification method - cannot be paged",
              "Added SMS but never verified - unverified methods are never used",
            ],
          }),
        ],
      }),
    );

    await sendDigestForProject(makeProject());

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);

    const mail: SentMail = getSentMail(0);

    expect(mail.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(mail.subject).toContain("[Action Required]");
    expect(mail.subject).toContain("1 on-call responder");
    expect(mail.subject).toContain("Acme Production");
    expect(mail.subject).toContain("cannot be paged");

    expect(mail.message).toContain("Ada Lovelace");
    expect(mail.message).toContain("ada@example.com");
    expect(mail.message).toContain(
      "No verified notification method - cannot be paged",
    );
    expect(mail.message).toContain(
      "Added SMS but never verified - unverified methods are never used",
    );
  });

  test("links to that project's On-Call > Readiness page", async () => {
    readinessSpy.mockResolvedValue(
      makeSummary({ users: [makeUserReadiness()] }),
    );

    await sendDigestForProject(makeProject());

    const mail: SentMail = getSentMail(0);

    expect(mail.message).toContain(
      `${DASHBOARD_URL}/${PROJECT_ID.toString()}/on-call-duty/readiness`,
    );
    expect(mail.message).toContain("<a href=");
  });

  test("never names a responder who is ready", async () => {
    readinessSpy.mockResolvedValue(
      makeSummary({
        users: [
          makeUserReadiness({ userName: "Ada Lovelace" }),
          makeUserReadiness({
            userId: new ObjectID("user-2"),
            userName: "Grace Hopper",
            status: ReadinessStatus.Ready,
            reasons: [],
          }),
        ],
      }),
    );

    await sendDigestForProject(makeProject());

    const mail: SentMail = getSentMail(0);

    expect(mail.message).toContain("Ada Lovelace");
    expect(mail.message).not.toContain("Grace Hopper");
  });

  test("separates 'cannot be paged at all' from 'reachable, but with gaps', worst first", async () => {
    readinessSpy.mockResolvedValue(
      makeSummary({
        users: [
          makeUserReadiness({
            userName: "Ada Lovelace",
            status: ReadinessStatus.NotReachable,
          }),
          makeUserReadiness({
            userId: new ObjectID("user-2"),
            userName: "Grace Hopper",
            status: ReadinessStatus.PartiallyReady,
            reasons: [
              "No rules for Sev1 incidents - pages fall back to Email, Push",
            ],
          }),
        ],
      }),
    );

    await sendDigestForProject(makeProject());

    const mail: SentMail = getSentMail(0);

    expect(mail.message).toContain("Cannot be paged at all (1)");
    expect(mail.message).toContain("Reachable, but with gaps (1)");
    expect(mail.message.indexOf("Cannot be paged at all")).toBeLessThan(
      mail.message.indexOf("Reachable, but with gaps"),
    );
  });

  test("drops the [Action Required] prefix when nobody is fully unreachable", async () => {
    readinessSpy.mockResolvedValue(
      makeSummary({
        users: [
          makeUserReadiness({
            status: ReadinessStatus.PartiallyReady,
            reasons: ["No rules for Sev1 incidents - pages fall back to Email"],
          }),
        ],
      }),
    );

    await sendDigestForProject(makeProject());

    const mail: SentMail = getSentMail(0);

    expect(mail.subject).not.toContain("[Action Required]");
    expect(mail.subject).toContain("gaps in their notification rules");
  });

  test("calls the gaps DROPPED pages, not fallback pages, when the project has the fallback switched off", async () => {
    /*
     * The same coverage gap means two different things depending on one project
     * setting: with the fallback on it is an untidy page on the wrong channel,
     * with it off it is silence. Those must not share a sentence.
     */
    readinessSpy.mockResolvedValue(
      makeSummary({
        isFallbackEnabled: false,
        users: [
          makeUserReadiness({
            status: ReadinessStatus.PartiallyReady,
            reasons: [
              "No rules for Sev1 incidents - pages are dropped because on-call fallback is disabled for this project",
            ],
          }),
        ],
      }),
    );

    await sendDigestForProject(makeProject());

    const mail: SentMail = getSentMail(0);

    expect(mail.message).toContain("switched OFF");
    expect(mail.message).toContain("silent pages");
    expect(mail.message).not.toContain(
      "fall back to whatever they have verified",
    );
  });

  test("admits in the mail when the readiness check did not finish reading the project", async () => {
    readinessSpy.mockResolvedValue(
      makeSummary({ isTruncated: true, users: [makeUserReadiness()] }),
    );

    await sendDigestForProject(makeProject());

    expect(getSentMail(0).message).toContain("did not finish reading");
  });

  test("falls back to a generic project name rather than emailing about 'undefined'", async () => {
    readinessSpy.mockResolvedValue(
      makeSummary({ users: [makeUserReadiness()] }),
    );

    await sendDigestForProject(makeProject({ id: PROJECT_ID, name: null }));

    const mail: SentMail = getSentMail(0);

    expect(mail.subject).toContain("your project");
    expect(mail.message).toContain("your project");
    expect(mail.subject).not.toContain("undefined");
    expect(mail.message).not.toContain("undefined");
  });

  test("does nothing for a project row with no id", async () => {
    /*
     * Built without an id rather than by clearing one: the model's id setter
     * ignores a null, so an "unset" id can only be produced by never setting
     * it - which is exactly the shape a partial select would hand back.
     */
    const project: Project = new Project();
    project.name = "Acme Production";

    await sendDigestForProject(project);

    expect(readinessSpy).not.toHaveBeenCalled();
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });
});

describe("WeeklyReadinessDigest - nobody to tell", () => {
  test("logs an error, loudly, when the project has no owners to send to", async () => {
    /*
     * getOwners returns [] when no team in the project holds ProjectOwner, and
     * sendEmailToProjectOwners then returns without sending and without
     * complaining. Returning silently here would mean the last-resort warning
     * about responders nobody can page itself reaches nobody, and nothing
     * anywhere records that it did not.
     */
    getOwnersSpy.mockResolvedValue([]);

    readinessSpy.mockResolvedValue(
      makeSummary({
        users: [
          makeUserReadiness(),
          makeUserReadiness({
            userId: new ObjectID("user-2"),
            userName: "Grace Hopper",
            status: ReadinessStatus.PartiallyReady,
            reasons: ["No rules for Sev1 incidents - pages fall back to Email"],
          }),
        ],
      }),
    );

    await sendDigestForProject(makeProject());

    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);

    const logged: string = loggerErrorSpy.mock.calls[0]![0] as string;

    expect(logged).toContain(PROJECT_ID.toString());
    expect(logged).toContain("ProjectOwner");

    // The counts have to survive into the log, because they survive nowhere else.
    expect(logged).toContain("1 responder(s) who cannot be paged");
    expect(logged).toContain("1 with gaps");
  });

  test("does not look for owners at all when there is nothing to tell them", async () => {
    getOwnersSpy.mockResolvedValue([]);

    readinessSpy.mockResolvedValue(
      makeSummary({
        users: [
          makeUserReadiness({ status: ReadinessStatus.Ready, reasons: [] }),
        ],
      }),
    );

    await sendDigestForProject(makeProject());

    expect(getOwnersSpy).not.toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  test("sends through sendEmailToProjectOwners once the owners exist", async () => {
    getOwnersSpy.mockResolvedValue([makeOwner("first"), makeOwner("second")]);

    readinessSpy.mockResolvedValue(
      makeSummary({ users: [makeUserReadiness()] }),
    );

    await sendDigestForProject(makeProject());

    /*
     * One call, not one per owner: fanning the message out to each owner is
     * ProjectService's job, and duplicating that loop here would duplicate its
     * per-owner error handling too.
     */
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });
});

describe("WeeklyReadinessDigest - building the message", () => {
  test("escapes every user-controlled value it interpolates into the raw-HTML body", () => {
    /*
     * ProjectService.sendEmailToProjectOwners hands `message` to
     * SimpleMessage.hbs, which renders it through a triple stache - as RAW
     * HTML. A responder called `<script>` must read as a strange name.
     */
    const digest: ProjectDigest = buildProjectDigest({
      projectName: "<b>Acme</b> & Co",
      notReachable: [
        makeUserReadiness({
          userName: '<script>alert("xss")</script>',
          userEmail: "evil@example.com",
          reasons: ["<img src=x onerror=alert(1)>"],
        }),
      ],
      partiallyReady: [],
      isFallbackEnabled: true,
      isTruncated: false,
      readinessLink: `${DASHBOARD_URL}/${PROJECT_ID.toString()}/on-call-duty/readiness`,
    });

    expect(digest.messageHtml).not.toContain("<script>");
    expect(digest.messageHtml).not.toContain("<img src=x");
    expect(digest.messageHtml).toContain("&lt;script&gt;");
    expect(digest.messageHtml).toContain("&lt;img src=x");
    expect(digest.messageHtml).toContain("&lt;b&gt;Acme&lt;/b&gt; &amp; Co");
  });

  test("escapes a hostile responder name in the PARTIALLY READY section too", () => {
    const digest: ProjectDigest = buildProjectDigest({
      projectName: "Acme Production",
      notReachable: [],
      partiallyReady: [
        makeUserReadiness({
          status: ReadinessStatus.PartiallyReady,
          userName: "<svg onload=alert(1)>",
          reasons: ["<b>not a tag</b>"],
        }),
      ],
      isFallbackEnabled: true,
      isTruncated: false,
      readinessLink: DASHBOARD_URL,
    });

    expect(digest.messageHtml).not.toContain("<svg");
    expect(digest.messageHtml).toContain("&lt;svg onload=alert(1)&gt;");
    expect(digest.messageHtml).toContain("&lt;b&gt;not a tag&lt;/b&gt;");
  });

  test("leaves the subject RAW, because Handlebars escapes it and SMTP does not want it escaped", () => {
    /*
     * The subject is rendered through {{title}}, which Handlebars escapes on
     * its own, and is also used verbatim as the SMTP subject header. Escaping
     * here would double-escape the first and corrupt the second.
     */
    const digest: ProjectDigest = buildProjectDigest({
      projectName: "Acme & Co",
      notReachable: [makeUserReadiness()],
      partiallyReady: [],
      isFallbackEnabled: true,
      isTruncated: false,
      readinessLink: DASHBOARD_URL,
    });

    expect(digest.subject).toContain("Acme & Co");
    expect(digest.subject).not.toContain("&amp;");
  });

  test("caps each section but never understates the count", () => {
    const many: Array<UserReadiness> = [];

    for (let index: number = 0; index < 25; index++) {
      many.push(
        makeUserReadiness({
          userId: new ObjectID(`user-${index}`),
          // Zero-padded so alphabetical order is also numeric order here.
          userName: `Responder ${index.toString().padStart(2, "0")}`,
        }),
      );
    }

    const digest: ProjectDigest = buildProjectDigest({
      projectName: "Acme Production",
      notReachable: many,
      partiallyReady: [],
      isFallbackEnabled: true,
      isTruncated: false,
      readinessLink: DASHBOARD_URL,
    });

    expect(MAX_RESPONDERS_LISTED_PER_SECTION).toBe(20);

    // The heading counts all 25, even though the list stops at 20.
    expect(digest.messageHtml).toContain("Cannot be paged at all (25)");
    expect(digest.subject).toContain("25 on-call responders");

    expect(digest.messageHtml).toContain("Responder 00");
    expect(digest.messageHtml).toContain("Responder 19");
    expect(digest.messageHtml).not.toContain("Responder 20");
    expect(digest.messageHtml).toContain("and 5 more");
  });

  test("names one responder in the singular and several in the plural", () => {
    const one: ProjectDigest = buildProjectDigest({
      projectName: "Acme Production",
      notReachable: [makeUserReadiness()],
      partiallyReady: [],
      isFallbackEnabled: true,
      isTruncated: false,
      readinessLink: DASHBOARD_URL,
    });

    const two: ProjectDigest = buildProjectDigest({
      projectName: "Acme Production",
      notReachable: [
        makeUserReadiness(),
        makeUserReadiness({ userId: new ObjectID("user-2") }),
      ],
      partiallyReady: [],
      isFallbackEnabled: true,
      isTruncated: false,
      readinessLink: DASHBOARD_URL,
    });

    expect(one.subject).toContain("1 on-call responder in");
    expect(two.subject).toContain("2 on-call responders in");
  });

  test("omits the parenthesised email when the responder has none", () => {
    const digest: ProjectDigest = buildProjectDigest({
      projectName: "Acme Production",
      notReachable: [
        makeUserReadiness({ userName: "Ada Lovelace", userEmail: "" }),
      ],
      partiallyReady: [],
      isFallbackEnabled: true,
      isTruncated: false,
      readinessLink: DASHBOARD_URL,
    });

    expect(digest.messageHtml).toContain("<b>Ada Lovelace</b>");
    expect(digest.messageHtml).not.toContain("Ada Lovelace</b> (");
  });

  test("says out loud that silence means everything is fine", () => {
    /*
     * The framing is load-bearing: an owner who knows this only arrives when
     * something is broken reads it differently from one who assumes it is a
     * routine weekly report they can skim.
     */
    const digest: ProjectDigest = buildProjectDigest({
      projectName: "Acme Production",
      notReachable: [makeUserReadiness()],
      partiallyReady: [],
      isFallbackEnabled: true,
      isTruncated: false,
      readinessLink: DASHBOARD_URL,
    });

    expect(digest.messageHtml).toContain(
      "a week with nothing wrong is a week with no email",
    );
  });
});

describe("WeeklyReadinessDigest - the weekly sweep", () => {
  test("lists responders alphabetically so an unchanged week looks unchanged", async () => {
    readinessSpy.mockResolvedValue(
      makeSummary({
        users: [
          makeUserReadiness({
            userId: new ObjectID("user-1"),
            userName: "Zoe Zhang",
          }),
          makeUserReadiness({
            userId: new ObjectID("user-2"),
            userName: "Ada Lovelace",
          }),
          makeUserReadiness({
            userId: new ObjectID("user-3"),
            userName: "Marie Curie",
          }),
        ],
      }),
    );

    await sendDigestForProject(makeProject());

    const message: string = getSentMail(0).message;

    expect(message.indexOf("Ada Lovelace")).toBeLessThan(
      message.indexOf("Marie Curie"),
    );
    expect(message.indexOf("Marie Curie")).toBeLessThan(
      message.indexOf("Zoe Zhang"),
    );
  });

  test("walks every project with a policy, and asks about each one exactly once", async () => {
    policyFindAllBySpy.mockResolvedValue([
      makePolicy(PROJECT_ID),
      makePolicy(OTHER_PROJECT_ID),
    ]);

    projectFindAllBySpy.mockResolvedValue([
      makeProject({ id: PROJECT_ID }),
      makeProject({ id: OTHER_PROJECT_ID, name: "Acme Staging" }),
    ]);

    readinessSpy.mockResolvedValue(
      makeSummary({ users: [makeUserReadiness()] }),
    );

    await sendWeeklyReadinessDigests();

    expect(readinessSpy).toHaveBeenCalledTimes(2);
    expect(sendEmailSpy).toHaveBeenCalledTimes(2);
    expect(getSentMail(1).subject).toContain("Acme Staging");
  });

  test("does nothing at all when no project has an on-call policy", async () => {
    policyFindAllBySpy.mockResolvedValue([]);

    await sendWeeklyReadinessDigests();

    expect(readinessSpy).not.toHaveBeenCalled();
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  test("one project that throws does not stop the rest being told", async () => {
    policyFindAllBySpy.mockResolvedValue([
      makePolicy(PROJECT_ID),
      makePolicy(OTHER_PROJECT_ID),
    ]);

    projectFindAllBySpy.mockResolvedValue([
      makeProject({ id: PROJECT_ID }),
      makeProject({ id: OTHER_PROJECT_ID, name: "Acme Staging" }),
    ]);

    readinessSpy.mockImplementation(
      async (askedProjectId: ObjectID): Promise<ReadinessSummary> => {
        if (askedProjectId.toString() === PROJECT_ID.toString()) {
          throw new Error("readiness read blew up");
        }

        return makeSummary({ users: [makeUserReadiness()] });
      },
    );

    await sendWeeklyReadinessDigests();

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(getSentMail(0).projectId.toString()).toBe(
      OTHER_PROJECT_ID.toString(),
    );
    expect(loggerErrorSpy).toHaveBeenCalled();
  });
});
