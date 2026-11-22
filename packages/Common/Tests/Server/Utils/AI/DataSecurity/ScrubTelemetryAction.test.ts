import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import Service from "../../../../../Models/DatabaseModels/Service";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import ScrubTelemetryAction, {
  getScrubPlanKey,
  MAX_SCRUB_PLACES_PER_PROPOSAL,
  readScrubPlan,
  readScrubResult,
  ScrubLane,
  ScrubPlan,
} from "../../../../../Server/Utils/AI/DataSecurity/Actions/ScrubTelemetryAction";
import { ScrubWaitReason } from "../../../../../Server/Utils/AI/DataSecurity/Actions/ScrubTelemetryPlan";
import {
  DataSecurityAiChangeMade,
  DataSecurityAiIssueContext,
  DataSecurityAiPlanOutcome,
  DataSecurityAiPlannedChange,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiAction";
import DataSecurityAiActions from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiActions";
import ScrubRuleWriter from "../../../../../Server/Utils/AI/DataSecurity/ScrubRuleWriter";
import DataSecurityContainmentNotice from "../../../../../Server/Utils/DataSecurity/DataSecurityContainmentNotice";
import * as IssueFindings from "../../../../../Server/Utils/DataSecurity/DataSecurityIssueFindings";
import * as Jobs from "../../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import DataSecurityRunner from "../../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import { ContentScanOptions } from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import * as ScrubCoverage from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import * as ScrubImpact from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubImpact";
import * as ScrubIt from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubIt";
import * as ScrubPlanModule from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlan";
import * as ScrubShapes from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubShapes";
import { ScrubRuleSource } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlanner";
import logger from "../../../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import {
  DATA_SECURITY_AI_PROPOSAL_KINDS,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import {
  ScrubRuleWriterPlace,
  ScrubRuleWriterRuleKind,
} from "../../../../../Types/DataSecurity/ScrubRuleWriterPlace";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import {
  getScrubRuleFingerprint,
  ScrubRuleProof,
  SCRUB_RULE_PROOF_VERSION,
} from "../../../../../Types/Telemetry/ScrubRuleProof";
import { SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE } from "../../../../../Types/Telemetry/ScrubRuleKeys";
import {
  TELEMETRY_FIELD_READER_KINDS,
  TelemetryFieldReaderKind,
  TelemetryFieldReaders,
  TelemetryFieldReadersByKind,
} from "../../../../../Types/Telemetry/TelemetryFieldReaders";
import FeedMarkdown from "../../../../../Utils/Markdown/FeedMarkdown";
import { htmlAsText } from "../../../../Helpers/HtmlText";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import { marked } from "marked";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * CONTAINING A TELEMETRY ISSUE (#10364, #10366): what is planned from the
 * places the issue's check counts - each place's proven rule, as Scrub It
 * makes it, merged where one rule does what each would - which lane each
 * rule is in, and so whether it runs on its own; what OneUptime AI writes
 * where none of Scrub It's rules fits; who may approve and undo; making
 * and taking back exactly the rules it made; and who is told of a change
 * made without asking. The services are stood in for; the lanes, the
 * merging and the words are the action's own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10364000-0000-4000-8000-000000000001",
);
const STORE_ID: ObjectID = new ObjectID("10364000-0000-4000-8000-0000000000b1");
const SERVICE_ID: ObjectID = new ObjectID(
  "10364000-0000-4000-8000-0000000000e1",
);
const ISSUE_ID: ObjectID = new ObjectID("10364000-0000-4000-8000-0000000000a1");
const EMAIL_FINDING: string = "10364000-0000-4000-8000-0000000004a1";
const TOKEN_FINDING: string = "10364000-0000-4000-8000-0000000004a2";
const SESSION_FINDING: string = "10364000-0000-4000-8000-0000000004a3";
const PASSWORD_FINDING: string = "10364000-0000-4000-8000-0000000004a4";
const API_KEY_FINDING: string = "10364000-0000-4000-8000-0000000004a5";
const NAME_FINDING: string = "10364000-0000-4000-8000-0000000004a6";
const MADE_RULE: string = "10364000-0000-4000-8000-0000000005a1";
const EXISTING_RULE: string = "10364000-0000-4000-8000-0000000005a2";

const OPTIONS: ContentScanOptions = {
  limits: {
    maxObjects: 2000,
    maxBytesPerObject: 65536,
    maxBytesTotal: 52428800,
    maxRowsPerTable: 1000,
    maxTables: 200,
    deadline: new Date("2026-11-20T11:00:00.000Z"),
  },
  customDetectors: [],
  extraHints: [],
  disabledDataTypeIds: new Set<string>(),
  allowedValues: new Set<string>(),
  exclusions: [],
  fingerprintKey: "scrub-action-test",
};

function finding(
  id: string,
  dataTypeId: string,
  location: string,
  matchCount: number,
  dataCategory?: DataCategory,
): DataStoreFinding {
  return {
    id: new ObjectID(id),
    dataTypeId,
    location,
    matchCount,
    dataCategory,
    lastSeenAt: new Date("2026-11-20T09:40:00.000Z"),
  } as unknown as DataStoreFinding;
}

function context(
  overrides: {
    issue?: Partial<DataSecurityIssue>;
    store?: Partial<DataStore>;
  } = {},
): DataSecurityAiIssueContext {
  return {
    projectId: PROJECT_ID,
    issue: {
      id: ISSUE_ID,
      checkId: "sensitive-data-in-telemetry",
      title: "Sensitive data in telemetry",
      dataStoreId: STORE_ID,
      ...overrides.issue,
    } as unknown as DataSecurityIssue,
    store: {
      id: STORE_ID,
      name: "checkout logs",
      kind: DataStoreKind.TelemetryLogs,
      serviceId: SERVICE_ID,
      ...overrides.store,
    } as unknown as DataStore,
    dataTypeNamer: DataTypeNamer.withoutCustomTypes(),
    now: new Date("2026-11-20T10:00:00Z"),
  };
}

function proposalWith(data: {
  plan?: ScrubPlan | unknown;
  result?: unknown;
  title?: string;
}): DataSecurityAiProposal {
  return {
    id: new ObjectID("10364000-0000-4000-8000-0000000003a1"),
    kind: DataSecurityAiProposalKind.ScrubTelemetry,
    dataStoreId: STORE_ID,
    dataSecurityIssueId: ISSUE_ID,
    title: data.title || "Scrub Password in attributes.db.password",
    plan: data.plan,
    result: data.result,
  } as unknown as DataSecurityAiProposal;
}

// A plan made before #10366: places only.
const EMAIL_PLAN_V1: ScrubPlan = {
  kind: DataStoreKind.TelemetryLogs,
  serviceId: SERVICE_ID.toString(),
  places: [
    {
      findingId: EMAIL_FINDING,
      dataTypeId: "email-address",
      location: "attributes.user.email",
      signal: "log",
    },
  ],
};

// Nothing reads anything, and everything could be read.
function readers(
  counts: Partial<Record<TelemetryFieldReaderKind, number>> = {},
  securityEventsLoses: boolean = false,
): TelemetryFieldReaders {
  const kinds: Partial<TelemetryFieldReadersByKind> = {};

  for (const kind of TELEMETRY_FIELD_READER_KINDS) {
    kinds[kind] = {
      readers: Array.from(
        { length: counts[kind] || 0 },
        (_v: unknown, i: number) => {
          return { id: `reader-${i}`, name: `Reader ${i}`, reads: [] };
        },
      ),
      hiddenCount: 0,
      isChecked: true,
    };
  }

  return {
    kinds: kinds as TelemetryFieldReadersByKind,
    securityEvents: {
      isChecked: true,
      sources: [],
      loses: securityEventsLoses ? ["clientAddress" as never] : [],
    },
  };
}

// A proof of one place: it hid every value that held the data, and changed `changed` others.
function proofOf(data: {
  findingId: string;
  dataTypeId: string;
  location: string;
  attributeKeys?: Array<string>;
  patternType?: string;
  scrubAction?: string;
  changed?: number;
}): ScrubRuleProof {
  return {
    version: SCRUB_RULE_PROOF_VERSION,
    provenAt: "2026-11-20T10:00:00.000Z",
    fingerprint: getScrubRuleFingerprint({
      signal: "log",
      patternType: data.patternType || SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
      attributeKeys: data.attributeKeys,
      scrubAction: data.scrubAction || LogScrubAction.Redact,
      fieldsToScrub: LogScrubField.Attributes,
      serviceId: SERVICE_ID.toString(),
    }),
    places: [
      {
        dataTypeId: data.dataTypeId,
        location: data.location,
        kind: DataStoreKind.TelemetryLogs,
        findingId: data.findingId,
      },
    ],
    findingRecordsRead: 2,
    recordsRead: 12,
    valuesWithData: 5,
    valuesStillWithData: 0,
    otherValues: 7,
    otherValuesChanged: data.changed || 0,
  };
}

const SCOPE: ScrubCoverage.ScrubRuleScopeOfFinding = {
  serviceId: SERVICE_ID,
  serviceName: "checkout",
};

// A secret under its attribute, hidden whole: the planner's Named Attributes rule, proven.
function namedKeysRule(data: {
  findingId: string;
  dataTypeId: string;
  key: string;
  dataTypeName: string;
  scrubAction?: string;
  changed?: number;
  proven?: boolean;
  source?: ScrubRuleSource;
}): ScrubIt.ProvenScrubItRule {
  const action: string = data.scrubAction || LogScrubAction.Redact;

  return {
    signal: "log",
    plan: {
      patternType: SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
      attributeKeys: [data.key],
      scrubAction: action,
      fieldsToScrub: LogScrubField.Attributes,
    },
    dataTypeId: data.dataTypeId,
    dataTypeName: data.dataTypeName,
    scope: SCOPE,
    name: `Data Security: ${data.dataTypeName} in ${data.key} of checkout`,
    description: `Made by OneUptime AI (Data Security) from a finding of ${data.dataTypeName} in attributes.${data.key} (TelemetryLogs). It redacts the whole value of ${data.key}, whatever it holds, from now on.`,
    source: data.source || ScrubRuleSource.NamedKeys,
    proof:
      data.proven === false
        ? null
        : proofOf({
            findingId: data.findingId,
            dataTypeId: data.dataTypeId,
            location: `attributes.${data.key}`,
            attributeKeys: [data.key],
            scrubAction: action,
            changed: data.changed,
          }),
    overreach: null,
    findingId: data.findingId,
  };
}

let counted: Array<DataStoreFinding>;
let coverageRules: Array<ScrubCoverage.CoveringScrubRule>;
let created: SpyInstance<typeof ScrubCoverage.createScrubRuleForFinding>;
let saved: SpyInstance<typeof ScrubIt.saveProvenScrubItRule>;
let marks: Array<{ id: string; isScrubbed: unknown }>;
let evaluations: SpyInstance<typeof Jobs.queueDataSecurityEvaluation>;
let readersFound: TelemetryFieldReaders;
let earlierProposals: Array<Partial<DataSecurityAiProposal>>;

beforeEach(() => {
  counted = [];
  coverageRules = [];
  marks = [];
  readersFound = readers();
  earlierProposals = [];

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  // The store's service, whose rule each one is and after which it is named (#10433).
  jest.spyOn(ServiceService, "findOneBy").mockImplementation((async () => {
    const service: Service = new Service(SERVICE_ID);
    service.name = "checkout";

    return service;
  }) as never);
  jest
    .spyOn(IssueFindings, "readCountedTelemetryFindings")
    .mockImplementation(async () => {
      return counted;
    });
  jest.spyOn(ScrubCoverage, "getScrubCoverage").mockImplementation(async () => {
    return { rules: coverageRules };
  });
  jest
    .spyOn(DataSecurityRunner, "getScanSetup")
    .mockResolvedValue({ options: OPTIONS } as never);
  jest
    .spyOn(ScrubImpact, "findScrubRuleReaders")
    .mockImplementation(async () => {
      return readersFound;
    });
  jest
    .spyOn(DataSecurityAiProposalService, "findBy")
    .mockImplementation((async () => {
      return earlierProposals as Array<DataSecurityAiProposal>;
    }) as never);
  created = jest
    .spyOn(ScrubCoverage, "createScrubRuleForFinding")
    .mockImplementation(async () => {
      coverageRules.push({
        id: MADE_RULE,
        name: "Data Security: Email address in log attributes of checkout",
        signal: "log",
        patternType: "email",
        fieldsToScrub: "attributes",
      });

      return {
        signal: "log",
        scrubRuleId: MADE_RULE,
        scrubRuleName:
          "Data Security: Email address in log attributes of checkout",
      };
    });
  saved = jest
    .spyOn(ScrubIt, "saveProvenScrubItRule")
    .mockImplementation(async (data: { planned: { name: string } }) => {
      return {
        signal: "log",
        scrubRuleId: MADE_RULE,
        scrubRuleName: data.planned.name,
      };
    });
  jest
    .spyOn(DataStoreFindingService, "findOneBy")
    .mockImplementation((async (findBy: { query: { _id: ObjectID } }) => {
      return { id: findBy.query._id } as unknown as DataStoreFinding;
    }) as never);
  jest
    .spyOn(DataStoreFindingService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: { isScrubbed: unknown };
    }) => {
      marks.push({ id: data.id.toString(), isScrubbed: data.data.isScrubbed });
    }) as never);
  jest.spyOn(DataStoreService, "findOneById").mockImplementation((async () => {
    return {
      id: STORE_ID,
      name: "checkout logs",
      serviceId: SERVICE_ID,
    } as unknown as DataStore;
  }) as never);
  evaluations = jest
    .spyOn(Jobs, "queueDataSecurityEvaluation")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function changesOf(
  outcome: DataSecurityAiPlanOutcome,
): Array<DataSecurityAiPlannedChange> {
  expect(outcome.kind).toBe("planned");

  return (outcome as { changes: Array<DataSecurityAiPlannedChange> }).changes;
}

function laneOf(change: DataSecurityAiPlannedChange): ScrubLane | undefined {
  return readScrubPlan(change.plan)?.lane;
}

describe("Scrub It's place among the actions", () => {
  test("is its kind's one action: a contain change that only masks", () => {
    expect(
      DataSecurityAiActions.get(DataSecurityAiProposalKind.ScrubTelemetry),
    ).toBe(ScrubTelemetryAction);
    expect(
      DATA_SECURITY_AI_PROPOSAL_KINDS[ScrubTelemetryAction.kind].safety,
    ).toBe("MaskOnly");
    expect(DataSecurityAiActions.get("Unknown")).toBeNull();
  });

  test("every kind has exactly one action, its own", () => {
    for (const kind of Object.values(DataSecurityAiProposalKind)) {
      expect(DataSecurityAiActions.get(kind)?.kind).toBe(kind);
    }

    expect(DataSecurityAiActions.all()).toHaveLength(
      Object.values(DataSecurityAiProposalKind).length,
    );
  });

  test("is for telemetry issues only", () => {
    expect(
      ScrubTelemetryAction.appliesToCheck("sensitive-data-in-telemetry"),
    ).toBe(true);
    expect(ScrubTelemetryAction.appliesToCheck("secrets-in-telemetry")).toBe(
      true,
    );
    expect(ScrubTelemetryAction.appliesToCheck("public-read")).toBe(false);
    expect(ScrubTelemetryAction.appliesToCheck(undefined)).toBe(false);
  });
});

describe("planning the change", () => {
  test("proposes Scrub It's rule for a place nothing could be proven on, named and described - never a value", async () => {
    counted = [
      finding(EMAIL_FINDING, "email-address", "attributes.user.email", 120),
    ];

    const changes: Array<DataSecurityAiPlannedChange> = changesOf(
      await ScrubTelemetryAction.plan(context()),
    );

    expect(changes).toHaveLength(1);

    const change: DataSecurityAiPlannedChange = changes[0]!;

    expect(change.title).toBe(
      "Scrub Email address in attributes.user.email of checkout logs",
    );
    // The rule's own name - what it hides, where and whose - and what it does.
    expect(change.changeMarkdown).toContain(
      "**Data Security: Email address in log attributes of checkout** (log)",
    );
    expect(change.changeMarkdown).toContain(
      "It masks every email address in log attribute values from now on.",
    );
    expect(change.changeMarkdown).toContain(
      "It applies to the logs of checkout only",
    );
    // Nothing to prove it on: the finding's records are gone - so it waits.
    expect(change.changeMarkdown).toContain("Not proven");
    expect(change.changeMarkdown).toContain("It waits for you because");
    expect(change.reasonMarkdown).toContain("120 matched");
    expect(change.proofMarkdown).toContain("The issue's own check decides");
    expect(change.undoMarkdown).toContain("never a rule that was there before");
    expect(laneOf(change)).toBe(ScrubLane.Ask);
    expect(change.planKey).toBe(getScrubPlanKey(EMAIL_PLAN_V1.places));
    expect(change.meetsDefaultConditions).toBe(false);
    expect(change.canRunWithoutAsking).toBe(false);

    const plan: ScrubPlan = readScrubPlan(change.plan)!;

    expect(plan.rules).toHaveLength(1);
    expect(plan.rules![0]).toEqual(
      expect.objectContaining({
        signal: "log",
        patternType: LogScrubPatternType.Email,
        scrubAction: LogScrubAction.Mask,
        findingIds: [EMAIL_FINDING],
        waitReasons: [ScrubWaitReason.NotProven],
      }),
    );
  });

  test("a secret's proven rule nothing reads runs on its own, out of the box - and says to rotate it, and where it was seen", async () => {
    counted = [
      finding(
        PASSWORD_FINDING,
        "generic-secret",
        "attributes.db.password",
        9,
        DataCategory.SecretsAndCredentials,
      ),
    ];
    jest.spyOn(ScrubIt, "planProvenScrubItRule").mockResolvedValue(
      namedKeysRule({
        findingId: PASSWORD_FINDING,
        dataTypeId: "generic-secret",
        key: "db.password",
        dataTypeName: "Password",
      }),
    );

    const changes: Array<DataSecurityAiPlannedChange> = changesOf(
      await ScrubTelemetryAction.plan(
        context({ issue: { checkId: "secrets-in-telemetry" } }),
      ),
    );

    expect(changes).toHaveLength(1);
    expect(laneOf(changes[0]!)).toBe(ScrubLane.Alone);
    expect(changes[0]!.planKey).toMatch(/^scrub-alone:[0-9a-f]{16}$/);
    expect(changes[0]!.meetsDefaultConditions).toBe(true);
    expect(changes[0]!.canRunWithoutAsking).toBe(true);
    expect(changes[0]!.changeMarkdown).toContain(
      "Proven on 12 records, 2 of them the finding's own: it hid the data in all 5 values that held it, and changed none of the 7 other values at its place.",
    );
    expect(changes[0]!.changeMarkdown).toContain(
      "Nothing in the project reads what it hides.",
    );
    expect(changes[0]!.changeMarkdown).not.toContain("It waits for you");
    expect(changes[0]!.reasonMarkdown).toContain("**Rotate this secret.**");
    expect(changes[0]!.reasonMarkdown).toContain(
      "It was seen in `attributes.db.password` of checkout logs (last seen 2026-11-20).",
    );
  });

  test("personal data proven safe runs on its own only where a rule says so: its own lane, never out of the box", async () => {
    counted = [
      finding(
        NAME_FINDING,
        "person-name",
        "attributes.customer_name",
        4,
        DataCategory.ContactAndIdentity,
      ),
    ];
    jest.spyOn(ScrubIt, "planProvenScrubItRule").mockResolvedValue(
      namedKeysRule({
        findingId: NAME_FINDING,
        dataTypeId: "person-name",
        key: "customer_name",
        dataTypeName: "Person name",
        scrubAction: LogScrubAction.Mask,
      }),
    );

    const change: DataSecurityAiPlannedChange = changesOf(
      await ScrubTelemetryAction.plan(context()),
    )[0]!;

    expect(laneOf(change)).toBe(ScrubLane.Widen);
    expect(change.planKey).toMatch(/^scrub-widen:/);
    expect(change.meetsDefaultConditions).toBe(false);
    expect(change.canRunWithoutAsking).toBe(true);
    expect(change.reasonMarkdown).not.toContain("Rotate");
  });

  test.each([
    [
      "something reads what it hides",
      () => {
        readersFound = readers({ [TelemetryFieldReaderKind.Monitor]: 2 });
      },
      {},
      ScrubWaitReason.IsRead,
      "Read by 2 monitors",
    ],
    [
      "Security Events would lose what it reads",
      () => {
        readersFound = readers({}, true);
      },
      {},
      ScrubWaitReason.IsRead,
      "Security Events reads what it hides",
    ],
    [
      "what reads it could not be read",
      () => {
        readersFound = readers();
        readersFound.kinds[TelemetryFieldReaderKind.Dashboard].isChecked =
          false;
      },
      {},
      ScrubWaitReason.ReadersUnknown,
      "could not be read just now",
    ],
    [
      "it changed other values at its place",
      () => {},
      { changed: 1 },
      ScrubWaitReason.ChangesOtherValues,
      "and also changed 1 of the 7 other values at its place",
    ],
    [
      "nothing could be read to prove it on",
      () => {},
      { proven: false },
      ScrubWaitReason.NotProven,
      "Not proven",
    ],
  ])(
    "a secret's rule waits for a person, whatever a rule says, when %s",
    async (
      _why: string,
      arrange: () => void,
      rule: { changed?: number; proven?: boolean },
      reason: ScrubWaitReason,
      words: string,
    ) => {
      counted = [
        finding(
          PASSWORD_FINDING,
          "generic-secret",
          "attributes.db.password",
          9,
          DataCategory.SecretsAndCredentials,
        ),
      ];
      arrange();
      jest.spyOn(ScrubIt, "planProvenScrubItRule").mockResolvedValue(
        namedKeysRule({
          findingId: PASSWORD_FINDING,
          dataTypeId: "generic-secret",
          key: "db.password",
          dataTypeName: "Password",
          ...rule,
        }),
      );

      const change: DataSecurityAiPlannedChange = changesOf(
        await ScrubTelemetryAction.plan(context()),
      )[0]!;

      expect(laneOf(change)).toBe(ScrubLane.Ask);
      expect(change.canRunWithoutAsking).toBe(false);
      expect(change.meetsDefaultConditions).toBe(false);
      expect(readScrubPlan(change.plan)!.rules![0]!.waitReasons).toContain(
        reason,
      );
      expect(change.changeMarkdown).toContain(words);
      // The secret still must be rotated, whether the rule runs or waits.
      expect(change.reasonMarkdown).toContain("**Rotate this secret.**");
    },
  );

  test("a place a person took a rule back from, or dismissed one for, asks first from then on", async () => {
    counted = [
      finding(
        PASSWORD_FINDING,
        "generic-secret",
        "attributes.db.password",
        9,
        DataCategory.SecretsAndCredentials,
      ),
    ];
    earlierProposals = [
      {
        status: DataSecurityAiProposalStatus.Undone,
        plan: {
          kind: DataStoreKind.TelemetryLogs,
          places: [
            {
              findingId: PASSWORD_FINDING,
              dataTypeId: "generic-secret",
              location: "attributes.db.password",
              signal: "log",
            },
          ],
        },
      } as unknown as Partial<DataSecurityAiProposal>,
    ];
    jest.spyOn(ScrubIt, "planProvenScrubItRule").mockResolvedValue(
      namedKeysRule({
        findingId: PASSWORD_FINDING,
        dataTypeId: "generic-secret",
        key: "db.password",
        dataTypeName: "Password",
      }),
    );

    const change: DataSecurityAiPlannedChange = changesOf(
      await ScrubTelemetryAction.plan(context()),
    )[0]!;

    expect(laneOf(change)).toBe(ScrubLane.Ask);
    expect(readScrubPlan(change.plan)!.rules![0]!.waitReasons).toEqual([
      ScrubWaitReason.TakenBack,
    ]);
    expect(change.changeMarkdown).toContain(
      "a person took back or dismissed a rule for this place before",
    );
  });

  test("a rule for every service - a session replay's - always asks", async () => {
    counted = [
      finding(
        PASSWORD_FINDING,
        "generic-secret",
        "attributes.db.password",
        9,
        DataCategory.SecretsAndCredentials,
      ),
    ];
    jest.spyOn(ScrubIt, "planProvenScrubItRule").mockResolvedValue({
      ...namedKeysRule({
        findingId: PASSWORD_FINDING,
        dataTypeId: "generic-secret",
        key: "db.password",
        dataTypeName: "Password",
      }),
      scope: ScrubCoverage.EVERY_SERVICE_SCRUB_SCOPE,
    });

    const change: DataSecurityAiPlannedChange = changesOf(
      await ScrubTelemetryAction.plan(
        context({ store: { serviceId: undefined } }),
      ),
    )[0]!;

    expect(laneOf(change)).toBe(ScrubLane.Ask);
    expect(readScrubPlan(change.plan)!.rules![0]!.waitReasons).toContain(
      ScrubWaitReason.EveryService,
    );
  });

  test("rules that hide the same way in the same records are one: both keys, both places' proofs", async () => {
    counted = [
      finding(
        PASSWORD_FINDING,
        "generic-secret",
        "attributes.db.password",
        9,
        DataCategory.SecretsAndCredentials,
      ),
      finding(
        API_KEY_FINDING,
        "sendgrid-api-key",
        "attributes.api_key",
        3,
        DataCategory.SecretsAndCredentials,
      ),
    ];
    jest
      .spyOn(ScrubIt, "planProvenScrubItRule")
      .mockImplementation(async (data: { findingId?: string | null }) => {
        return data.findingId === PASSWORD_FINDING
          ? namedKeysRule({
              findingId: PASSWORD_FINDING,
              dataTypeId: "generic-secret",
              key: "db.password",
              dataTypeName: "Password",
            })
          : namedKeysRule({
              findingId: API_KEY_FINDING,
              dataTypeId: "sendgrid-api-key",
              key: "api_key",
              dataTypeName: "SendGrid API key",
            });
      });

    const changes: Array<DataSecurityAiPlannedChange> = changesOf(
      await ScrubTelemetryAction.plan(
        context({ issue: { checkId: "secrets-in-telemetry" } }),
      ),
    );

    expect(changes).toHaveLength(1);

    const plan: ScrubPlan = readScrubPlan(changes[0]!.plan)!;

    expect(plan.rules).toHaveLength(1);
    expect(plan.rules![0]!.attributeKeys).toEqual(["db.password", "api_key"]);
    expect(plan.rules![0]!.findingIds).toEqual([
      PASSWORD_FINDING,
      API_KEY_FINDING,
    ]);
    // One proof of the rule as it is saved: every place, every count.
    expect(plan.rules![0]!.proof!.fingerprint).toBe(
      getScrubRuleFingerprint({
        signal: "log",
        patternType: SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
        attributeKeys: ["db.password", "api_key"],
        scrubAction: LogScrubAction.Redact,
        fieldsToScrub: LogScrubField.Attributes,
        serviceId: SERVICE_ID.toString(),
      }),
    );
    expect(plan.rules![0]!.proof!.places).toHaveLength(2);
    expect(plan.rules![0]!.proof!.recordsRead).toBe(24);
    expect(plan.rules![0]!.name).toBe(
      "Data Security: Password or secret, SendGrid API key in db.password, api_key of checkout",
    );
    expect(plan.rules![0]!.description).toContain(
      "from findings of Password or secret, SendGrid API key in attributes.db.password, attributes.api_key",
    );
  });

  test("a secret that runs on its own and personal data that waits are two proposals, each in its lane", async () => {
    counted = [
      finding(
        PASSWORD_FINDING,
        "generic-secret",
        "attributes.db.password",
        9,
        DataCategory.SecretsAndCredentials,
      ),
      finding(EMAIL_FINDING, "email-address", "attributes.user.email", 120),
    ];
    jest
      .spyOn(ScrubIt, "planProvenScrubItRule")
      .mockImplementation(async (data: { findingId?: string | null }) => {
        return data.findingId === PASSWORD_FINDING
          ? namedKeysRule({
              findingId: PASSWORD_FINDING,
              dataTypeId: "generic-secret",
              key: "db.password",
              dataTypeName: "Password",
            })
          : namedKeysRule({
              findingId: EMAIL_FINDING,
              dataTypeId: "email-address",
              key: "user.email",
              dataTypeName: "Email address",
              scrubAction: LogScrubAction.Mask,
              proven: false,
            });
      });

    const changes: Array<DataSecurityAiPlannedChange> = changesOf(
      await ScrubTelemetryAction.plan(context()),
    );

    expect(changes.map(laneOf)).toEqual([ScrubLane.Alone, ScrubLane.Ask]);
    expect(changes[0]!.planKey).not.toBe(changes[1]!.planKey);
  });

  test("plans nothing for an issue that is no telemetry issue", async () => {
    expect(
      await ScrubTelemetryAction.plan(
        context({ issue: { checkId: "public-read" } }),
      ),
    ).toEqual({ kind: "nothing", detail: "not-telemetry" });
    expect(
      await ScrubTelemetryAction.plan(
        context({ store: { kind: DataStoreKind.AwsS3Bucket } }),
      ),
    ).toEqual({ kind: "nothing", detail: "not-telemetry" });
  });

  test("plans nothing when no place is left unscrubbed", async () => {
    expect(await ScrubTelemetryAction.plan(context())).toEqual({
      kind: "nothing",
      detail: "no-unscrubbed-finding",
    });
  });

  test("leaves out a place a rule already covers", async () => {
    counted = [
      finding(EMAIL_FINDING, "email-address", "attributes.user.email", 120),
    ];
    coverageRules = [
      {
        id: EXISTING_RULE,
        name: "Hide emails",
        signal: "log",
        patternType: "email",
        fieldsToScrub: "attributes",
      },
    ];

    expect(await ScrubTelemetryAction.plan(context())).toEqual({
      kind: "nothing",
      detail: "already-scrubbed",
    });
  });

  test("a data type named with markup, as the project wrote it, reads as plain text in the reason", async () => {
    const CUSTOM_TYPE: string = "custom:10364000-0000-4000-8000-0000000006f1";
    const NAME: string =
      "[Badge ID](https://evil.example/login) <img src=x onerror=alert(1)> **id** <!channel>";
    counted = [
      finding(EMAIL_FINDING, "email-address", "attributes.user.email", 120),
      finding(TOKEN_FINDING, CUSTOM_TYPE, "attributes.badge", 7),
    ];

    // The project's own type: a rule of its own, unproven as the email's is, so both wait in one proposal.
    const realPlan: typeof ScrubIt.planProvenScrubItRule =
      ScrubIt.planProvenScrubItRule;
    jest
      .spyOn(ScrubIt, "planProvenScrubItRule")
      .mockImplementation(
        async (
          data: Parameters<typeof ScrubIt.planProvenScrubItRule>[0],
        ): Promise<ScrubIt.ProvenScrubItRule> => {
          return data.dataTypeId === CUSTOM_TYPE
            ? namedKeysRule({
                findingId: TOKEN_FINDING,
                dataTypeId: CUSTOM_TYPE,
                key: "badge",
                dataTypeName: "a badge",
                proven: false,
              })
            : await realPlan(data);
        },
      );

    const outcome: DataSecurityAiPlanOutcome = await ScrubTelemetryAction.plan({
      ...context(),
      dataTypeNamer: new DataTypeNamer(new Map([[CUSTOM_TYPE, NAME]])),
    });
    const change: DataSecurityAiPlannedChange = changesOf(outcome)[0]!;
    const html: string = marked.parse(change.reasonMarkdown, {
      async: false,
    }) as string;

    /*
     * No image, HTML or mention the name made, and no link whose words hide
     * where it goes: a bare address is a link every renderer makes, one
     * that shows its address. The name is read as it was typed.
     */
    expect(html).not.toMatch(/<(img|script)\b/);
    for (const link of html.matchAll(
      /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
    )) {
      expect(htmlAsText(link[2]!)).toBe(htmlAsText(link[1]!));
    }
    // The one bold is the check's own: the name's asterisks are text.
    expect(html.match(/<strong>/g)).toHaveLength(1);
    expect(change.reasonMarkdown).not.toContain(
      "[Badge ID](https://evil.example",
    );
    expect(change.reasonMarkdown).not.toContain("<!channel>");
    expect(
      FeedMarkdown.withoutInvisibleBreaks(htmlAsText(html)).replace(
        /\s+/g,
        " ",
      ),
    ).toContain(
      `Email address, ${NAME} were found in 2 places of checkout logs`,
    );
  });

  test("says when no rule can reach what is left: the code is the fix", async () => {
    counted = [finding(SESSION_FINDING, "email-address", "user.email", 3)];

    expect(
      await ScrubTelemetryAction.plan(
        context({ store: { kind: DataStoreKind.TelemetrySessionReplays } }),
      ),
    ).toEqual({ kind: "nothing", detail: "not-scrubbable" });
  });

  test("scrubs at most twenty places, the most matched first - one rule where one rule does it", async () => {
    counted = Array.from(
      { length: MAX_SCRUB_PLACES_PER_PROPOSAL + 5 },
      (_value: unknown, index: number): DataStoreFinding => {
        return finding(
          `10364000-0000-4000-8000-0000000006${String(index).padStart(2, "0")}`,
          "email-address",
          `attributes.email${index}`,
          100 - index,
        );
      },
    );

    const changes: Array<DataSecurityAiPlannedChange> = changesOf(
      await ScrubTelemetryAction.plan(context()),
    );
    const plan: ScrubPlan | null = readScrubPlan(changes[0]!.plan);

    expect(plan!.places).toHaveLength(MAX_SCRUB_PLACES_PER_PROPOSAL);
    expect(plan!.places[0]!.location).toBe("attributes.email0");
    // The email pattern in every attribute is one rule for every place.
    expect(plan!.rules).toHaveLength(1);
    expect(plan!.rules![0]!.findingIds).toHaveLength(
      MAX_SCRUB_PLACES_PER_PROPOSAL,
    );
  });

  test("the same places make the same key in a lane, in any order - and another key in another lane", () => {
    const places: ScrubPlan["places"] = [
      {
        findingId: EMAIL_FINDING,
        dataTypeId: "email-address",
        location: "attributes.user.email",
        signal: "log",
      },
      {
        findingId: TOKEN_FINDING,
        dataTypeId: "github-token",
        location: "attributes.github.token",
        signal: "log",
      },
    ];

    expect(getScrubPlanKey(places)).toBe(
      getScrubPlanKey([...places].reverse()),
    );
    expect(getScrubPlanKey(places)).not.toBe(getScrubPlanKey([places[0]!]));
    expect(getScrubPlanKey(places)).toMatch(/^scrub:[0-9a-f]{16}$/);
    expect(getScrubPlanKey(places, ScrubLane.Alone)).toMatch(
      /^scrub-alone:[0-9a-f]{16}$/,
    );
  });
});

describe("OneUptime AI's rules, where none of Scrub It's fits", () => {
  test("are asked for with names and shapes, kept only when proven on the finding's records", async () => {
    counted = [
      finding(
        NAME_FINDING,
        "person-name",
        "attributes.customer_name",
        4,
        DataCategory.ContactAndIdentity,
      ),
    ];
    const told: ScrubRuleWriterPlace = {
      ref: "P1",
      dataTypeId: "person-name",
      dataTypeName: "Person name",
      category: DataCategory.ContactAndIdentity,
      foundBy: "name",
      signal: "log",
      location: "attributes.customer_name",
      attributeKey: "customer_name",
      locationKind: "Attribute",
      neighbours: ["customer_id"],
      shapes: [{ shape: "Aaaa Aaa", share: 1 }],
      valueCount: 4,
      averageLength: 8,
    };
    const planned: SpyInstance<typeof ScrubIt.planProvenScrubItRule> = jest
      .spyOn(ScrubIt, "planProvenScrubItRule")
      .mockImplementation(
        async (data: { onlyCandidates?: ReadonlyArray<unknown> }) => {
          if (!data.onlyCandidates) {
            throw new BadDataException(
              "No rule OneUptime can make hides this data without hiding far more than it.",
            );
          }

          return namedKeysRule({
            findingId: NAME_FINDING,
            dataTypeId: "person-name",
            key: "customer_name",
            dataTypeName: "Person name",
            scrubAction: LogScrubAction.Mask,
            source: ScrubRuleSource.OneUptimeAi,
          });
        },
      );
    jest
      .spyOn(ScrubPlanModule, "readScrubPlanFindingRecord")
      .mockResolvedValue({
        findingId: NAME_FINDING,
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "person-name",
        location: "attributes.customer_name",
        target: { signal: "log" } as never,
      });
    jest.spyOn(ScrubShapes, "describeScrubPlace").mockResolvedValue(told);
    const written: SpyInstance<typeof ScrubRuleWriter.write> = jest
      .spyOn(ScrubRuleWriter, "write")
      .mockResolvedValue({
        kind: "written",
        rules: [
          {
            ref: "P1",
            kind: ScrubRuleWriterRuleKind.Keys,
            keys: ["customer_name"],
          },
        ],
      });

    const change: DataSecurityAiPlannedChange = changesOf(
      await ScrubTelemetryAction.plan(context()),
    )[0]!;

    expect(written).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, places: [told] }),
    );
    // The second planning tried OneUptime AI's rule alone.
    expect(planned.mock.calls[1]![0].onlyCandidates).toEqual([
      expect.objectContaining({
        source: ScrubRuleSource.OneUptimeAi,
        patternType: SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
        attributeKeys: ["customer_name"],
      }),
    ]);
    expect(readScrubPlan(change.plan)!.rules![0]!.source).toBe(
      ScrubRuleSource.OneUptimeAi,
    );
  });

  test("what OneUptime AI could not write, or wrote and was not proven, is a place only the code can fix", async () => {
    counted = [
      finding(
        NAME_FINDING,
        "person-name",
        "body",
        4,
        DataCategory.ContactAndIdentity,
      ),
    ];
    jest
      .spyOn(ScrubIt, "planProvenScrubItRule")
      .mockRejectedValue(new BadDataException("No rule fits."));
    jest
      .spyOn(ScrubPlanModule, "readScrubPlanFindingRecord")
      .mockResolvedValue(null);
    const written: SpyInstance<typeof ScrubRuleWriter.write> = jest.spyOn(
      ScrubRuleWriter,
      "write",
    );

    expect(await ScrubTelemetryAction.plan(context())).toEqual({
      kind: "nothing",
      detail: "not-scrubbable",
    });
    // Nothing to tell it: no records, no shapes - so it is not asked.
    expect(written).not.toHaveBeenCalled();
  });

  test("a service that is gone is never one OneUptime AI writes for", async () => {
    counted = [
      finding(
        NAME_FINDING,
        "person-name",
        "attributes.customer_name",
        4,
        DataCategory.ContactAndIdentity,
      ),
    ];
    jest
      .spyOn(ScrubIt, "planProvenScrubItRule")
      .mockRejectedValue(
        new BadDataException(ScrubCoverage.SCRUB_SERVICE_GONE),
      );
    const written: SpyInstance<typeof ScrubRuleWriter.write> = jest.spyOn(
      ScrubRuleWriter,
      "write",
    );

    expect(await ScrubTelemetryAction.plan(context())).toEqual({
      kind: "nothing",
      detail: "not-scrubbable",
    });
    expect(written).not.toHaveBeenCalled();
  });
});

describe("who may approve and undo it", () => {
  function caller(
    permissions: Array<Permission>,
  ): DatabaseCommonInteractionProps {
    return customDomainCaller({ permissions, projectId: PROJECT_ID });
  }

  const TRACE_PLAN: ScrubPlan = {
    kind: DataStoreKind.TelemetryTraces,
    places: [
      {
        findingId: TOKEN_FINDING,
        dataTypeId: "github-token",
        location: "attributes.github.token",
        signal: "trace",
      },
    ],
  };

  test.each([
    [[Permission.ProjectOwner], null],
    [[Permission.ProjectAdmin], null],
    [[Permission.CreateProjectLogScrubRule], null],
    [
      [Permission.SecurityAdmin],
      "Approving this makes log scrub rules, and you do not have permission to create them. Ask a Project Owner or Project Admin, or for Create Project Log Scrub Rule.",
    ],
    [
      [Permission.CreateProjectTraceScrubRule],
      "Approving this makes log scrub rules, and you do not have permission to create them. Ask a Project Owner or Project Admin, or for Create Project Log Scrub Rule.",
    ],
  ])(
    "approving log rules with %j: %s",
    (permissions: Array<Permission>, refusal: string | null) => {
      expect(
        ScrubTelemetryAction.getApproveRefusal({
          props: caller(permissions),
          proposal: proposalWith({ plan: EMAIL_PLAN_V1 }),
        }),
      ).toBe(refusal);
    },
  );

  test("approving trace rules takes the trace scrub rule permission", () => {
    expect(
      ScrubTelemetryAction.getApproveRefusal({
        props: caller([Permission.CreateProjectTraceScrubRule]),
        proposal: proposalWith({ plan: TRACE_PLAN }),
      }),
    ).toBeNull();
    expect(
      ScrubTelemetryAction.getApproveRefusal({
        props: caller([Permission.CreateProjectLogScrubRule]),
        proposal: proposalWith({ plan: TRACE_PLAN }),
      }),
    ).toContain("trace scrub rules");
  });

  test("undoing takes the permission to delete the rules it made - and nothing for one that made none", () => {
    const result: unknown = {
      rules: [
        {
          findingId: EMAIL_FINDING,
          signal: "log",
          scrubRuleId: MADE_RULE,
          scrubRuleName: "Data Security: Email Address",
          created: true,
        },
      ],
    };

    expect(
      ScrubTelemetryAction.getUndoRefusal({
        props: caller([Permission.DeleteProjectLogScrubRule]),
        proposal: proposalWith({ plan: EMAIL_PLAN_V1, result }),
      }),
    ).toBeNull();
    expect(
      ScrubTelemetryAction.getUndoRefusal({
        props: caller([Permission.CreateProjectLogScrubRule]),
        proposal: proposalWith({ plan: EMAIL_PLAN_V1, result }),
      }),
    ).toContain("you do not have permission to delete them");
    expect(
      ScrubTelemetryAction.getUndoRefusal({
        props: caller([]),
        proposal: proposalWith({
          plan: EMAIL_PLAN_V1,
          result: {
            rules: [
              {
                findingId: EMAIL_FINDING,
                signal: "log",
                scrubRuleId: EXISTING_RULE,
                created: false,
              },
            ],
          },
        }),
      }),
    ).toBeNull();
  });
});

// The plan a secret's lane holds: one proven Named Attributes rule for db.password.
function secretPlan(): ScrubPlan {
  const rule: ScrubIt.ProvenScrubItRule = namedKeysRule({
    findingId: PASSWORD_FINDING,
    dataTypeId: "generic-secret",
    key: "db.password",
    dataTypeName: "Password",
  });

  return {
    version: 2,
    kind: DataStoreKind.TelemetryLogs,
    serviceId: SERVICE_ID.toString(),
    serviceName: "checkout",
    lane: ScrubLane.Alone,
    places: [
      {
        findingId: PASSWORD_FINDING,
        dataTypeId: "generic-secret",
        location: "attributes.db.password",
        signal: "log",
        isSecret: true,
        lastSeenAt: "2026-11-20T09:40:00.000Z",
        matchCount: 9,
      },
    ],
    rules: [
      {
        signal: "log",
        name: rule.name,
        description: rule.description,
        findingIds: [PASSWORD_FINDING],
        patternType: rule.plan.patternType,
        attributeKeys: rule.plan.attributeKeys,
        scrubAction: rule.plan.scrubAction,
        fieldsToScrub: rule.plan.fieldsToScrub,
        source: ScrubRuleSource.NamedKeys,
        proof: rule.proof!,
        readers: {},
        waitReasons: [],
      },
    ],
  };
}

describe("making the change", () => {
  test("a plan made before #10366 makes Scrub It's rule for each place as the person who approved, marks the places and checks the store", async () => {
    const made: { result: unknown; summaryMarkdown: string } =
      await ScrubTelemetryAction.apply({
        projectId: PROJECT_ID,
        proposal: proposalWith({ plan: EMAIL_PLAN_V1 }),
        actor: {
          props: customDomainCaller({
            permissions: [Permission.ProjectAdmin],
            projectId: PROJECT_ID,
          }),
          userId: new ObjectID("10364000-0000-4000-8000-00000000a11c"),
        },
      });

    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        userId: new ObjectID("10364000-0000-4000-8000-00000000a11c"),
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "email-address",
        location: "attributes.user.email",
        serviceId: SERVICE_ID.toString(),
      }),
    );
    expect(readScrubResult(made.result)).toEqual([
      {
        findingId: EMAIL_FINDING,
        signal: "log",
        scrubRuleId: MADE_RULE,
        scrubRuleName:
          "Data Security: Email address in log attributes of checkout",
        created: true,
      },
    ]);
    expect(marks).toEqual([{ id: EMAIL_FINDING, isScrubbed: true }]);
    expect(evaluations).toHaveBeenCalledWith(PROJECT_ID);
    expect(made.summaryMarkdown).toContain(
      "Data Security: Email address in log attributes of checkout",
    );
  });

  test("makes the very rule that was proven - its keys, its service and its proof - and says how it was proven and how to undo it", async () => {
    const plan: ScrubPlan = secretPlan();
    const made: DataSecurityAiChangeMade = await ScrubTelemetryAction.apply({
      projectId: PROJECT_ID,
      proposal: proposalWith({ plan }),
      // Without asking: as OneUptime, no person.
      actor: { props: { isRoot: true } },
    });

    expect(saved).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: undefined,
      planned: {
        signal: "log",
        plan: {
          patternType: SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
          scrubAction: LogScrubAction.Redact,
          fieldsToScrub: LogScrubField.Attributes,
          attributeKeys: ["db.password"],
        },
        scope: { serviceId: SERVICE_ID, serviceName: "checkout" },
        name: plan.rules![0]!.name,
        description: plan.rules![0]!.description,
        proof: plan.rules![0]!.proof,
      },
    });
    expect(created).not.toHaveBeenCalled();
    expect(readScrubResult(made.result)).toEqual([
      {
        findingId: PASSWORD_FINDING,
        signal: "log",
        scrubRuleId: MADE_RULE,
        scrubRuleName: plan.rules![0]!.name,
        created: true,
      },
    ]);
    expect(made.summaryMarkdown).toContain(
      "Scrub rules made: **Data Security: Password in db.password of checkout**.",
    );
    expect(made.detailsMarkdown).toContain(
      "Proven on 12 records, 2 of them the finding's own",
    );
    expect(made.detailsMarkdown).toContain("**Rotate this secret.**");
    expect(made.detailsMarkdown).toContain("press Undo on this entry");
  });

  test("keeps a rule that already covers a place, and never counts it as its own", async () => {
    coverageRules = [
      {
        id: EXISTING_RULE,
        name: "Hide emails",
        signal: "log",
        patternType: "email",
        fieldsToScrub: "attributes",
      },
    ];

    const made: { result: unknown } = await ScrubTelemetryAction.apply({
      projectId: PROJECT_ID,
      proposal: proposalWith({ plan: EMAIL_PLAN_V1 }),
      actor: { props: { isRoot: true } },
    });

    expect(created).not.toHaveBeenCalled();
    expect(readScrubResult(made.result)).toEqual([
      expect.objectContaining({ scrubRuleId: EXISTING_RULE, created: false }),
    ]);
  });

  test("is all or nothing: the rules it made before a refusal are taken back", async () => {
    const twoPlaces: ScrubPlan = {
      ...EMAIL_PLAN_V1,
      places: [
        ...EMAIL_PLAN_V1.places,
        {
          findingId: TOKEN_FINDING,
          dataTypeId: "github-token",
          location: "attributes.github.token",
          signal: "log",
        },
      ],
    };
    let calls: number = 0;

    created.mockImplementation(async () => {
      calls++;

      if (calls === 2) {
        throw new BadDataException("You may not create log scrub rules.");
      }

      return { signal: "log", scrubRuleId: MADE_RULE, scrubRuleName: "Made" };
    });
    jest
      .spyOn(LogScrubRuleService, "findOneById")
      .mockResolvedValue({ id: new ObjectID(MADE_RULE) } as never);
    const deleted: SpyInstance<typeof LogScrubRuleService.deleteOneById> = jest
      .spyOn(LogScrubRuleService, "deleteOneById")
      .mockResolvedValue(1);

    await expect(
      ScrubTelemetryAction.apply({
        projectId: PROJECT_ID,
        proposal: proposalWith({ plan: twoPlaces }),
        actor: { props: { isRoot: true } },
      }),
    ).rejects.toThrow("You may not create log scrub rules.");
    expect(deleted).toHaveBeenCalledWith({
      id: new ObjectID(MADE_RULE),
      props: { isRoot: true },
    });
    expect(marks).toEqual([]);
    expect(evaluations).not.toHaveBeenCalled();
  });

  test("refuses a proposal whose plan no longer says what to scrub", async () => {
    await expect(
      ScrubTelemetryAction.apply({
        projectId: PROJECT_ID,
        proposal: proposalWith({}),
        actor: { props: { isRoot: true } },
      }),
    ).rejects.toThrow("no longer says what to scrub");
    await expect(
      ScrubTelemetryAction.apply({
        projectId: PROJECT_ID,
        proposal: proposalWith({ plan: { ...secretPlan(), rules: [] } }),
        actor: { props: { isRoot: true } },
      }),
    ).rejects.toThrow("no longer says what to scrub");
  });

  test("skips a place whose finding is gone", async () => {
    jest.spyOn(DataStoreFindingService, "findOneBy").mockResolvedValue(null);

    const made: { result: unknown } = await ScrubTelemetryAction.apply({
      projectId: PROJECT_ID,
      proposal: proposalWith({ plan: secretPlan() }),
      actor: { props: { isRoot: true } },
    });

    expect(saved).not.toHaveBeenCalled();
    expect(readScrubResult(made.result)).toEqual([]);
  });
});

describe("who is told of a change made without asking", () => {
  test("the store's and the service's owners: what was done, how it was proven, to rotate the secret and where it was seen", async () => {
    const send: SpyInstance<typeof DataSecurityContainmentNotice.send> = jest
      .spyOn(DataSecurityContainmentNotice, "send")
      .mockResolvedValue(2);
    const plan: ScrubPlan = secretPlan();

    await ScrubTelemetryAction.onMadeWithoutAsking!({
      projectId: PROJECT_ID,
      proposal: proposalWith({ plan }),
      made: {
        result: {
          rules: [
            {
              findingId: PASSWORD_FINDING,
              signal: "log",
              scrubRuleId: MADE_RULE,
              scrubRuleName: plan.rules![0]!.name,
              created: true,
            },
          ],
        },
        summaryMarkdown: "Scrub rules made.",
      },
    });

    expect(send).toHaveBeenCalledTimes(1);

    const sent: Parameters<typeof DataSecurityContainmentNotice.send>[0] =
      send.mock.calls[0]![0];

    expect(sent).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        dataStoreName: "checkout logs",
        serviceId: SERVICE_ID,
        dataSecurityIssueId: ISSUE_ID,
        isSecret: true,
      }),
    );
    expect(sent.content.ruleLines.map(String)).toEqual([
      expect.stringContaining(
        "Data Security: Password in db.password of checkout",
      ),
    ]);
    expect(String(sent.content.proofLines[0])).toContain(
      "Proven on 12 records",
    );
    expect(String(sent.content.actionLines[0])).toContain(
      "It was seen in `attributes.db.password` of checkout logs",
    );
  });

  test("nobody, for a change that made no rule of its own", async () => {
    const send: SpyInstance<typeof DataSecurityContainmentNotice.send> = jest
      .spyOn(DataSecurityContainmentNotice, "send")
      .mockResolvedValue(0);

    await ScrubTelemetryAction.onMadeWithoutAsking!({
      projectId: PROJECT_ID,
      proposal: proposalWith({ plan: secretPlan() }),
      made: {
        result: {
          rules: [
            {
              findingId: PASSWORD_FINDING,
              signal: "log",
              scrubRuleId: EXISTING_RULE,
              scrubRuleName: "Hide passwords",
              created: false,
            },
          ],
        },
        summaryMarkdown: "Every place was already covered.",
      },
    });

    expect(send).not.toHaveBeenCalled();
  });
});

describe("undoing it", () => {
  const MADE_AND_KEPT: unknown = {
    rules: [
      {
        findingId: EMAIL_FINDING,
        signal: "log",
        scrubRuleId: MADE_RULE,
        scrubRuleName: "Data Security: Email Address",
        created: true,
      },
      {
        findingId: TOKEN_FINDING,
        signal: "trace",
        scrubRuleId: EXISTING_RULE,
        scrubRuleName: "Hide tokens",
        created: false,
      },
    ],
  };

  test("deletes only the rules it made, as the person, and reads each place again", async () => {
    const asPerson: DatabaseCommonInteractionProps = customDomainCaller({
      permissions: [Permission.ProjectAdmin],
      projectId: PROJECT_ID,
    });
    jest
      .spyOn(LogScrubRuleService, "findOneById")
      .mockResolvedValue({ id: new ObjectID(MADE_RULE) } as never);
    const deleted: SpyInstance<typeof LogScrubRuleService.deleteOneById> = jest
      .spyOn(LogScrubRuleService, "deleteOneById")
      .mockResolvedValue(1);
    const traceDeleted: SpyInstance<
      typeof TraceScrubRuleService.deleteOneById
    > = jest.spyOn(TraceScrubRuleService, "deleteOneById").mockResolvedValue(1);

    const undone: { summaryMarkdown: string } = await ScrubTelemetryAction.undo(
      {
        projectId: PROJECT_ID,
        proposal: proposalWith({ plan: EMAIL_PLAN_V1, result: MADE_AND_KEPT }),
        actor: { props: asPerson },
      },
    );

    expect(deleted).toHaveBeenCalledWith({
      id: new ObjectID(MADE_RULE),
      props: asPerson,
    });
    expect(traceDeleted).not.toHaveBeenCalled();
    // Nothing covers the place now: it reads as unscrubbed again.
    expect(marks).toEqual([{ id: EMAIL_FINDING, isScrubbed: false }]);
    expect(evaluations).toHaveBeenCalledWith(PROJECT_ID);
    expect(undone.summaryMarkdown).toContain("Data Security: Email Address");
  });

  test("one rule made for several places is deleted once", async () => {
    jest
      .spyOn(LogScrubRuleService, "findOneById")
      .mockResolvedValue({ id: new ObjectID(MADE_RULE) } as never);
    const deleted: SpyInstance<typeof LogScrubRuleService.deleteOneById> = jest
      .spyOn(LogScrubRuleService, "deleteOneById")
      .mockResolvedValue(1);

    await ScrubTelemetryAction.undo({
      projectId: PROJECT_ID,
      proposal: proposalWith({
        plan: secretPlan(),
        result: {
          rules: [PASSWORD_FINDING, API_KEY_FINDING].map(
            (findingId: string) => {
              return {
                findingId,
                signal: "log",
                scrubRuleId: MADE_RULE,
                scrubRuleName: "Data Security: Password, API key",
                created: true,
              };
            },
          ),
        },
      }),
      actor: { props: { isRoot: true } },
    });

    expect(deleted).toHaveBeenCalledTimes(1);
  });

  test("a rule someone deleted since is undone already", async () => {
    jest.spyOn(LogScrubRuleService, "findOneById").mockResolvedValue(null);
    const deleted: SpyInstance<typeof LogScrubRuleService.deleteOneById> = jest
      .spyOn(LogScrubRuleService, "deleteOneById")
      .mockResolvedValue(1);

    await ScrubTelemetryAction.undo({
      projectId: PROJECT_ID,
      proposal: proposalWith({ plan: EMAIL_PLAN_V1, result: MADE_AND_KEPT }),
      actor: { props: { isRoot: true } },
    });

    expect(deleted).not.toHaveBeenCalled();
  });
});

describe("a plan and a result, read back", () => {
  test("leave out a place or a rule that is not one", () => {
    expect(
      readScrubPlan({
        kind: "Logs",
        places: [
          EMAIL_PLAN_V1.places[0],
          {
            findingId: "not-an-id",
            dataTypeId: "x",
            location: "y",
            signal: "log",
          },
          {
            findingId: EMAIL_FINDING,
            dataTypeId: "x",
            location: "y",
            signal: "sms",
          },
          "a place",
        ],
      })?.places,
    ).toEqual([EMAIL_PLAN_V1.places[0]]);
    expect(readScrubPlan({ kind: "Floppy", places: [] })).toBeNull();
    expect(readScrubPlan(null)).toBeNull();
    expect(
      readScrubResult({
        rules: [{ scrubRuleId: "nope", signal: "log" }, null],
      }),
    ).toEqual([]);
  });

  test("a rule for a place the plan does not hold, or that says nothing of what it finds, makes nothing", () => {
    const plan: ScrubPlan = secretPlan();

    expect(
      readScrubPlan({
        ...plan,
        rules: [
          { ...plan.rules![0], findingIds: [EMAIL_FINDING] },
          { ...plan.rules![0], patternType: "" },
          plan.rules![0],
        ],
      })!.rules,
    ).toEqual([plan.rules![0]]);
  });

  test("a proof that is not one is no proof", () => {
    const plan: ScrubPlan = secretPlan();

    expect(
      readScrubPlan({
        ...plan,
        rules: [{ ...plan.rules![0], proof: { version: 99 } }],
      })!.rules![0]!.proof,
    ).toBeUndefined();
  });
});
