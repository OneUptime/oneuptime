import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import ScrubTelemetryAction, {
  getScrubPlanKey,
  MAX_SCRUB_PLACES_PER_PROPOSAL,
  readScrubPlan,
  readScrubResult,
  ScrubPlan,
} from "../../../../../Server/Utils/AI/DataSecurity/Actions/ScrubTelemetryAction";
import {
  DataSecurityAiIssueContext,
  DataSecurityAiPlanOutcome,
  DataSecurityAiPlannedChange,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiAction";
import DataSecurityAiActions from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiActions";
import * as IssueFindings from "../../../../../Server/Utils/DataSecurity/DataSecurityIssueFindings";
import * as Jobs from "../../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import * as ScrubCoverage from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import logger from "../../../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DATA_SECURITY_AI_PROPOSAL_KINDS,
  DataSecurityAiProposalKind,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
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
 * CONTAINING A TELEMETRY ISSUE WITH SCRUB IT (#10364): what the proposal
 * plans from the places the issue's check counts - each rule as Scrub It
 * would make it, never a value - who may approve and undo it, and making
 * and taking back exactly the rules it made. The scrub rule services and
 * the findings are stood in for; Scrub It's own planning is the real one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10364000-0000-4000-8000-000000000001",
);
const STORE_ID: ObjectID = new ObjectID("10364000-0000-4000-8000-0000000000b1");
const SERVICE_ID: ObjectID = new ObjectID(
  "10364000-0000-4000-8000-0000000000e1",
);
const EMAIL_FINDING: string = "10364000-0000-4000-8000-0000000004a1";
const TOKEN_FINDING: string = "10364000-0000-4000-8000-0000000004a2";
const SESSION_FINDING: string = "10364000-0000-4000-8000-0000000004a3";
const MADE_RULE: string = "10364000-0000-4000-8000-0000000005a1";
const EXISTING_RULE: string = "10364000-0000-4000-8000-0000000005a2";

function finding(
  id: string,
  dataTypeId: string,
  location: string,
  matchCount: number,
): DataStoreFinding {
  return {
    id: new ObjectID(id),
    dataTypeId,
    location,
    matchCount,
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
      id: new ObjectID("10364000-0000-4000-8000-0000000000a1"),
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
  plan?: ScrubPlan;
  result?: unknown;
}): DataSecurityAiProposal {
  return {
    id: new ObjectID("10364000-0000-4000-8000-0000000003a1"),
    kind: DataSecurityAiProposalKind.ScrubTelemetry,
    dataStoreId: STORE_ID,
    plan: data.plan,
    result: data.result,
  } as unknown as DataSecurityAiProposal;
}

const EMAIL_PLAN: ScrubPlan = {
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

let counted: Array<DataStoreFinding>;
let coverageRules: Array<ScrubCoverage.CoveringScrubRule>;
let created: SpyInstance<typeof ScrubCoverage.createScrubRuleForFinding>;
let marks: Array<{ id: string; isScrubbed: unknown }>;
let evaluations: SpyInstance<typeof Jobs.queueDataSecurityEvaluation>;

beforeEach(() => {
  counted = [];
  coverageRules = [];
  marks = [];

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest
    .spyOn(IssueFindings, "readCountedTelemetryFindings")
    .mockImplementation(async () => {
      return counted;
    });
  jest.spyOn(ScrubCoverage, "getScrubCoverage").mockImplementation(async () => {
    return { rules: coverageRules };
  });
  created = jest
    .spyOn(ScrubCoverage, "createScrubRuleForFinding")
    .mockImplementation(async () => {
      coverageRules.push({
        id: MADE_RULE,
        name: "Data Security: Email address in attributes.user.email",
        signal: "log",
        patternType: "email",
        fieldsToScrub: "attributes",
      });

      return {
        signal: "log",
        scrubRuleId: MADE_RULE,
        scrubRuleName: "Data Security: Email address in attributes.user.email",
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
  evaluations = jest
    .spyOn(Jobs, "queueDataSecurityEvaluation")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

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
  test("proposes the rule Scrub It would make for each place, named and described - never a value", async () => {
    counted = [
      finding(EMAIL_FINDING, "email-address", "attributes.user.email", 120),
    ];

    const outcome: DataSecurityAiPlanOutcome =
      await ScrubTelemetryAction.plan(context());

    expect(outcome.kind).toBe("planned");

    const change: DataSecurityAiPlannedChange = (
      outcome as { changes: Array<DataSecurityAiPlannedChange> }
    ).changes[0]!;

    expect(change.title).toBe(
      "Scrub Email address in attributes.user.email of checkout logs",
    );
    // The rule's own name, cut where Scrub It cuts it, and what it does.
    expect(change.changeMarkdown).toContain(
      "**Data Security: Email address in attributes.user.e…** (log)",
    );
    expect(change.changeMarkdown).toContain(
      "It redacts every email address in log attribute values from now on.",
    );
    expect(change.reasonMarkdown).toContain("120 matched");
    expect(change.proofMarkdown).toContain("The issue's own check decides");
    expect(change.undoMarkdown).toContain("never a rule that was there before");
    expect(change.plan).toEqual(EMAIL_PLAN);
    expect(change.planKey).toBe(getScrubPlanKey(EMAIL_PLAN.places));
    // Out of the box it is proposed: #10366 proves when it may run alone.
    expect(change.meetsDefaultConditions).toBe(false);
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

  test("says when no rule can reach what is left: the code is the fix", async () => {
    counted = [finding(SESSION_FINDING, "email-address", "user.email", 3)];

    expect(
      await ScrubTelemetryAction.plan(
        context({ store: { kind: DataStoreKind.TelemetrySessionReplays } }),
      ),
    ).toEqual({ kind: "nothing", detail: "not-scrubbable" });
  });

  test("scrubs at most twenty places in one proposal, the most matched first", async () => {
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

    const outcome: DataSecurityAiPlanOutcome =
      await ScrubTelemetryAction.plan(context());
    const plan: ScrubPlan | null = readScrubPlan(
      (outcome as { changes: Array<DataSecurityAiPlannedChange> }).changes[0]!
        .plan,
    );

    expect(plan!.places).toHaveLength(MAX_SCRUB_PLACES_PER_PROPOSAL);
    expect(plan!.places[0]!.location).toBe("attributes.email0");
  });

  test("the same places make the same key, in any order", () => {
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
          proposal: proposalWith({ plan: EMAIL_PLAN }),
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
        proposal: proposalWith({ plan: EMAIL_PLAN, result }),
      }),
    ).toBeNull();
    expect(
      ScrubTelemetryAction.getUndoRefusal({
        props: caller([Permission.CreateProjectLogScrubRule]),
        proposal: proposalWith({ plan: EMAIL_PLAN, result }),
      }),
    ).toContain("you do not have permission to delete them");
    expect(
      ScrubTelemetryAction.getUndoRefusal({
        props: caller([]),
        proposal: proposalWith({
          plan: EMAIL_PLAN,
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

describe("making the change", () => {
  test("makes each rule as the person who approved, marks the places scrubbed and checks the store again", async () => {
    const made: { result: unknown; summaryMarkdown: string } =
      await ScrubTelemetryAction.apply({
        projectId: PROJECT_ID,
        proposal: proposalWith({ plan: EMAIL_PLAN }),
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
        scrubRuleName: "Data Security: Email address in attributes.user.email",
        created: true,
      },
    ]);
    expect(marks).toEqual([{ id: EMAIL_FINDING, isScrubbed: true }]);
    expect(evaluations).toHaveBeenCalledWith(PROJECT_ID);
    expect(made.summaryMarkdown).toContain(
      "Data Security: Email address in attributes.user.email",
    );
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
      proposal: proposalWith({ plan: EMAIL_PLAN }),
      actor: { props: { isRoot: true } },
    });

    expect(created).not.toHaveBeenCalled();
    expect(readScrubResult(made.result)).toEqual([
      expect.objectContaining({ scrubRuleId: EXISTING_RULE, created: false }),
    ]);
  });

  test("is all or nothing: the rules it made before a refusal are taken back", async () => {
    const twoPlaces: ScrubPlan = {
      ...EMAIL_PLAN,
      places: [
        ...EMAIL_PLAN.places,
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
  });

  test("skips a place whose finding is gone", async () => {
    jest.spyOn(DataStoreFindingService, "findOneBy").mockResolvedValue(null);

    const made: { result: unknown } = await ScrubTelemetryAction.apply({
      projectId: PROJECT_ID,
      proposal: proposalWith({ plan: EMAIL_PLAN }),
      actor: { props: { isRoot: true } },
    });

    expect(created).not.toHaveBeenCalled();
    expect(readScrubResult(made.result)).toEqual([]);
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
        proposal: proposalWith({ plan: EMAIL_PLAN, result: MADE_AND_KEPT }),
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

  test("a rule someone deleted since is undone already", async () => {
    jest.spyOn(LogScrubRuleService, "findOneById").mockResolvedValue(null);
    const deleted: SpyInstance<typeof LogScrubRuleService.deleteOneById> = jest
      .spyOn(LogScrubRuleService, "deleteOneById")
      .mockResolvedValue(1);

    await ScrubTelemetryAction.undo({
      projectId: PROJECT_ID,
      proposal: proposalWith({ plan: EMAIL_PLAN, result: MADE_AND_KEPT }),
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
          EMAIL_PLAN.places[0],
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
    ).toEqual([EMAIL_PLAN.places[0]]);
    expect(readScrubPlan({ kind: "Floppy", places: [] })).toBeNull();
    expect(readScrubPlan(null)).toBeNull();
    expect(
      readScrubResult({
        rules: [{ scrubRuleId: "nope", signal: "log" }, null],
      }),
    ).toEqual([]);
  });
});
