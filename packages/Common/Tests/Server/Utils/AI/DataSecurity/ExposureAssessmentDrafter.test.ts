import SecurityCaseFeed, {
  SecurityCaseFeedEventType,
} from "../../../../../Models/DatabaseModels/SecurityCaseFeed";
import Queue from "../../../../../Server/Infrastructure/Queue";
import AIService from "../../../../../Server/Services/AIService";
import CallService from "../../../../../Server/Services/CallService";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import MailService from "../../../../../Server/Services/MailService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SmsService from "../../../../../Server/Services/SmsService";
import UserService from "../../../../../Server/Services/UserService";
import WhatsAppService from "../../../../../Server/Services/WhatsAppService";
import DataSecurityAiCall from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import { DataSecurityAiPrompt } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import ExposureAssessmentDrafter, {
  ANSWER_UNREAD_MESSAGE,
  ExposureDraftOutcome,
  ExposureDraftSkip,
  NOT_ASSESSED_MESSAGE,
  NOTHING_TO_DRAFT_MESSAGE,
  PICK_A_STORE_MESSAGE,
} from "../../../../../Server/Utils/AI/DataSecurity/ExposureAssessmentDrafter";
import AIInvestigationEngine from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import ExposureAssessmentReader, {
  CHANGE_REFUSED_MESSAGE,
  NOT_ABOUT_A_STORE_MESSAGE,
  READ_REFUSED_MESSAGE,
} from "../../../../../Server/Utils/DataSecurity/ExposureAssessmentReader";
import { S3LogReader } from "../../../../../Server/Utils/DataSecurity/Cloud/Aws/AwsS3AccessLogs";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import {
  ExposureLogRead,
  ExposureLogReadStatus,
  ExposureLogUnreadReason,
  getReadsFromOutside,
  S3LoggingTarget,
} from "../../../../../Types/DataSecurity/AccessLogReads";
import FeedPersonName from "../../../../../Server/Utils/Feed/FeedPersonName";
import ProjectLanguage from "../../../../../Server/Utils/Notification/ProjectLanguage";
import UserLanguage from "../../../../../Server/Utils/Notification/UserLanguage";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  BreachLawId,
  BreachPlace,
} from "../../../../../Types/DataSecurity/BreachLaws";
import {
  ComplianceFact,
  ComplianceFactKind,
} from "../../../../../Types/DataSecurity/ComplianceFacts";
import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { DataSecurityExposureAssessmentResponse } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  BreachCheckKind,
  BreachObligation,
  BreachObligationStatus,
  ExposureAssessmentStarter,
  ExposureDraftPart,
  ExposureReads,
  ExposureReadsLogged,
  ExposureSecret,
  ExposureWindowEndKind,
  ExposureWindowStartKind,
  readStoredExposureAssessment,
  StoredExposureAssessment,
} from "../../../../../Types/DataSecurity/ExposureAssessment";
import {
  ExposureChecklistAnswer,
  ExposureChecklistItem,
} from "../../../../../Types/DataSecurity/ExposureChecklist";
import { ImpactAssessmentSectionSource } from "../../../../../Types/DataSecurity/ImpactAssessment";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { getDataStoreEntityValue } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
} from "../../../../../Utils/Telemetry/ChangeEventFields";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import { everyServerProductIsOn } from "../../../TestingUtils/ServerProductsOn";
import {
  caller,
  caseRow,
  CASE_ID,
  CLOSED,
  CLOUD_RESOURCE_ID,
  ExposureTables,
  FOUND,
  HOUR,
  issueFeedRows,
  issueRow,
  ISSUE_ID,
  NOW,
  OTHER_STORE_ID,
  OTHER_STORE_KEY,
  OWNER,
  PLANTED,
  PROJECT_ID,
  RESOLVED,
  responseRow,
  SECURITY_VIEWER,
  startedAssessment,
  STORE_ID,
  STORE_KEY,
  storeRow,
  useExposureTables,
  USER_ID,
} from "./ExposureAssessmentTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A SECURITY CASE'S EXPOSURE ASSESSMENT, END TO END (#10377).
 *
 * The case, its store, the store's exposure issue and their timelines, who
 * can reach it, the secrets found in it and the case's tasks are tables in
 * memory; the reads, the permission checks, plain code's assessment, the
 * holding of OneUptime AI's answer to the facts and what the case keeps are
 * the product's own. The model, the change log and the names are stood in
 * for. The bucket is the brief's, open nine days with reads not logged
 * (ExposureAssessmentTables).
 */

let tables: ExposureTables;
let asked: SpyInstance<typeof DataSecurityAiCall.ask>;
let timeline: SpyInstance<
  typeof SecurityCaseFeedService.createSecurityCaseFeedItem
>;
let aiEnabled: SpyInstance<typeof AIService.assertProjectAIEnabled>;
let changeLog: SpyInstance<typeof ChangeEventService.executeQuery>;
let sent: Array<SpyInstance<(...args: Array<never>) => unknown>>;
let answerOf: () => string;

function useTables(
  data: Parameters<typeof useExposureTables>[0] = {},
): ExposureTables {
  tables = useExposureTables(data);

  return tables;
}

// What the case keeps now.
function kept(): StoredExposureAssessment | null {
  return readStoredExposureAssessment(
    tables.cases.get(CASE_ID)!["exposureAssessment"],
  );
}

// The change log's rows, as ClickHouse answers the reader's query.
function changeLogAnswers(rows: Array<JSONObject>): void {
  changeLog.mockResolvedValue({
    json: async () => {
      return { data: rows };
    },
  } as never);
}

function changeRow(data: {
  at: Date;
  operation: string;
  failed?: boolean;
}): JSONObject {
  return {
    timeInMs: data.at.getTime(),
    attributes: {
      [ChangeEventAttribute.Source]: ChangeEventSource.Cloud,
      [ChangeEventAttribute.CloudOperation]: data.operation,
      [ChangeEventAttribute.ResourceType]: "CloudResource",
      [ChangeEventAttribute.ResourceId]: CLOUD_RESOURCE_ID,
      [ChangeEventAttribute.CloudAccountId]: "123456789012",
      ...(data.failed
        ? { [ChangeEventAttribute.Status]: ChangeEventStatus.Failed }
        : {}),
    },
  };
}

// A good write-up of every part asked, citing every fact it was given.
function goodAnswer(
  facts: ReadonlyArray<ComplianceFact>,
  parts: ReadonlyArray<ExposureDraftPart> = [
    ExposureDraftPart.Explanation,
    ExposureDraftPart.RegulatorNotice,
    ExposureDraftPart.PeopleNotice,
    ExposureDraftPart.InternalSummary,
  ],
  words: Partial<Record<ExposureDraftPart, string>> = {},
): string {
  const ids: Array<string> = facts.map((fact: ComplianceFact): string => {
    return fact.id;
  });
  const written: Record<ExposureDraftPart, string> = {
    [ExposureDraftPart.Explanation]:
      "Anyone on the internet could read the bucket of customers' email addresses, and its reads were not logged, so treat the data as read. GDPR may ask you to tell the supervisory authority.",
    [ExposureDraftPart.RegulatorNotice]:
      "[Company name] reports that a storage bucket holding customers' names and email addresses was open to anyone on the internet. Reads were not logged, so the data should be treated as read. [Measures taken].",
    [ExposureDraftPart.PeopleNotice]:
      "We are writing to tell you that a storage bucket holding your name and email address could be read by anyone on the internet. We closed it, and [what you can do].",
    [ExposureDraftPart.InternalSummary]:
      "The bucket was public, reads were not logged, and the secrets found in it are to be rotated. Decide with counsel whether GDPR's notices are owed.",
  };
  const answer: JSONObject = {};

  for (const part of parts) {
    answer[part] = { markdown: words[part] || written[part], facts: ids };
  }

  return JSON.stringify(answer);
}

// The prompt OneUptime AI was asked with, and the parts it was asked to write.
function promptAsked(): DataSecurityAiPrompt {
  return (asked.mock.calls[0]![0] as unknown as JSONObject)[
    "prompt"
  ] as unknown as DataSecurityAiPrompt;
}

function writtenParts(prompt: DataSecurityAiPrompt): Array<string> {
  return (prompt.data["write"] as Array<JSONObject>).map(
    (write: JSONObject): string => {
      return String(write["part"]);
    },
  );
}

function timelineLines(): Array<string> {
  return timeline.mock.calls.map((call: Array<unknown>): string => {
    return String((call[0] as JSONObject)["feedInfoInMarkdown"]);
  });
}

// The rows that may apply, where the people are known to live or not.
function mayApply(
  obligations: ReadonlyArray<BreachObligation>,
  isPlaceKnown: boolean,
): Array<string> {
  return obligations
    .filter((obligation: BreachObligation): boolean => {
      return (
        obligation.status === BreachObligationStatus.MayApply &&
        obligation.isPlaceKnown === isPlaceKnown
      );
    })
    .map((obligation: BreachObligation): string => {
      return obligation.ruleId;
    });
}

function expectNothingSent(): void {
  for (const spy of sent) {
    expect(spy).not.toHaveBeenCalled();
  }
}

function expectNoPlantedValue(text: string): void {
  for (const planted of Object.values(PLANTED)) {
    expect(text).not.toContain(planted);
  }
}

async function read(
  props: DatabaseCommonInteractionProps = OWNER,
): Promise<DataSecurityExposureAssessmentResponse> {
  return await ExposureAssessmentDrafter.read({
    projectId: PROJECT_ID,
    securityCaseId: new ObjectID(CASE_ID),
    props,
    now: NOW,
  });
}

async function assess(
  props: DatabaseCommonInteractionProps = OWNER,
  dataStoreId?: string,
): Promise<DataSecurityExposureAssessmentResponse> {
  return await ExposureAssessmentDrafter.assess({
    projectId: PROJECT_ID,
    securityCaseId: new ObjectID(CASE_ID),
    props,
    dataStoreId: dataStoreId ? new ObjectID(dataStoreId) : undefined,
    now: NOW,
  });
}

async function draftForPerson(
  props: DatabaseCommonInteractionProps = OWNER,
): Promise<DataSecurityExposureAssessmentResponse> {
  return await ExposureAssessmentDrafter.draftForPerson({
    projectId: PROJECT_ID,
    securityCaseId: new ObjectID(CASE_ID),
    props,
    now: NOW,
  });
}

async function refusalOf(work: () => Promise<unknown>): Promise<Error> {
  try {
    await work();
  } catch (error) {
    return error as Error;
  }

  throw new Error("It was not refused.");
}

beforeEach(() => {
  everyServerProductIsOn();
  useTables();

  answerOf = (): string => {
    return "{}";
  };
  asked = jest
    .spyOn(DataSecurityAiCall, "ask")
    .mockImplementation((async () => {
      return { content: answerOf() };
    }) as never);
  aiEnabled = jest
    .spyOn(AIService, "assertProjectAIEnabled")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockResolvedValue(null as never);
  jest
    .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
    .mockResolvedValue(null);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
  } as never);
  jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
  jest.spyOn(ProjectLanguage, "getLanguage").mockResolvedValue("en" as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(mdText`Alice Example`);
  jest.spyOn(FeedPersonName, "getText").mockResolvedValue("Alice Example");
  timeline = jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(new SecurityCaseFeed() as never);
  // No change log, unless a test writes one: the window says "at least since".
  changeLog = jest
    .spyOn(ChangeEventService, "executeQuery")
    .mockRejectedValue(new Error("No change log in this test."));

  // Nothing is sent anywhere: every way OneUptime sends, watched.
  sent = [
    jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never),
    jest.spyOn(SmsService, "sendSms").mockResolvedValue(undefined as never),
    jest.spyOn(CallService, "makeCall").mockResolvedValue(undefined as never),
    jest
      .spyOn(WhatsAppService, "sendWhatsAppMessage")
      .mockResolvedValue(undefined as never),
    jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never),
  ] as unknown as Array<SpyInstance<(...args: Array<never>) => unknown>>;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the EU emails bucket, open nine days with reads not logged", () => {
  test("is assessed: the window, who read it, whose data, the secrets, and GDPR's 72 hours due first", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(answer.securityCaseId).toBe(CASE_ID);
    expect(answer.dataStoreId).toBe(STORE_ID);
    expect(answer.assessment!.startedBy).toBe(ExposureAssessmentStarter.Person);
    expect(answer.assessment!.startedByUserId).toBe(USER_ID.toString());

    const view: NonNullable<DataSecurityExposureAssessmentResponse["view"]> =
      answer.view!;

    // The window, from the issue's timeline and Data Security's own response.
    expect(view.window!.start).toBe(FOUND.toISOString());
    expect(view.window!.startKind).toBe(ExposureWindowStartKind.FirstSeen);
    expect(view.window!.end).toBe(CLOSED.toISOString());
    expect(view.window!.endKind).toBe(ExposureWindowEndKind.ResponseAction);
    expect(view.window!.days).toBe(9);
    expect(view.window!.isStillOpen).toBe(false);

    // Reads were not logged: treat the data as read.
    expect(view.reads.logged).toBe(ExposureReadsLogged.NotLogged);
    expect(view.reads.isTreatedAsRead).toBe(true);
    expect(view.reads.isPublic).toBe(true);
    // Outside accounts counted, never named: one used its access while it was open.
    expect(view.reads.outsideAccounts).toBe(2);
    expect(view.reads.outsideAccountsUsedInWindow).toBe(1);

    // Whose data.
    expect(
      view.whose.dataTypes.map((type: { name: string }) => {
        return type.name;
      }),
    ).toEqual(["Email address", "Person name"]);
    expect(view.whose.countriesFromData).toEqual(["DE", "FR", "NL"]);
    expect(view.whose.places).toEqual([BreachPlace.Eea]);
    expect(view.whose.records).toBe(48000);
    expect(view.whose.people).toEqual(["Customers"]);

    // The secrets to rotate: by type and where, those there while it was open.
    expect(
      view.secretsToRotate.map((secret: ExposureSecret) => {
        return [secret.dataTypeName, secret.location, secret.isStillThere];
      }),
    ).toEqual([
      ["AWS secret access key", "deploy/env.sh", true],
      ["GitHub token", "ci/release.yml", false],
    ]);
    expect(view.hasMoreSecrets).toBe(false);

    // The laws: GDPR's 72 hours, counted from when it was found, is due first.
    expect(view.mostUrgent!.ruleId).toBe(BreachLawId.GdprAuthority);
    expect(view.mostUrgent!.foundAt).toBe(FOUND.toISOString());
    expect(view.mostUrgent!.dueAt).toBe(
      new Date(FOUND.getTime() + 72 * HOUR).toISOString(),
    );
    expect(mayApply(view.obligations, true)).toEqual([
      BreachLawId.GdprAuthority,
      BreachLawId.GdprPeople,
    ]);
    /*
     * The data says some of the people are in the EU, not that none lives
     * elsewhere: the other places' laws ask, until a person says where.
     */
    expect(mayApply(view.obligations, false)).toEqual([
      BreachLawId.CertIn,
      BreachLawId.UkGdprAuthority,
      BreachLawId.LgpdAuthority,
      BreachLawId.LgpdPeople,
      BreachLawId.UkGdprPeople,
    ]);
    expect(view.isPlaceUnknown).toBe(false);
    expect(view.now).toBe(NOW.toISOString());
  });

  test("its facts say reads were not logged, carry the window's numbers, and name GDPR", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await assess();
    const kinds: Array<string> = answer.facts.map((fact: ComplianceFact) => {
      return fact.kind;
    });

    expect(kinds).toEqual(
      expect.arrayContaining([
        ComplianceFactKind.ExposureWindow,
        ComplianceFactKind.ExposureReads,
        ComplianceFactKind.SecretFound,
        ComplianceFactKind.BreachObligation,
      ]),
    );

    const reads: ComplianceFact = answer.facts.find(
      (fact: ComplianceFact): boolean => {
        return fact.kind === ComplianceFactKind.ExposureReads;
      },
    )!;

    expect(reads).toMatchObject({
      logged: ExposureReadsLogged.NotLogged,
      isTreatedAsRead: true,
    });
    expect(
      answer.facts.find((fact: ComplianceFact): boolean => {
        return fact.kind === ComplianceFactKind.ExposureWindow;
      }),
    ).toMatchObject({ days: 9, start: FOUND.toISOString() });
  });

  test("the playbook's checklist is answered with the case's tasks", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(
      answer.checklist.map((line: ExposureChecklistAnswer) => {
        return [line.item, line.taskId || null, line.isDone ?? null];
      }),
    ).toEqual([
      [
        ExposureChecklistItem.WhoReadIt,
        "10377000-0000-4000-8000-000000000401",
        false,
      ],
      [
        ExposureChecklistItem.MustReport,
        "10377000-0000-4000-8000-000000000402",
        false,
      ],
      [
        ExposureChecklistItem.RotateSecrets,
        "10377000-0000-4000-8000-000000000403",
        true,
      ],
      [ExposureChecklistItem.CloseTheCase, null, null],
    ]);
  });

  test("no sample, record, secret, connection or account reaches the assessment", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expectNoPlantedValue(JSON.stringify(answer));
    expectNoPlantedValue(JSON.stringify(tables.cases.get(CASE_ID)));
  });

  test("the case keeps only what is not worked out: the store, who started it, and when", async () => {
    await assess();

    expect(tables.cases.updates).toHaveLength(1);
    expect(Object.keys(tables.cases.updates[0]!.set)).toEqual([
      "exposureAssessment",
    ]);
    expect(kept()).toMatchObject({
      dataStoreId: STORE_ID,
      startedBy: ExposureAssessmentStarter.Person,
      startedByUserId: USER_ID.toString(),
      sections: {},
    });
    // The window, the laws and the facts are worked out on every read, never kept.
    expect(JSON.stringify(kept())).not.toContain("gdpr-art-33");
  });
});

describe("the window, from recorded timelines", () => {
  test("still open: it runs to now, and says so", async () => {
    useTables({
      issues: [issueRow({ status: "Open", resolvedAt: null })],
      issueFeed: [issueFeedRows()[0]!],
      storeFeed: [],
    });

    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(answer.view!.window!.isStillOpen).toBe(true);
    expect(answer.view!.window!.endKind).toBe(ExposureWindowEndKind.StillOpen);
    expect(answer.view!.window!.hours).toBe(
      (NOW.getTime() - FOUND.getTime()) / HOUR,
    );
  });

  test("closed by a scan, with no response to say when: by the issue's resolution", async () => {
    useTables({ storeFeed: [] });

    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(answer.view!.window!.end).toBe(RESOLVED.toISOString());
    expect(answer.view!.window!.endKind).toBe(ExposureWindowEndKind.Scan);
  });

  test("a response that changed nothing does not close it", async () => {
    useTables({ storeFeed: [responseRow(CLOSED, false)] });

    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(answer.view!.window!.endKind).toBe(ExposureWindowEndKind.Scan);
  });

  test("the cloud's log says when it opened: the change that made it public starts the window", async () => {
    const opened: Date = new Date("2026-10-30T16:20:00.000Z");

    changeLogAnswers([
      changeRow({ at: opened, operation: "s3:DeleteBucketPublicAccessBlock" }),
    ]);

    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(answer.view!.window!.start).toBe(opened.toISOString());
    expect(answer.view!.window!.startKind).toBe(ExposureWindowStartKind.Change);
    expect(answer.view!.window!.startOperation).toBe(
      "s3:DeleteBucketPublicAccessBlock",
    );
    // Still counted from when it was found.
    expect(answer.view!.mostUrgent!.foundAt).toBe(FOUND.toISOString());

    // The log is read by time, bounded, for the cloud's own changes.
    const query: string = JSON.stringify(changeLog.mock.calls[0]![0]);

    expect(query).toContain("ORDER BY time ASC LIMIT");
  });

  test("a failed change, or one on another resource, starts nothing", async () => {
    const elsewhere: JSONObject = changeRow({
      at: new Date("2026-10-30T16:20:00.000Z"),
      operation: "s3:DeleteBucketPublicAccessBlock",
    });

    (elsewhere["attributes"] as JSONObject)[ChangeEventAttribute.ResourceId] =
      ObjectID.generate().toString();
    changeLogAnswers([
      changeRow({
        at: new Date("2026-10-29T10:00:00.000Z"),
        operation: "s3:DeleteBucketPublicAccessBlock",
        failed: true,
      }),
      elsewhere,
    ]);

    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(answer.view!.window!.start).toBe(FOUND.toISOString());
    expect(answer.view!.window!.startKind).toBe(
      ExposureWindowStartKind.FirstSeen,
    );
  });

  test("a change log that cannot be read leaves the window at least since it was found", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(changeLog).toHaveBeenCalled();
    expect(answer.view!.window!.startKind).toBe(
      ExposureWindowStartKind.FirstSeen,
    );
  });

  test("the case's own exposure issues, not the store's others", async () => {
    useTables({
      issues: [
        issueRow(),
        issueRow({
          _id: "10377000-0000-4000-8000-0000000000a2",
          securityCaseId: ObjectID.generate().toString(),
          firstDetectedAt: new Date("2026-06-01T00:00:00.000Z"),
          resolvedAt: new Date("2026-06-03T00:00:00.000Z"),
        }),
      ],
    });

    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(
      answer.view!.exposureIssues.map((issue: { id: string }) => {
        return issue.id;
      }),
    ).toEqual([ISSUE_ID]);
  });

  test("a case a person opened about the store reads the store's own exposure issues", async () => {
    useTables({ issues: [issueRow({ securityCaseId: null })] });

    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(answer.view!.window!.days).toBe(9);
  });

  test("no exposure issue: no window, and the deadlines count from now", async () => {
    useTables({ issues: [] });

    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(answer.view!.window).toBeNull();
    expect(answer.view!.mostUrgent!.foundAt).toBe(NOW.toISOString());
  });
});

describe("who read it, with and without logs", () => {
  test("reads logged: not treated as read, and a person checks the logs", async () => {
    useTables({ stores: [storeRow({ posture: { accessLogging: true } })] });

    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(answer.view!.reads.logged).toBe(ExposureReadsLogged.Logged);
    expect(answer.view!.reads.isTreatedAsRead).toBe(false);
  });

  test("whether reads were logged not known: treated as read", async () => {
    useTables({ stores: [storeRow({ posture: {} })] });

    const answer: DataSecurityExposureAssessmentResponse = await assess();

    expect(answer.view!.reads.logged).toBe(ExposureReadsLogged.Unknown);
    expect(answer.view!.reads.isTreatedAsRead).toBe(true);
  });
});

/*
 * WHO READ IT, FROM THE STORE'S OWN ACCESS LOGS (#10951). The bucket logs
 * its reads to acme-logs/logs/; S3 is stood in for by a reader of log
 * files in memory, the rest is the product's own: the window worked out,
 * the log files listed and read, the reads added up by who made them, kept
 * on the case, the breach laws' check answered, the timeline written - and
 * who read it named only for a reader who may see who can reach the store,
 * never to OneUptime AI.
 */
describe("who read it, from the store's own access logs", () => {
  const OUTSIDE: string = PLANTED["principal"]!;
  const OWN_ACCOUNT: string = "123456789012";
  const OBJECT_KEY: string = "exports/PLANTED-OBJECT-customers.csv";
  let opened: SpyInstance<typeof ExposureAssessmentReader.openStoreLogs>;

  function logLine(data: {
    time: string;
    requester?: string;
    ip?: string;
  }): string {
    return `79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be eu-customer-exports [${data.time}] ${data.ip || "203.0.113.77"} ${data.requester || "-"} 3E57427F3EXAMPLE REST.GET.OBJECT ${OBJECT_KEY} "GET /eu-customer-exports/${OBJECT_KEY} HTTP/1.1" 200 - 1048576 1048576 12 10 "-" "curl/8.4.0" - hostid= SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader eu-customer-exports.s3.eu-west-1.amazonaws.com TLSv1.2 - -`;
  }

  // The log bucket's files: three reads by anyone, two by an outside account, one of the company's own.
  const LOG_FILES: Record<string, string> = {
    "logs/2026-11-03-10-00-00-AAAA": [
      logLine({ time: "03/Nov/2026:09:30:00 +0000" }),
      logLine({ time: "03/Nov/2026:09:31:00 +0000", ip: "198.51.100.9" }),
      logLine({ time: "03/Nov/2026:09:32:00 +0000", requester: OUTSIDE }),
    ].join("\n"),
    "logs/2026-11-07-10-00-00-BBBB": [
      logLine({ time: "07/Nov/2026:09:30:00 +0000" }),
      logLine({ time: "07/Nov/2026:09:40:00 +0000", requester: OUTSIDE }),
      logLine({
        time: "07/Nov/2026:09:50:00 +0000",
        requester: `arn:aws:iam::${OWN_ACCOUNT}:role/exports-job`,
      }),
    ].join("\n"),
  };

  function memoryReader(files: Record<string, string>): S3LogReader {
    return {
      readLoggingTarget: async (): Promise<S3LoggingTarget | null> => {
        return { bucket: "acme-logs", prefix: "logs/", isPartitioned: false };
      },
      listLogObjects: async (data: {
        bucket: string;
        prefix: string;
        startAfter?: string | undefined;
      }): Promise<{ keys: Array<string> }> => {
        return {
          keys: Object.keys(files)
            .filter((key: string): boolean => {
              return (
                key.startsWith(data.prefix) &&
                (!data.startAfter || key > data.startAfter)
              );
            })
            .sort(),
        };
      },
      readLogObject: async (data: { key: string }): Promise<Uint8Array> => {
        return new TextEncoder().encode(files[data.key] || "");
      },
    };
  }

  async function readLogs(
    props: DatabaseCommonInteractionProps = OWNER,
  ): Promise<DataSecurityExposureAssessmentResponse> {
    return await ExposureAssessmentDrafter.readLogsForPerson({
      projectId: PROJECT_ID,
      securityCaseId: new ObjectID(CASE_ID),
      props,
      now: NOW,
    });
  }

  // A reader of the case, the store and its findings - not of who can reach the store.
  const NARROW: DatabaseCommonInteractionProps = caller([
    Permission.ReadSecurityCase,
    Permission.ReadDataStore,
    Permission.ReadDataStoreFinding,
  ]);

  beforeEach(() => {
    useTables({
      stores: [storeRow({ posture: { accessLogging: true } })],
      cases: [caseRow({ exposureAssessment: startedAssessment() })],
    });
    opened = jest
      .spyOn(ExposureAssessmentReader, "openStoreLogs")
      .mockResolvedValue({
        reader: memoryReader(LOG_FILES),
        ownAccountIds: new Set([OWN_ACCOUNT]),
        sourceAccountId: OWN_ACCOUNT,
        sourceRegion: "eu-west-1",
      });
  });

  test("a person reads them for the window: the case keeps the counts, and the data counts as read", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await readLogs();
    const reads: ExposureReads = answer.view!.reads;

    expect(reads.logged).toBe(ExposureReadsLogged.Logged);
    expect(reads.fromLogs?.status).toBe(ExposureLogReadStatus.Read);
    expect(reads.isFromLogsCurrent).toBe(true);
    expect(reads.isReadFromOutside).toBe(true);
    expect(reads.isTreatedAsRead).toBe(true);
    expect(getReadsFromOutside(reads.fromLogs!)).toEqual({
      reads: 5,
      bytes: 5 * 1048576,
      objects: 2,
    });
    expect(reads.fromLogs?.anonymous.addresses).toBe(2);
    expect(reads.fromLogs?.outside.accounts).toBe(1);
    expect(reads.fromLogs?.own.reads).toBe(1);
    expect(reads.fromLogs?.logFilesRead).toBe(2);
    expect(reads.fromLogs?.isComplete).toBe(true);
    // Read for the window the case's timeline and response give it.
    expect(reads.fromLogs?.windowStart).toBe(answer.view!.window!.start);
    expect(reads.fromLogs?.windowEnd).toBe(answer.view!.window!.end);
    expect(opened).toHaveBeenCalledTimes(1);

    expect(kept()!.logRead?.outside.reads).toBe(2);
    expect(kept()!.logRead?.anonymous.reads).toBe(3);
    expectNothingSent();
  });

  test("reads from outside answer the breach laws' question of whether it was read, so nobody is asked it", async () => {
    const before: DataSecurityExposureAssessmentResponse = await read();
    const after: DataSecurityExposureAssessmentResponse = await readLogs();
    const checksOf: (
      answer: DataSecurityExposureAssessmentResponse,
    ) => Array<string> = (
      answer: DataSecurityExposureAssessmentResponse,
    ): Array<string> => {
      return answer
        .view!.obligations.find((obligation: BreachObligation): boolean => {
          return obligation.ruleId === BreachLawId.GdprAuthority;
        })!
        .checks.map((check: { kind: string }): string => {
          return check.kind;
        });
    };

    expect(checksOf(before)).toContain(BreachCheckKind.ReadFromOutside);
    expect(checksOf(after)).not.toContain(BreachCheckKind.ReadFromOutside);
  });

  test("the timeline says what the logs show, counted, never who", async () => {
    await readLogs();

    const line: string = timelineLines().join("\n");

    expect(line).toContain(
      "read the store's access logs for the exposure's window",
    );
    expect(line).toContain("5 reads from outside your accounts");
    expectNoPlantedValue(line);
    expect(line).not.toContain("203.0.113.77");
    expect(line).not.toContain(OBJECT_KEY);
  });

  test("who read it is named only for a reader who may see who can reach the store", async () => {
    await readLogs();

    const owner: DataSecurityExposureAssessmentResponse = await read(OWNER);

    expect(
      owner.view!.reads.fromLogs!.outsidePrincipals.map(
        (principal: { principal: string }): string => {
          return principal.principal;
        },
      ),
    ).toEqual([OUTSIDE]);
    expect(owner.assessment!.logRead!.outsidePrincipals).toHaveLength(1);

    const narrow: DataSecurityExposureAssessmentResponse = await read(NARROW);

    expect(narrow.view!.reads.fromLogs!.outsidePrincipals).toEqual([]);
    expect(narrow.assessment!.logRead!.outsidePrincipals).toEqual([]);
    // Counted all the same.
    expect(narrow.view!.reads.fromLogs!.outside.reads).toBe(2);
    expect(JSON.stringify(narrow)).not.toContain(OUTSIDE);
    // A reader with who-can-reach-it reads them by name too.
    expect(
      (
        await read(
          caller([
            Permission.ReadSecurityCase,
            Permission.ReadDataStore,
            Permission.ReadDataStoreFinding,
            Permission.ReadDataStoreAccess,
          ]),
        )
      ).view!.reads.fromLogs!.outsidePrincipals,
    ).toHaveLength(1);
  });

  test("no object's name, address or line of the log is kept, or answered to anyone", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await readLogs();
    const keptText: string = JSON.stringify(
      tables.cases.get(CASE_ID)!["exposureAssessment"],
    );

    for (const text of [keptText, JSON.stringify(answer)]) {
      expect(text).not.toContain(OBJECT_KEY);
      expect(text).not.toContain("203.0.113.77");
      expect(text).not.toContain("198.51.100.9");
      expect(text).not.toContain("curl/8.4.0");
    }
  });

  test("OneUptime AI is told the counts, never who read it", async () => {
    await readLogs();
    answerOf = (): string => {
      return "{}";
    };

    await refusalOf(() => {
      return draftForPerson(OWNER);
    });

    const prompt: string = JSON.stringify(promptAsked());

    expect(prompt).toContain('"logsRead":true');
    expect(prompt).toContain('"readsFromOutside":5');
    expect(prompt).toContain('"anonymousReads":3');
    expect(prompt).toContain('"outsideAccountReads":2');
    expect(prompt).toContain('"outsideAccountsThatRead":1');
    expectNoPlantedValue(prompt);
    expect(prompt).not.toContain(OBJECT_KEY);
    expect(prompt).not.toContain("203.0.113.77");
  });

  test("a Security viewer may not read them: reading them changes the case", async () => {
    const refusal: Error = await refusalOf(() => {
      return readLogs(SECURITY_VIEWER);
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal.message).toBe(CHANGE_REFUSED_MESSAGE);
    expect(opened).not.toHaveBeenCalled();
    expect(kept()!.logRead).toBeUndefined();
  });

  test("a case not assessed yet has no window to read them for", async () => {
    useTables({ stores: [storeRow({ posture: { accessLogging: true } })] });

    const refusal: Error = await refusalOf(() => {
      return readLogs();
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(NOT_ASSESSED_MESSAGE);
  });

  test("logs the store's connection may not read are said so, and the data is not counted as read or unread by them", async () => {
    opened.mockResolvedValue(ExposureLogUnreadReason.NoContentAccess);

    const answer: DataSecurityExposureAssessmentResponse = await readLogs();

    expect(answer.view!.reads.fromLogs?.status).toBe(
      ExposureLogReadStatus.NotReadable,
    );
    expect(answer.view!.reads.fromLogs?.reason).toBe(
      ExposureLogUnreadReason.NoContentAccess,
    );
    expect(answer.view!.reads.isReadFromOutside).toBeUndefined();
    expect(answer.view!.reads.isTreatedAsRead).toBe(false);
    expect(timelineLines().join("\n")).toContain("they could not be read");
  });

  test("a read that fails is a read that could not be made, never an error", async () => {
    opened.mockRejectedValue(new Error("The connection's secret is gone."));

    const answer: DataSecurityExposureAssessmentResponse = await readLogs();

    expect(answer.view!.reads.fromLogs?.reason).toBe(
      ExposureLogUnreadReason.LogsUnreadable,
    );
  });

  test("on its own, as Data Security assesses a case, it reads the logs of a store that logs its reads - and of no other", async () => {
    const read: ExposureLogRead | null =
      await ExposureAssessmentDrafter.readLogsOnItsOwn({
        projectId: PROJECT_ID,
        securityCaseId: new ObjectID(CASE_ID),
        now: NOW,
      });

    expect(read?.status).toBe(ExposureLogReadStatus.Read);
    expect(kept()!.logRead?.anonymous.reads).toBe(3);
    expect(timelineLines().join("\n")).toContain(
      "Data Security read the store's access logs",
    );

    opened.mockClear();
    useTables({
      stores: [storeRow({ posture: { accessLogging: false } })],
      cases: [caseRow({ exposureAssessment: startedAssessment() })],
    });

    expect(
      await ExposureAssessmentDrafter.readLogsOnItsOwn({
        projectId: PROJECT_ID,
        securityCaseId: new ObjectID(CASE_ID),
        now: NOW,
      }),
    ).toBeNull();
    expect(opened).not.toHaveBeenCalled();
    expect(kept()!.logRead).toBeUndefined();
  });

  test("the logs of a store OneUptime cannot read them for are not opened: another kind, logging off, no connection", async () => {
    opened.mockRestore();

    const open: (data: {
      kind?: string;
      accessLogging: boolean;
    }) => Promise<unknown> = async (data: {
      kind?: string;
      accessLogging: boolean;
    }): Promise<unknown> => {
      const store: DataStore = new DataStore();

      store.kind = (data.kind || "AWS S3 Bucket") as never;
      store.name = "eu-customer-exports";
      store.posture = { accessLogging: data.accessLogging } as never;

      return await ExposureAssessmentReader.openStoreLogs({
        projectId: PROJECT_ID,
        store,
      });
    };

    expect(await open({ kind: "AWS RDS Instance", accessLogging: true })).toBe(
      ExposureLogUnreadReason.NotSupported,
    );
    expect(await open({ accessLogging: false })).toBe(
      ExposureLogUnreadReason.LoggingOff,
    );
    // A bucket no cloud connection reads: nothing reads its objects.
    expect(await open({ accessLogging: true })).toBe(
      ExposureLogUnreadReason.NoContentAccess,
    );
  });
});

describe("who sees it: the case's readers who may read the store and its findings", () => {
  beforeEach(async () => {
    useTables({
      cases: [caseRow({ exposureAssessment: startedAssessment() })],
    });
  });

  test.each([
    ["the project's owner", [Permission.ProjectOwner]],
    ["a project admin", [Permission.ProjectAdmin]],
    ["a Security admin", [Permission.SecurityAdmin]],
    ["a Security member", [Permission.SecurityMember]],
    ["a Security viewer", [Permission.SecurityViewer]],
    [
      "a role that reads the case, the store and its findings",
      [
        Permission.ReadSecurityCase,
        Permission.ReadDataStore,
        Permission.ReadDataStoreFinding,
      ],
    ],
  ])("%s reads it", async (_who: string, permissions: Array<Permission>) => {
    const answer: DataSecurityExposureAssessmentResponse = await read(
      caller(permissions),
    );

    expect(answer.view!.mostUrgent!.ruleId).toBe(BreachLawId.GdprAuthority);
  });

  test.each([
    ["only the case", [Permission.ReadSecurityCase]],
    [
      "the case and the store, not its findings",
      [Permission.ReadSecurityCase, Permission.ReadDataStore],
    ],
    [
      "the case and the findings, not the store",
      [Permission.ReadSecurityCase, Permission.ReadDataStoreFinding],
    ],
    [
      "the store and its findings, not the case",
      [Permission.ReadDataStore, Permission.ReadDataStoreFinding],
    ],
    ["a project member", [Permission.ProjectMember]],
    ["a project viewer", [Permission.Viewer]],
  ])(
    "a role that reads %s is refused, before anything is read",
    async (_who: string, permissions: Array<Permission>) => {
      const finds: SpyInstance<typeof SecurityCaseService.findOneBy> =
        jest.spyOn(SecurityCaseService, "findOneBy");
      const refusal: Error = await refusalOf(() => {
        return read(caller(permissions));
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal.message).toBe(READ_REFUSED_MESSAGE);
      expect(finds).not.toHaveBeenCalled();
    },
  );

  test("a Security viewer reads it, and may not change it", async () => {
    const answer: DataSecurityExposureAssessmentResponse =
      await read(SECURITY_VIEWER);

    expect(answer.canChange).toBe(false);
    expect(answer.canDraft).toBe(false);

    for (const change of [
      () => {
        return assess(SECURITY_VIEWER);
      },
      () => {
        return draftForPerson(SECURITY_VIEWER);
      },
      () => {
        return ExposureAssessmentDrafter.editPart({
          projectId: PROJECT_ID,
          securityCaseId: new ObjectID(CASE_ID),
          props: SECURITY_VIEWER,
          part: ExposureDraftPart.RegulatorNotice,
          markdown: "Our own words about what happened to the bucket.",
          now: NOW,
        });
      },
      () => {
        return ExposureAssessmentDrafter.setPeoplePlaces({
          projectId: PROJECT_ID,
          securityCaseId: new ObjectID(CASE_ID),
          props: SECURITY_VIEWER,
          places: [BreachPlace.UnitedKingdom],
          now: NOW,
        });
      },
      () => {
        return ExposureAssessmentDrafter.setDataHeldFor({
          projectId: PROJECT_ID,
          securityCaseId: new ObjectID(CASE_ID),
          props: SECURITY_VIEWER,
          forAnother: true,
          now: NOW,
        });
      },
    ]) {
      const refusal: Error = await refusalOf(change);

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal.message).toBe(CHANGE_REFUSED_MESSAGE);
    }

    expect(tables.cases.updates).toHaveLength(0);
    expect(asked).not.toHaveBeenCalled();
  });

  test("a role that edits the case and reads the store and its findings may change it", async () => {
    const props: DatabaseCommonInteractionProps = caller([
      Permission.ReadSecurityCase,
      Permission.EditSecurityCase,
      Permission.ReadDataStore,
      Permission.ReadDataStoreFinding,
    ]);
    const answer: DataSecurityExposureAssessmentResponse = await read(props);

    expect(answer.canChange).toBe(true);
    expect(answer.canDraft).toBe(true);
    expect(
      await ExposureAssessmentReader.mayChange({
        securityCaseId: new ObjectID(CASE_ID),
        props,
      }),
    ).toBe(true);
  });

  test("a role that edits the case but may not read the store's findings may not change it", async () => {
    expect(
      await ExposureAssessmentReader.mayChange({
        securityCaseId: new ObjectID(CASE_ID),
        props: caller([
          Permission.ReadSecurityCase,
          Permission.EditSecurityCase,
          Permission.ReadDataStore,
        ]),
      }),
    ).toBe(false);
  });

  /*
   * A change to the case is decided for the case's own row, as an update of
   * it is - not by holding the case's edit permission somewhere: a case
   * that is not the project's is changed by nobody.
   */
  test("whether a role may change it is asked of the case's own row", async () => {
    const props: DatabaseCommonInteractionProps = caller([
      Permission.ReadSecurityCase,
      Permission.EditSecurityCase,
      Permission.ReadDataStore,
      Permission.ReadDataStoreFinding,
    ]);
    const updatable: SpyInstance<
      typeof SecurityCaseService.findOneUpdatableById
    > = jest.spyOn(SecurityCaseService, "findOneUpdatableById");

    expect(
      await ExposureAssessmentReader.mayChange({
        securityCaseId: new ObjectID(CASE_ID),
        props,
      }),
    ).toBe(true);
    expect(updatable).toHaveBeenCalledTimes(1);
    expect(updatable.mock.calls[0]![0].id.toString()).toBe(CASE_ID);
    expect(updatable.mock.calls[0]![0].props).toBe(props);
    expect(
      await ExposureAssessmentReader.mayChange({
        securityCaseId: ObjectID.generate(),
        props,
      }),
    ).toBe(false);
  });

  /*
   * A change is decided by the case's own row, as an update of it through
   * the API would decide (SecurityCaseService.findOneUpdatableById) - not by
   * holding a case-editing permission somewhere in the project.
   */
  test("a credential issued for reading only may not change it, whatever its roles", async () => {
    const readOnly: DatabaseCommonInteractionProps = {
      ...OWNER,
      isReadOnlyCredential: true,
    };
    const answer: DataSecurityExposureAssessmentResponse = await read(readOnly);

    expect(answer.canChange).toBe(false);
    expect(answer.canDraft).toBe(false);

    const refusal: Error = await refusalOf(() => {
      return assess(readOnly);
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal.message).toBe(CHANGE_REFUSED_MESSAGE);
    expect(tables.cases.updates).toHaveLength(0);
  });

  test("a case in another project is not changed: it answers as one the caller may not change", async () => {
    const refusal: Error = await refusalOf(() => {
      return ExposureAssessmentDrafter.assess({
        projectId: PROJECT_ID,
        securityCaseId: ObjectID.generate(),
        props: OWNER,
        now: NOW,
      });
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal.message).toBe(CHANGE_REFUSED_MESSAGE);
    expect(tables.cases.updates).toHaveLength(0);
  });

  test("a case in another project is not found", async () => {
    const refusal: Error = await refusalOf(() => {
      return ExposureAssessmentDrafter.read({
        projectId: PROJECT_ID,
        securityCaseId: ObjectID.generate(),
        props: OWNER,
        now: NOW,
      });
    });

    expect(refusal).toBeInstanceOf(NotFoundException);
  });

  test("a reader who may not read the case's tasks sees the checklist without them", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await read(
      caller([
        Permission.ReadSecurityCase,
        Permission.ReadDataStore,
        Permission.ReadDataStoreFinding,
      ]),
    );

    expect(
      answer.checklist.map((line: ExposureChecklistAnswer) => {
        return line.taskId || null;
      }),
    ).toEqual([null, null, null, null]);
  });
});

describe("assessing a case", () => {
  test("read before it is assessed: the stores it is about, and nothing worked out", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await read();

    expect(answer.assessment).toBeNull();
    expect(answer.view).toBeNull();
    expect(answer.facts).toEqual([]);
    expect(answer.checklist).toEqual([]);
    expect(answer.stores).toEqual([
      {
        dataStoreId: STORE_ID,
        name: "eu-customer-exports",
        kind: "AWS S3 Bucket",
        sensitivity: "Confidential",
      },
    ]);
    expect(answer.canChange).toBe(true);
    expect(answer.canDraft).toBe(true);
    // Reading changes nothing.
    expect(tables.cases.updates).toHaveLength(0);
    expect(timeline).not.toHaveBeenCalled();
  });

  test("assessing it again changes nothing, and writes nothing on the timeline", async () => {
    await assess();
    await assess();

    expect(tables.cases.updates).toHaveLength(1);
    expect(timeline).toHaveBeenCalledTimes(1);
  });

  test("the timeline says it was assessed, and by whom, never what it found", async () => {
    await assess();

    const line: string = timelineLines()[0]!;

    expect(line).toContain("Alice Example");
    expect(line).toContain("Was It a Breach?");
    expect(timeline.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      eventType: SecurityCaseFeedEventType.ExposureAssessment,
      userId: USER_ID,
    });

    for (const finding of [
      "GDPR",
      "Email address",
      "72",
      "deploy/env.sh",
      "eu-customer-exports",
      "nine",
      "9 days",
    ]) {
      expect(line).not.toContain(finding);
    }
  });

  test("a case about two stores asks which; the store picked is assessed", async () => {
    useTables({
      cases: [
        caseRow({
          entities: [
            { type: "Data Store", value: getDataStoreEntityValue(STORE_KEY) },
            {
              type: "Data Store",
              value: getDataStoreEntityValue(OTHER_STORE_KEY),
            },
          ],
        }),
      ],
      stores: [
        storeRow(),
        storeRow({
          _id: OTHER_STORE_ID,
          name: "eu-invoices",
          storeKey: OTHER_STORE_KEY,
          sensitivity: "Restricted",
        }),
      ],
    });

    const refusal: Error = await refusalOf(() => {
      return assess();
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(PICK_A_STORE_MESSAGE);
    expect((await read()).stores).toHaveLength(2);

    const answer: DataSecurityExposureAssessmentResponse = await assess(
      OWNER,
      OTHER_STORE_ID,
    );

    expect(answer.dataStoreId).toBe(OTHER_STORE_ID);
    expect(answer.view!.store.name).toBe("eu-invoices");

    // Asked again for the first store, it starts over for that one.
    await assess(OWNER, STORE_ID);

    expect(kept()!.dataStoreId).toBe(STORE_ID);
  });

  test("a store the case is not about cannot be picked", async () => {
    const refusal: Error = await refusalOf(() => {
      return assess(OWNER, OTHER_STORE_ID);
    });

    expect(refusal).toBeInstanceOf(NotFoundException);
    expect(refusal.message).toBe(NOT_ABOUT_A_STORE_MESSAGE);
  });

  test("a case about no data store has nothing to assess", async () => {
    useTables({
      cases: [
        caseRow({ entities: [{ type: "IP Address", value: "1.2.3.4" }] }),
      ],
    });

    expect((await read()).stores).toEqual([]);

    const refusal: Error = await refusalOf(() => {
      return assess();
    });

    expect(refusal).toBeInstanceOf(NotFoundException);
    expect(refusal.message).toBe(NOT_ABOUT_A_STORE_MESSAGE);
  });

  test("an archived store is not one to assess", async () => {
    useTables({ stores: [storeRow({ isArchived: true })] });

    expect((await read()).stores).toEqual([]);
  });

  test("Data Security starts it on its own once, and never over one started", async () => {
    expect(
      await ExposureAssessmentDrafter.startOnItsOwn({
        projectId: PROJECT_ID,
        securityCaseId: new ObjectID(CASE_ID),
        dataStoreId: new ObjectID(STORE_ID),
        now: NOW,
      }),
    ).toBe(true);
    expect(kept()).toMatchObject({
      dataStoreId: STORE_ID,
      startedBy: ExposureAssessmentStarter.DataSecurity,
    });
    expect(kept()!.startedByUserId).toBeUndefined();
    expect(timelineLines()[0]).toContain(
      "Data Security assessed this exposure",
    );

    expect(
      await ExposureAssessmentDrafter.startOnItsOwn({
        projectId: PROJECT_ID,
        securityCaseId: new ObjectID(CASE_ID),
        dataStoreId: new ObjectID(OTHER_STORE_ID),
        now: NOW,
      }),
    ).toBe(false);
    expect(kept()!.dataStoreId).toBe(STORE_ID);
    expect(tables.cases.updates).toHaveLength(1);
  });

  test("the store the assessment is about stays readable though the case no longer names it", async () => {
    useTables({
      cases: [
        caseRow({
          entities: [],
          exposureAssessment: startedAssessment(),
        }),
      ],
    });

    const answer: DataSecurityExposureAssessmentResponse = await read();

    expect(
      answer.stores.map((store: { dataStoreId: string }) => {
        return store.dataStoreId;
      }),
    ).toEqual([STORE_ID]);
    expect(answer.view!.window!.days).toBe(9);
  });
});

describe("where the people live", () => {
  beforeEach(() => {
    useTables({
      stores: [storeRow({ subjectCountries: [] })],
      cases: [caseRow({ exposureAssessment: startedAssessment() })],
    });
  });

  async function setPlaces(
    places: Array<unknown>,
  ): Promise<DataSecurityExposureAssessmentResponse> {
    return await ExposureAssessmentDrafter.setPeoplePlaces({
      projectId: PROJECT_ID,
      securityCaseId: new ObjectID(CASE_ID),
      props: OWNER,
      places,
      now: NOW,
    });
  }

  test("nobody knows: nothing is due first, and every place is asked", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await read();

    expect(answer.view!.isPlaceUnknown).toBe(true);
    expect(answer.view!.mostUrgent).toBeNull();
  });

  test("a person says the United Kingdom: UK GDPR's 72 hours is due first, and only places the table knows are kept", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await setPlaces([
      BreachPlace.UnitedKingdom,
      "Atlantis",
      BreachPlace.UnitedKingdom,
    ]);

    expect(answer.assessment!.peopleLiveIn!.places).toEqual([
      BreachPlace.UnitedKingdom,
    ]);
    expect(answer.assessment!.peopleLiveIn!.saidByUserId).toBe(
      USER_ID.toString(),
    );
    expect(answer.view!.isPlaceUnknown).toBe(false);
    expect(answer.view!.mostUrgent!.ruleId).toBe(BreachLawId.UkGdprAuthority);
    expect(answer.editors[USER_ID.toString()]).toBe("Alice Example");

    const line: string = timelineLines()[0]!;

    expect(line).toContain("said where the people");
    expect(line).not.toContain("United Kingdom");
  });

  test("none takes the answer back", async () => {
    await setPlaces([BreachPlace.UnitedKingdom]);

    const answer: DataSecurityExposureAssessmentResponse = await setPlaces([]);

    expect(answer.assessment!.peopleLiveIn).toBeUndefined();
    expect(answer.view!.isPlaceUnknown).toBe(true);
  });

  test("a case not assessed yet has no answer to keep", async () => {
    useTables();

    const refusal: Error = await refusalOf(() => {
      return setPlaces([BreachPlace.UnitedKingdom]);
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(NOT_ASSESSED_MESSAGE);
  });
});

describe("whether the organization holds the data for another (#11427)", () => {
  beforeEach(() => {
    useTables({
      cases: [caseRow({ exposureAssessment: startedAssessment() })],
    });
  });

  async function setHeldFor(
    forAnother: unknown,
  ): Promise<DataSecurityExposureAssessmentResponse> {
    return await ExposureAssessmentDrafter.setDataHeldFor({
      projectId: PROJECT_ID,
      securityCaseId: new ObjectID(CASE_ID),
      props: OWNER,
      forAnother,
      now: NOW,
    });
  }

  function ruleIds(
    answer: DataSecurityExposureAssessmentResponse,
  ): Array<string> {
    return answer.view!.obligations.map(
      (obligation: BreachObligation): string => {
        return obligation.ruleId;
      },
    );
  }

  function uncoveredKinds(
    answer: DataSecurityExposureAssessmentResponse,
  ): Array<string> {
    return answer.view!.uncovered.map((law: { kind: string }): string => {
      return law.kind;
    });
  }

  test("nobody said: the EU customers' processor notice is left out, and the card says what it waits on", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await read();

    expect(answer.assessment!.dataHeldFor).toBeUndefined();
    expect(answer.view!.holdsForAnother).toBeUndefined();
    expect(ruleIds(answer)).not.toContain(BreachLawId.GdprProcessor);
    expect(uncoveredKinds(answer)).toContain("DataHeldForAnother");
  });

  test("a person says it holds the data for another: GDPR's processor notice may apply, kept with who said it, and the timeline says so", async () => {
    const answer: DataSecurityExposureAssessmentResponse =
      await setHeldFor(true);

    expect(answer.assessment!.dataHeldFor).toEqual({
      forAnother: true,
      saidAt: NOW.toISOString(),
      saidByUserId: USER_ID.toString(),
    });
    expect(answer.view!.holdsForAnother).toBe(true);
    expect(mayApply(answer.view!.obligations, true)).toContain(
      BreachLawId.GdprProcessor,
    );
    expect(uncoveredKinds(answer)).not.toContain("DataHeldForAnother");
    expect(answer.editors[USER_ID.toString()]).toBe("Alice Example");

    // The case keeps the answer, and only the assessment changed.
    const kept: StoredExposureAssessment = readStoredExposureAssessment(
      tables.cases.updates[tables.cases.updates.length - 1]!.set[
        "exposureAssessment"
      ],
    )!;

    expect(kept.dataHeldFor?.forAnother).toBe(true);

    const line: string = timelineLines()[0]!;

    expect(line).toContain("holds the exposed data for another organization");
    expect(line).toContain("notices owed to the data's owner");
    expectNoPlantedValue(line);
  });

  test("a person says the data is the organization's own: no notice to an owner, and nothing waits on it", async () => {
    const answer: DataSecurityExposureAssessmentResponse =
      await setHeldFor(false);

    expect(answer.assessment!.dataHeldFor!.forAnother).toBe(false);
    expect(answer.view!.holdsForAnother).toBe(false);
    expect(ruleIds(answer)).not.toContain(BreachLawId.GdprProcessor);
    expect(uncoveredKinds(answer)).not.toContain("DataHeldForAnother");
    expect(timelineLines()[0]).toContain("is the organization's own");
  });

  test("anything but true or false takes the answer back, and the timeline says it was taken back", async () => {
    await setHeldFor(true);

    for (const takenBack of [null, "yes", 1]) {
      const answer: DataSecurityExposureAssessmentResponse =
        await setHeldFor(takenBack);

      expect(answer.assessment!.dataHeldFor).toBeUndefined();
      expect(answer.view!.holdsForAnother).toBeUndefined();
      expect(ruleIds(answer)).not.toContain(BreachLawId.GdprProcessor);
    }

    expect(timelineLines()[1]).toContain("took back the answer");
  });

  test("a case not assessed yet has no answer to keep", async () => {
    useTables();

    const refusal: Error = await refusalOf(() => {
      return setHeldFor(true);
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(NOT_ASSESSED_MESSAGE);
  });
});

describe("OneUptime AI's write-up, when a person asks", () => {
  beforeEach(() => {
    useTables({
      cases: [caseRow({ exposureAssessment: startedAssessment() })],
    });
  });

  async function factsNow(): Promise<Array<ComplianceFact>> {
    return (await read()).facts;
  }

  test("each part held to the facts is kept, for a person to edit, and the timeline says nothing was sent", async () => {
    const facts: Array<ComplianceFact> = await factsNow();

    answerOf = (): string => {
      return goodAnswer(facts);
    };

    const answer: DataSecurityExposureAssessmentResponse =
      await draftForPerson();

    expect(Object.keys(answer.assessment!.sections).sort()).toEqual(
      [
        ExposureDraftPart.Explanation,
        ExposureDraftPart.InternalSummary,
        ExposureDraftPart.PeopleNotice,
        ExposureDraftPart.RegulatorNotice,
      ].sort(),
    );
    expect(
      answer.assessment!.sections[ExposureDraftPart.RegulatorNotice],
    ).toMatchObject({
      source: ImpactAssessmentSectionSource.Drafted,
    });
    expect(
      answer.assessment!.sections[ExposureDraftPart.RegulatorNotice]!.markdown,
    ).toContain("[Company name]");
    expect(answer.staleParts).toEqual([]);
    expect(kept()!.sections[ExposureDraftPart.PeopleNotice]).toBeDefined();

    // Asked on request, by the person, for every part, with what is due first.
    const call: JSONObject = asked.mock.calls[0]![0] as unknown as JSONObject;
    const prompt: DataSecurityAiPrompt = promptAsked();

    expect(call["userId"]).toEqual(USER_ID);
    expect(prompt.feature).toBe(
      DataSecurityAiFeature.DraftExposureAssessmentOnRequest,
    );
    expect(writtenParts(prompt)).toEqual([
      ExposureDraftPart.Explanation,
      ExposureDraftPart.RegulatorNotice,
      ExposureDraftPart.PeopleNotice,
      ExposureDraftPart.InternalSummary,
    ]);
    expect(prompt.data["dueFirst"]).toBe(
      facts.find((fact: ComplianceFact): boolean => {
        return fact.key === `obligation:${BreachLawId.GdprAuthority}`;
      })!.id,
    );
    expectNoPlantedValue(JSON.stringify(prompt.messages));

    const line: string = timelineLines().pop()!;

    expect(line).toContain("Nothing was sent.");
    expect(line).not.toContain("[Company name]");
    expectNothingSent();
  });

  test("a part with a number the facts do not hold is dropped; the rest are kept", async () => {
    const facts: Array<ComplianceFact> = await factsNow();

    answerOf = (): string => {
      return goodAnswer(facts, undefined, {
        [ExposureDraftPart.PeopleNotice]:
          "About 90000 of our customers were affected, and we closed the bucket within 2 hours of hearing about it.",
      });
    };

    const answer: DataSecurityExposureAssessmentResponse =
      await draftForPerson();

    expect(
      answer.assessment!.sections[ExposureDraftPart.PeopleNotice],
    ).toBeUndefined();
    expect(
      answer.assessment!.sections[ExposureDraftPart.RegulatorNotice],
    ).toBeDefined();
  });

  test("a notice citing a law the facts do not name is dropped", async () => {
    const facts: Array<ComplianceFact> = await factsNow();

    answerOf = (): string => {
      return goodAnswer(facts, undefined, {
        [ExposureDraftPart.RegulatorNotice]:
          "Under the CCPA and HIPAA, [Company name] tells you that a storage bucket of customers' email addresses was open to anyone.",
      });
    };

    const answer: DataSecurityExposureAssessmentResponse =
      await draftForPerson();

    expect(
      answer.assessment!.sections[ExposureDraftPart.RegulatorNotice],
    ).toBeUndefined();
    expect(
      answer.assessment!.sections[ExposureDraftPart.Explanation],
    ).toBeDefined();
  });

  test("an answer that is not one, or holds nothing, keeps nothing and says so", async () => {
    answerOf = (): string => {
      return "Sure! Here is your notice: the bucket was open.";
    };

    const refusal: Error = await refusalOf(() => {
      return draftForPerson();
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(ANSWER_UNREAD_MESSAGE);
    expect(tables.cases.updates).toHaveLength(0);
    expect(timeline).not.toHaveBeenCalled();
  });

  test("a part a person edited is never asked for again, nor written over", async () => {
    await ExposureAssessmentDrafter.editPart({
      projectId: PROJECT_ID,
      securityCaseId: new ObjectID(CASE_ID),
      props: OWNER,
      part: ExposureDraftPart.RegulatorNotice,
      markdown: "Our own words to the regulator, as counsel wrote them.",
      now: NOW,
    });

    const facts: Array<ComplianceFact> = await factsNow();

    answerOf = (): string => {
      return goodAnswer(facts);
    };

    const answer: DataSecurityExposureAssessmentResponse =
      await draftForPerson();

    expect(writtenParts(promptAsked())).toEqual([
      ExposureDraftPart.Explanation,
      ExposureDraftPart.PeopleNotice,
      ExposureDraftPart.InternalSummary,
    ]);
    expect(
      answer.assessment!.sections[ExposureDraftPart.RegulatorNotice],
    ).toMatchObject({
      source: ImpactAssessmentSectionSource.Edited,
      markdown: "Our own words to the regulator, as counsel wrote them.",
      editedByUserId: USER_ID.toString(),
    });
    expect(answer.editors[USER_ID.toString()]).toBe("Alice Example");
  });

  test("with every part a person's, there is nothing to draft, and OneUptime AI is not asked", async () => {
    for (const part of [
      ExposureDraftPart.Explanation,
      ExposureDraftPart.RegulatorNotice,
      ExposureDraftPart.PeopleNotice,
      ExposureDraftPart.InternalSummary,
    ]) {
      await ExposureAssessmentDrafter.editPart({
        projectId: PROJECT_ID,
        securityCaseId: new ObjectID(CASE_ID),
        props: OWNER,
        part,
        markdown: "Our own words for this part of the assessment.",
        now: NOW,
      });
    }

    const refusal: Error = await refusalOf(() => {
      return draftForPerson();
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(NOTHING_TO_DRAFT_MESSAGE);
    expect(asked).not.toHaveBeenCalled();
    expect((await read()).canDraft).toBe(false);
  });

  test("with AI off for the project, OneUptime AI is not asked", async () => {
    aiEnabled.mockRejectedValue(
      new BadDataException("AI is turned off for this project."),
    );

    const refusal: Error = await refusalOf(() => {
      return draftForPerson();
    });

    expect(refusal.message).toBe("AI is turned off for this project.");
    expect(asked).not.toHaveBeenCalled();
  });

  test("a case not assessed yet is assessed first, then written up", async () => {
    useTables();

    // The facts the answer cites are the assessment's: F1 onwards.
    answerOf = (): string => {
      return JSON.stringify({
        [ExposureDraftPart.Explanation]: {
          markdown:
            "Anyone on the internet could read the bucket, and reads were not logged, so treat the data as read.",
          facts: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"],
        },
      });
    };

    const answer: DataSecurityExposureAssessmentResponse =
      await draftForPerson();

    expect(answer.assessment!.startedBy).toBe(ExposureAssessmentStarter.Person);
    expect(
      answer.assessment!.sections[ExposureDraftPart.Explanation],
    ).toBeDefined();
  });

  test("an answer to a part it was not asked is left out", async () => {
    await ExposureAssessmentDrafter.editPart({
      projectId: PROJECT_ID,
      securityCaseId: new ObjectID(CASE_ID),
      props: OWNER,
      part: ExposureDraftPart.PeopleNotice,
      markdown: "Our own words to the people the data is about.",
      now: NOW,
    });

    const facts: Array<ComplianceFact> = await factsNow();

    answerOf = (): string => {
      return goodAnswer(facts);
    };

    const answer: DataSecurityExposureAssessmentResponse =
      await draftForPerson();

    expect(
      answer.assessment!.sections[ExposureDraftPart.PeopleNotice]!.markdown,
    ).toBe("Our own words to the people the data is about.");
  });
});

describe("a person's own words", () => {
  beforeEach(() => {
    useTables({
      cases: [caseRow({ exposureAssessment: startedAssessment() })],
    });
  });

  async function edit(
    part: ExposureDraftPart,
    markdown: string,
  ): Promise<DataSecurityExposureAssessmentResponse> {
    return await ExposureAssessmentDrafter.editPart({
      projectId: PROJECT_ID,
      securityCaseId: new ObjectID(CASE_ID),
      props: OWNER,
      part,
      markdown,
      now: NOW,
    });
  }

  test("are kept as the part, theirs from then on; the timeline names the part, never the words", async () => {
    const answer: DataSecurityExposureAssessmentResponse = await edit(
      ExposureDraftPart.InternalSummary,
      "Counsel says we tell the authority by Thursday. Rotate the AWS key first.",
    );

    expect(
      answer.assessment!.sections[ExposureDraftPart.InternalSummary],
    ).toMatchObject({
      source: ImpactAssessmentSectionSource.Edited,
      editedByUserId: USER_ID.toString(),
    });

    const line: string = timelineLines()[0]!;

    expect(line).toContain("Internal Summary");
    expect(line).not.toContain("Thursday");
    expectNothingSent();
  });

  test("too long is refused, and nothing is kept", async () => {
    const refusal: Error = await refusalOf(() => {
      return edit(ExposureDraftPart.PeopleNotice, "x".repeat(20001));
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(tables.cases.updates).toHaveLength(0);
  });

  test("a case not assessed yet has no part to keep", async () => {
    useTables();

    const refusal: Error = await refusalOf(() => {
      return edit(
        ExposureDraftPart.PeopleNotice,
        "Our own words to the people.",
      );
    });

    expect(refusal.message).toBe(NOT_ASSESSED_MESSAGE);
  });
});

describe("OneUptime AI's write-up on its own", () => {
  beforeEach(() => {
    useTables({
      cases: [caseRow({ exposureAssessment: startedAssessment() })],
    });
  });

  async function draftOnItsOwn(
    llmProviderId?: string,
  ): Promise<ExposureDraftOutcome> {
    return await ExposureAssessmentDrafter.draftOnItsOwn({
      projectId: PROJECT_ID,
      securityCaseId: new ObjectID(CASE_ID),
      llmProviderId,
      now: NOW,
    });
  }

  test("writes every part up in the project's language, on the provider the rule picked, and sends nothing", async () => {
    const facts: Array<ComplianceFact> = (await read()).facts;
    const provider: string = ObjectID.generate().toString();

    answerOf = (): string => {
      return goodAnswer(facts);
    };

    const outcome: ExposureDraftOutcome = await draftOnItsOwn(provider);

    expect(outcome).toEqual({
      drafted: true,
      parts: [
        ExposureDraftPart.Explanation,
        ExposureDraftPart.RegulatorNotice,
        ExposureDraftPart.PeopleNotice,
        ExposureDraftPart.InternalSummary,
      ],
    });

    const call: JSONObject = asked.mock.calls[0]![0] as unknown as JSONObject;

    expect(call["protectRequestParameters"]).toBe(true);
    expect(call["rulePickedProviderId"]).toBe(provider);
    expect(call["userId"]).toBeUndefined();
    expect(promptAsked().feature).toBe(
      DataSecurityAiFeature.DraftExposureAssessment,
    );
    expect(kept()!.sections[ExposureDraftPart.RegulatorNotice]).toBeDefined();
    expect(timelineLines().pop()).toContain("Nothing was sent.");
    expectNothingSent();
  });

  test.each([
    ["provider_missing", ExposureDraftSkip.NoLlmProvider],
    ["insufficient_ai_balance", ExposureDraftSkip.NoAiCredits],
  ])(
    "with %s, writes nothing",
    async (blocker: string, reason: ExposureDraftSkip) => {
      jest
        .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
        .mockResolvedValue(blocker as never);

      expect(await draftOnItsOwn()).toEqual({ drafted: false, reason });
      expect(asked).not.toHaveBeenCalled();
    },
  );

  test("with the project's daily limit reached, writes nothing", async () => {
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue({ limit: 1 } as never);

    expect(await draftOnItsOwn()).toEqual({
      drafted: false,
      reason: ExposureDraftSkip.AiDailyLimitReached,
    });
    expect(asked).not.toHaveBeenCalled();
  });

  test("a case not assessed has nothing to write up", async () => {
    useTables();

    expect(await draftOnItsOwn()).toEqual({
      drafted: false,
      reason: ExposureDraftSkip.NotAssessed,
    });
  });

  test("an answer that holds nothing keeps nothing", async () => {
    answerOf = (): string => {
      return "not json";
    };

    expect(await draftOnItsOwn()).toEqual({
      drafted: false,
      reason: ExposureDraftSkip.NothingHeld,
    });
    expect(tables.cases.updates).toHaveLength(0);
  });

  test("a failure is caught and logged: it never throws", async () => {
    asked.mockRejectedValue(new Error("The provider is down."));

    expect(await draftOnItsOwn()).toEqual({
      drafted: false,
      reason: ExposureDraftSkip.Failed,
    });
  });

  test("a part a person wrote while OneUptime AI worked keeps their words", async () => {
    const facts: Array<ComplianceFact> = (await read()).facts;

    asked.mockImplementation((async () => {
      // A person saves the regulator's notice while the model writes.
      await ExposureAssessmentDrafter.editPart({
        projectId: PROJECT_ID,
        securityCaseId: new ObjectID(CASE_ID),
        props: OWNER,
        part: ExposureDraftPart.RegulatorNotice,
        markdown: "Counsel's own words to the regulator, saved meanwhile.",
        now: NOW,
      });

      return { content: goodAnswer(facts) };
    }) as never);

    await draftOnItsOwn();

    expect(kept()!.sections[ExposureDraftPart.RegulatorNotice]).toMatchObject({
      source: ImpactAssessmentSectionSource.Edited,
      markdown: "Counsel's own words to the regulator, saved meanwhile.",
    });
    expect(kept()!.sections[ExposureDraftPart.PeopleNotice]).toMatchObject({
      source: ImpactAssessmentSectionSource.Drafted,
    });
  });
});

describe("the write-up goes stale when the facts change", () => {
  test("a draft written before the people's places were said is stale after", async () => {
    useTables({
      cases: [caseRow({ exposureAssessment: startedAssessment() })],
    });

    const facts: Array<ComplianceFact> = (await read()).facts;

    answerOf = (): string => {
      return goodAnswer(facts);
    };
    await draftForPerson();

    const answer: DataSecurityExposureAssessmentResponse =
      await ExposureAssessmentDrafter.setPeoplePlaces({
        projectId: PROJECT_ID,
        securityCaseId: new ObjectID(CASE_ID),
        props: OWNER,
        places: [BreachPlace.UnitedKingdom],
        now: NOW,
      });

    expect(answer.staleParts.length).toBeGreaterThan(0);
  });
});
