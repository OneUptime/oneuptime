import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import SecurityCaseStatuses from "../../Utils/SecurityCase/SecurityCaseStatuses";
import SecurityCasePriorities from "../../Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStage, {
  SECURITY_CASE_STAGES,
} from "../../Types/SecurityCase/SecurityCaseStage";
import { SECURITY_CASE_VERDICTS } from "../../Types/SecurityCase/SecurityCaseVerdict";
import { SECURITY_CASE_AI_VERDICTS } from "../../Types/SecurityCase/SecurityCaseAiVerdict";
import { SecurityEntityType } from "../../Types/SecurityCase/SecurityEntity";
import { SECURITY_DETECTION_SOURCES } from "../../Types/SecurityCase/SecurityDetectionSource";
import { SECURITY_PLAYBOOK_ACTIONS } from "../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus from "../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookTargetState } from "../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import {
  SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX,
  parseInvestigationReport,
} from "../../Utils/AI/InvestigationReport";
import { seededRandom, type SeededRandom } from "../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MOBILE APP'S COPY OF THE SECURITY CASE RULES SAYS WHAT THE SERVER'S
 * SAYS, CASE FOR CASE - AND ITS WORDS ARE THE PRODUCT'S.
 *
 * The OneUptime On-Call app is built without Common's runtime code, so it
 * keeps its own copy of what a case's status and priority mean
 * (MobileApp/src/security/caseValues): which statuses a case is open in,
 * which close it and so ask for a verdict, where Close Case and Reopen move
 * it, and the priorities' ranking. A copy drifts. This suite compiles the
 * app's file as it is and runs it next to Common's SecurityCaseStatuses and
 * SecurityCasePriorities over the table both suites share and over
 * thousands of generated lists - places missing, tied, written as text,
 * flags on any status - asking each the same questions. Any answer that
 * differs fails here, whichever side moved.
 *
 * It also holds the app's tables to Common's: the verdicts a case closes
 * with and what each means, OneUptime AI's reads, the entity types, the
 * case sources, every playbook action's title, the run and target states,
 * the triage report's heads-up prefix - so a value added or reworded on the
 * server fails here until the app has it too.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const MOBILE_SECURITY: string = path.join(
  REPOSITORY_ROOT,
  "packages/MobileApp/src/security",
);
const RULE_CASES: string = path.join(
  REPOSITORY_ROOT,
  "packages/MobileApp/src/__tests__/securityCaseRuleCases.json",
);
const RUN_API_SOURCE: string = path.join(
  REPOSITORY_ROOT,
  "packages/Common/Server/API/SecurityPlaybookRunAPI.ts",
);

type ModuleExports = Record<string, unknown>;

interface MobileStatus {
  _id: string;
  order?: number | string | null;
  createdAt?: string | null;
  isNewStatus?: boolean;
  isAcknowledgedStatus?: boolean;
  isContainedStatus?: boolean;
  isClosedStatus?: boolean;
  isArchived?: boolean;
}

interface MobilePriority {
  _id: string;
  order?: number | string | null;
  createdAt?: string | null;
  isCriticalPriority?: boolean;
  isHighPriority?: boolean;
  isMediumPriority?: boolean;
  isLowPriority?: boolean;
  isInformationalPriority?: boolean;
}

interface MobileValueRules {
  SECURITY_CASE_STAGES: Array<string>;
  sortCaseValues: <T extends { _id: string }>(values: Array<T>) => Array<T>;
  findCaseValue: <T>(values: Array<T>, id: string | null) => T | undefined;
  getCaseStatusStage: (
    statuses: Array<MobileStatus>,
    statusId: string | null,
  ) => string | null;
  isCaseStatusClosed: (
    statuses: Array<MobileStatus>,
    statusId: string | null,
  ) => boolean;
  isCaseStatusOpen: (
    statuses: Array<MobileStatus>,
    statusId: string | null,
  ) => boolean;
  hasCaseStatusReached: (
    statuses: Array<MobileStatus>,
    statusId: string | null,
    stage: string,
  ) => boolean;
  getOpenCaseStatusIds: (statuses: Array<MobileStatus>) => Array<string>;
  getClosedCaseStatusIds: (statuses: Array<MobileStatus>) => Array<string>;
  getCaseStatusOfStage: (
    statuses: Array<MobileStatus>,
    stage: string,
  ) => MobileStatus | undefined;
  doesStatusCloseCase: (data: {
    statuses: Array<MobileStatus>;
    fromStatusId: string | null;
    toStatusId: string | null;
  }) => boolean;
  getCasePriorityRank: (
    priorities: Array<MobilePriority>,
    priorityId: string | null,
  ) => number | null;
  isCasePriorityUrgent: (
    priorities: Array<MobilePriority>,
    priorityId: string | null,
  ) => boolean;
}

/*
 * One of the app's files compiled to CommonJS as it is and run in a fresh
 * context. Its imports are the app's other files this suite loaded, by the
 * path the file names them with; a type-only import compiles away.
 */
function loadMobileModule(
  fileName: string,
  modules: Record<string, ModuleExports>,
): ModuleExports {
  const source: string = fs.readFileSync(
    path.join(MOBILE_SECURITY, fileName),
    "utf8",
  );

  const compiled: string = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: fileName,
  }).outputText;

  const moduleObject: { exports: ModuleExports } = { exports: {} };

  vm.runInNewContext(compiled, {
    module: moduleObject,
    exports: moduleObject.exports,
    require: (specifier: string): ModuleExports => {
      const required: ModuleExports | undefined = modules[specifier];

      if (!required) {
        throw new Error(
          `The app's ${fileName} imports ${specifier}, which this suite does not provide.`,
        );
      }

      return required;
    },
  });

  return moduleObject.exports;
}

const caseValuesModule: ModuleExports = loadMobileModule("caseValues.ts", {});
const caseTermsModule: ModuleExports = loadMobileModule("caseTerms.ts", {});
const playbookApprovalModule: ModuleExports = loadMobileModule(
  "playbookApproval.ts",
  { "./caseTerms": caseTermsModule },
);

const MOBILE: MobileValueRules =
  caseValuesModule as unknown as MobileValueRules;

// The server's answers to the questions the app asks.
const SERVER: MobileValueRules = {
  SECURITY_CASE_STAGES: [...SECURITY_CASE_STAGES],
  sortCaseValues: <T extends { _id: string }>(values: Array<T>): Array<T> => {
    return SecurityCaseStatuses.sort(values);
  },
  findCaseValue: <T>(values: Array<T>, id: string | null): T | undefined => {
    return SecurityCaseStatuses.find(values, id) ?? undefined;
  },
  getCaseStatusStage: (
    statuses: Array<MobileStatus>,
    statusId: string | null,
  ): string | null => {
    return SecurityCaseStatuses.getStage(statuses, statusId);
  },
  isCaseStatusClosed: (
    statuses: Array<MobileStatus>,
    statusId: string | null,
  ): boolean => {
    return SecurityCaseStatuses.isClosed(statuses, statusId);
  },
  isCaseStatusOpen: (
    statuses: Array<MobileStatus>,
    statusId: string | null,
  ): boolean => {
    return SecurityCaseStatuses.isOpen(statuses, statusId);
  },
  hasCaseStatusReached: (
    statuses: Array<MobileStatus>,
    statusId: string | null,
    stage: string,
  ): boolean => {
    return SecurityCaseStatuses.hasReached(
      statuses,
      statusId,
      stage as SecurityCaseStage,
    );
  },
  getOpenCaseStatusIds: (statuses: Array<MobileStatus>): Array<string> => {
    return SecurityCaseStatuses.getOpenStatusIds(statuses);
  },
  getClosedCaseStatusIds: (statuses: Array<MobileStatus>): Array<string> => {
    return SecurityCaseStatuses.getClosedStatusIds(statuses);
  },
  getCaseStatusOfStage: (
    statuses: Array<MobileStatus>,
    stage: string,
  ): MobileStatus | undefined => {
    return (
      SecurityCaseStatuses.getStatusOfStage(
        statuses,
        stage as SecurityCaseStage,
      ) ?? undefined
    );
  },
  doesStatusCloseCase: (data: {
    statuses: Array<MobileStatus>;
    fromStatusId: string | null;
    toStatusId: string | null;
  }): boolean => {
    return SecurityCaseStatuses.getStatusChange(data).closes;
  },
  getCasePriorityRank: (
    priorities: Array<MobilePriority>,
    priorityId: string | null,
  ): number | null => {
    return SecurityCasePriorities.getRank(priorities, priorityId);
  },
  isCasePriorityUrgent: (
    priorities: Array<MobilePriority>,
    priorityId: string | null,
  ): boolean => {
    return SecurityCasePriorities.isUrgent(priorities, priorityId);
  },
};

const FOREIGN_ID: string = "somewhere-else";

interface StatusAnswers {
  sorted: Array<string>;
  open: Array<string>;
  closed: Array<string>;
  statusOfStage: Record<string, string | null>;
  byId: Record<string, [string | null, boolean, boolean, Array<boolean>]>;
  closes: Record<string, boolean>;
}

// Every question both copies are asked about one list of statuses.
function askStatuses(
  rules: MobileValueRules,
  statuses: Array<MobileStatus>,
): StatusAnswers {
  const lookups: Array<string | null> = [FOREIGN_ID, "", null];

  for (const status of statuses) {
    lookups.push(status._id, status._id.toUpperCase(), ` ${status._id} `);
  }

  const byId: StatusAnswers["byId"] = {};

  for (const statusId of lookups) {
    byId[JSON.stringify(statusId)] = [
      rules.getCaseStatusStage(statuses, statusId),
      rules.isCaseStatusClosed(statuses, statusId),
      rules.isCaseStatusOpen(statuses, statusId),
      SECURITY_CASE_STAGES.map((stage: SecurityCaseStage): boolean => {
        return rules.hasCaseStatusReached(statuses, statusId, stage);
      }),
    ];
  }

  const closes: Record<string, boolean> = {};

  for (const from of [
    ...statuses.map((s: MobileStatus) => {
      return s._id;
    }),
    null,
  ]) {
    for (const to of [
      ...statuses.map((s: MobileStatus) => {
        return s._id;
      }),
      null,
    ]) {
      closes[`${String(from)}->${String(to)}`] = rules.doesStatusCloseCase({
        statuses,
        fromStatusId: from,
        toStatusId: to,
      });
    }
  }

  const statusOfStage: Record<string, string | null> = {};

  for (const stage of SECURITY_CASE_STAGES) {
    statusOfStage[stage] =
      rules.getCaseStatusOfStage(statuses, stage)?._id ?? null;
  }

  return {
    sorted: rules.sortCaseValues(statuses).map((status: MobileStatus) => {
      return status._id;
    }),
    open: rules.getOpenCaseStatusIds(statuses),
    closed: rules.getClosedCaseStatusIds(statuses),
    statusOfStage,
    byId,
    closes,
  };
}

interface PriorityAnswers {
  sorted: Array<string>;
  byId: Record<string, [number | null, boolean]>;
}

function askPriorities(
  rules: MobileValueRules,
  priorities: Array<MobilePriority>,
): PriorityAnswers {
  const lookups: Array<string | null> = [FOREIGN_ID, "", null];

  for (const priority of priorities) {
    lookups.push(priority._id, priority._id.toUpperCase());
  }

  const byId: PriorityAnswers["byId"] = {};

  for (const priorityId of lookups) {
    byId[JSON.stringify(priorityId)] = [
      rules.getCasePriorityRank(priorities, priorityId),
      rules.isCasePriorityUrgent(priorities, priorityId),
    ];
  }

  return {
    sorted: (rules === SERVER
      ? SecurityCasePriorities.sort(priorities)
      : rules.sortCaseValues(priorities)
    ).map((priority: MobilePriority) => {
      return priority._id;
    }),
    byId,
  };
}

const ORDERS: Array<number | string | null | undefined> = [
  null,
  undefined,
  1,
  2,
  3,
  4,
  5,
  0,
  -1,
  "3",
  " ",
  2.5,
];

const CREATED: Array<string | undefined> = [
  undefined,
  "2026-01-01T00:00:00.000Z",
  "2026-02-01T00:00:00.000Z",
];

const STATUS_FLAGS: Array<Partial<MobileStatus>> = [
  {},
  {},
  { isNewStatus: true },
  { isAcknowledgedStatus: true },
  { isContainedStatus: true },
  { isClosedStatus: true },
  { isClosedStatus: true },
  { isAcknowledgedStatus: true, isClosedStatus: true },
];

const PRIORITY_FLAGS: Array<Partial<MobilePriority>> = [
  {},
  { isCriticalPriority: true },
  { isHighPriority: true },
  { isHighPriority: true },
  { isMediumPriority: true },
  { isLowPriority: true },
  { isInformationalPriority: true },
];

const IDS: Array<string> = [
  "0193c0de-5a7e-4eee-8fff-00000000d0a1",
  "0193c0de-5a7e-4eee-8fff-00000000d0a2",
  "0193c0de-5a7e-4eee-8fff-00000000d0a3",
  "0193c0de-5a7e-4eee-8fff-00000000d0a4",
  "0193c0de-5a7e-4eee-8fff-00000000d0a5",
  "0193c0de-5a7e-4eee-8fff-00000000d0a6",
  "0193c0de-5a7e-4eee-8fff-00000000d0a7",
];

function makeRow<T extends { _id: string }>(
  id: string,
  order: number | string | null | undefined,
  created: string | undefined,
  flags: Partial<T>,
): T {
  const row: Record<string, unknown> = { _id: id, ...flags };

  if (order !== undefined) {
    row["order"] = order;
  }

  if (created !== undefined) {
    row["createdAt"] = created;
  }

  return row as T;
}

// Lists of two to seven rows, places, times and flags drawn at random.
function randomLists<T extends { _id: string }>(
  count: number,
  seed: number,
  flags: Array<Partial<T>>,
): Array<Array<T>> {
  const random: SeededRandom = seededRandom(seed);
  const lists: Array<Array<T>> = [];

  for (let index: number = 0; index < count; index++) {
    const size: number = 2 + random(6);
    const ids: Array<string> = [...IDS];

    // A partial Fisher-Yates draw of `size` ids.
    for (let place: number = 0; place < size; place++) {
      const other: number = place + random(ids.length - place);
      const swap: string = ids[place]!;
      ids[place] = ids[other]!;
      ids[other] = swap;
    }

    lists.push(
      ids.slice(0, size).map((id: string): T => {
        return makeRow<T>(
          id,
          ORDERS[random(ORDERS.length)],
          CREATED[random(CREATED.length)],
          flags[random(flags.length)]!,
        );
      }),
    );
  }

  return lists;
}

describe("the app's copy of the rules loads from the app's own files", () => {
  test("every question this suite asks is answered by the app's copy", () => {
    for (const name of Object.keys(SERVER)) {
      expect({
        name,
        type: typeof (MOBILE as unknown as ModuleExports)[name],
      }).toEqual({
        name,
        type: name === "SECURITY_CASE_STAGES" ? "object" : "function",
      });
    }
  });

  test("its stages are Common's, in Common's order", () => {
    expect(MOBILE.SECURITY_CASE_STAGES).toEqual([...SECURITY_CASE_STAGES]);
  });

  test("it really is the rule: a status of the project's own counts as the built-in one above it", () => {
    const statuses: Array<MobileStatus> = [
      { _id: "new", order: 1, isNewStatus: true },
      { _id: "triage", order: 2 },
      { _id: "investigating", order: 3, isAcknowledgedStatus: true },
      { _id: "closed", order: 4, isClosedStatus: true },
      { _id: "closed-duplicate", order: 5 },
    ];

    expect(MOBILE.getCaseStatusStage(statuses, "triage")).toBe("New");
    expect(MOBILE.isCaseStatusClosed(statuses, "closed-duplicate")).toBe(true);
    expect(MOBILE.getOpenCaseStatusIds(statuses)).toEqual([
      "new",
      "triage",
      "investigating",
    ]);
  });
});

describe("the app and the server agree on what a case's status means", () => {
  test("on every case of the table both suites run", () => {
    const table: {
      statusCases: Array<{ name: string; statuses: Array<MobileStatus> }>;
    } = JSON.parse(fs.readFileSync(RULE_CASES, "utf8"));

    expect(table.statusCases.length).toBeGreaterThanOrEqual(6);

    for (const statusCase of table.statusCases) {
      expect({
        case: statusCase.name,
        ...askStatuses(MOBILE, statusCase.statuses),
      }).toEqual({
        case: statusCase.name,
        ...askStatuses(SERVER, statusCase.statuses),
      });
    }
  });

  test("on thousands of generated lists of two to seven statuses", () => {
    for (const statuses of randomLists<MobileStatus>(
      3000,
      20261025,
      STATUS_FLAGS,
    )) {
      expect({ statuses, ...askStatuses(MOBILE, statuses) }).toEqual({
        statuses,
        ...askStatuses(SERVER, statuses),
      });
    }
  });
});

describe("the app and the server agree on how urgent a case's priority is", () => {
  test("on every case of the table both suites run", () => {
    const table: {
      priorityCases: Array<{ name: string; priorities: Array<MobilePriority> }>;
    } = JSON.parse(fs.readFileSync(RULE_CASES, "utf8"));

    expect(table.priorityCases.length).toBeGreaterThanOrEqual(3);

    for (const priorityCase of table.priorityCases) {
      expect({
        case: priorityCase.name,
        ...askPriorities(MOBILE, priorityCase.priorities),
      }).toEqual({
        case: priorityCase.name,
        ...askPriorities(SERVER, priorityCase.priorities),
      });
    }
  });

  test("on thousands of generated lists of two to seven priorities", () => {
    for (const priorities of randomLists<MobilePriority>(
      3000,
      20261026,
      PRIORITY_FLAGS,
    )) {
      expect({ priorities, ...askPriorities(MOBILE, priorities) }).toEqual({
        priorities,
        ...askPriorities(SERVER, priorities),
      });
    }
  });
});

describe("the app's words are the product's", () => {
  test("the verdicts a case closes with, in the close dialog's order, with what each means", () => {
    expect(caseTermsModule["SECURITY_CASE_VERDICTS"]).toEqual(
      SECURITY_CASE_VERDICTS.map(
        (term: { verdict: string; description: string }) => {
          return { verdict: term.verdict, description: term.description };
        },
      ),
    );
  });

  test("OneUptime AI's reads, their sentences and the verdict each suggests", () => {
    const mobile: Array<Record<string, unknown>> = caseTermsModule[
      "SECURITY_CASE_AI_VERDICTS"
    ] as Array<Record<string, unknown>>;

    expect(
      mobile.map((term: Record<string, unknown>) => {
        return {
          verdict: term["verdict"],
          description: term["description"],
          suggestedCloseVerdict: term["suggestedCloseVerdict"],
        };
      }),
    ).toEqual(
      SECURITY_CASE_AI_VERDICTS.map(
        (term: {
          verdict: string;
          description: string;
          suggestedCloseVerdict?: string | undefined;
        }) => {
          return {
            verdict: term.verdict,
            description: term.description,
            suggestedCloseVerdict: term.suggestedCloseVerdict,
          };
        },
      ),
    );
  });

  test("every entity type the server stores, and nothing else", () => {
    const mobile: Array<{ type: string }> = caseTermsModule[
      "SECURITY_ENTITY_TERMS"
    ] as Array<{ type: string }>;

    expect(
      mobile
        .map((term: { type: string }) => {
          return term.type;
        })
        .sort(),
    ).toEqual([...Object.values(SecurityEntityType)].sort());
  });

  test("every source that opens a case reads in the app's own words", () => {
    const describeCaseSource: (source: unknown) => string = caseTermsModule[
      "describeCaseSource"
    ] as (source: unknown) => string;

    for (const source of SECURITY_DETECTION_SOURCES) {
      expect({ source, words: describeCaseSource(source) }).not.toEqual({
        source,
        words: source,
      });
    }
  });

  test("every playbook action, by the title the dashboard's step list reads", () => {
    const titles: Record<string, string> = playbookApprovalModule[
      "SECURITY_PLAYBOOK_ACTION_TITLES"
    ] as Record<string, string>;

    expect(titles).toEqual(
      Object.fromEntries(
        SECURITY_PLAYBOOK_ACTIONS.map(
          (action: { type: string; title: string }) => {
            return [action.type, action.title];
          },
        ),
      ),
    );
  });

  test("the run statuses, and the one a run waits for an approval in", () => {
    expect(playbookApprovalModule["SECURITY_PLAYBOOK_RUN_STATUSES"]).toEqual(
      Object.values(SecurityPlaybookRunStatus),
    );
    expect(playbookApprovalModule["WAITING_FOR_APPROVAL"]).toBe(
      SecurityPlaybookRunStatus.WaitingForApproval,
    );
  });

  test("every state a step's target can be in", () => {
    expect(playbookApprovalModule["SECURITY_PLAYBOOK_TARGET_STATES"]).toEqual(
      Object.values(SecurityPlaybookTargetState),
    );
  });

  test("every trigger that starts a run on its own is described", () => {
    const readWaitingPlaybookStep: (run: unknown) => {
      startedBy: string;
    } | null = playbookApprovalModule["readWaitingPlaybookStep"] as (
      run: unknown,
    ) => { startedBy: string } | null;

    for (const trigger of Object.values(SecurityPlaybookTrigger)) {
      const step: { startedBy: string } | null = readWaitingPlaybookStep({
        _id: IDS[0],
        status: SecurityPlaybookRunStatus.WaitingForApproval,
        trigger,
      });

      expect({ trigger, startedBy: step?.startedBy }).toEqual({
        trigger,
        startedBy:
          trigger === SecurityPlaybookTrigger.Manual
            ? "Started by hand"
            : expect.stringMatching(/^Started on its own/),
      });
    }
  });

  test("the triage report's heads-up starts the way the runner writes it", () => {
    expect(caseTermsModule["TRIAGE_INJECTION_LEAD_PREFIX"]).toBe(
      SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX,
    );
  });

  test("a run's starter is refused approval in the server's own words", () => {
    const source: string = fs.readFileSync(RUN_API_SOURCE, "utf8");
    const sentence: string = playbookApprovalModule[
      "SELF_APPROVAL_SENTENCE"
    ] as string;

    expect(sentence.length).toBeGreaterThan(20);
    expect(source.indexOf(JSON.stringify(sentence))).toBeGreaterThan(-1);
  });
});

/*
 * The case's screen shows the triage report's Summary before anything is
 * tapped (MobileApp/src/security/caseTerms, splitTriageReport), as the
 * dashboard lifts it above the report. The app reads the report with a
 * smaller reader of its own; what it lifts must be what Common's report
 * parser calls the Summary - all of it for the shapes the triage writes,
 * and never anything past it for any other report, so nothing from
 * another section is ever shown as what OneUptime AI found.
 */
describe("the Summary the app lifts from a triage report is the parser's own", () => {
  const splitTriageReport: (markdown: unknown) => {
    summary: string;
    rest: string;
  } = caseTermsModule["splitTriageReport"] as (markdown: unknown) => {
    summary: string;
    rest: string;
  };
  const HEADING: string = "## 🧠 AI — Security Case Triage";
  const FOOTER: string =
    "---\n*Investigated automatically by OneUptime AI — read-only, 3 queries run across your own telemetry. This is an AI-generated first pass; verify before acting.*";
  const LEAD: string = `${SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX} - a sign of an attempt to steer the triage. OneUptime AI treated it as data and leaves the call to a person.`;
  const REST: Array<string> = [
    "",
    "**Assessment**",
    "Likely malicious: the address is on a password-spray list [C1].",
    "",
    "**Evidence**",
    "- 14 failed sign-ins in six minutes [C1]",
    "",
    "**Suggested next steps**",
    "1. Suspend alice@acme.test in Okta.",
    "",
    "**Evidence checked**",
    "- **[C1]** Security events for alice@acme.test — 15 row(s)",
    "",
    FOOTER,
  ];

  function report(...lines: Array<string>): string {
    return [HEADING, "", ...lines].join("\n");
  }

  function parserSummary(markdown: string): string {
    return parseInvestigationReport(markdown).summary || "";
  }

  test("all of it, however the triage writes its Summary", () => {
    const reports: Array<string> = [
      report(
        "**Summary**",
        "Fourteen failed VPN sign-ins for alice@acme.test, then one that succeeded.",
        "This is most likely a password spray.",
        ...REST,
      ),
      report("**Summary**", "", "A spray.", ...REST),
      report("**Summary:**", "A spray.", ...REST),
      report("**Summary** - A spray.", ...REST),
      report("**Summary** — A spray.", ...REST),
      report("**Summary:** A spray.", ...REST),
      report("**Summary**: A spray.", ...REST),
      report("***Summary***", "A spray.", ...REST),
      report("__Summary__", "A spray.", ...REST),
      report("**Summary (high confidence)**", "A spray.", ...REST),
      report("**TL;DR**", "A spray.", ...REST),
      report("## Summary", "A spray.", ...REST),
      report("### Summary ###", "A spray.", ...REST),
      report("Summary: A spray.", ...REST),
      report(
        "**Summary**",
        "A spray.",
        "- 14 failures",
        "- 1 success",
        ...REST,
      ),
      report("**Summary**", "A spray."),
      report("**Summary**", "A spray.", "", FOOTER),
      report(LEAD, "", "**Summary**", "A spray.", ...REST),
    ];

    for (const markdown of reports) {
      const lifted: string = splitTriageReport(markdown).summary;

      expect(lifted).not.toBe("");
      expect(lifted).toBe(parserSummary(markdown));
    }
  });

  test("never anything past it, on thousands of generated reports", () => {
    const random: SeededRandom = seededRandom(5280);
    const openings: Array<string> = [
      "**Summary**",
      "**Summary:**",
      "**Summary** - It began.",
      "**Summary:** It began.",
      "## Summary",
      "### Summary ###",
      "Summary: It began.",
      "**TL;DR**",
      "***Summary***",
      "__Summary__",
      "**Summary (draft)**",
      "**Summary** (draft) - It began.",
      "Summary (v2): It began.",
      "**Summary** is below.",
      "**Summary",
      "Some words first.",
      LEAD,
    ];
    const lines: Array<string> = [
      "A sentence.",
      "Another one [C1].",
      "",
      "",
      "**Assessment**",
      "**Assessment:** bad.",
      "**Assessment** — bad.",
      "**Evidence**",
      "**Evidence:** rows.",
      "Evidence: rows.",
      "Root cause (likely): a leak.",
      "## Evidence",
      "### Detail",
      "- a list item",
      "  - a nested item",
      "1. a first step",
      "---",
      "***",
      "```",
      "~~~",
      "    indented code",
      "**Alice** signed in.",
      "**Note:** the address is new.",
      "**Confidence: medium**",
      "*an italic line*",
      "> a quote",
      "Summary: again",
      "**Summary**",
      "Plain: a label the parser does not know",
      "🔎 Evidence",
      "**🔎 Evidence**",
      "| a | b |",
      FOOTER,
    ];
    let lifted: number = 0;

    for (let run: number = 0; run < 5000; run++) {
      const reportLines: Array<string> = [openings[random(openings.length)]!];
      const count: number = random(10);

      for (let index: number = 0; index < count; index++) {
        reportLines.push(lines[random(lines.length)]!);
      }

      const markdown: string = report(...reportLines);
      const parts: { summary: string; rest: string } =
        splitTriageReport(markdown);

      if (parts.summary) {
        lifted++;
        expect(parserSummary(markdown).startsWith(parts.summary)).toBe(true);
        // What is not lifted is still there: the folded rest is the report's tail.
        expect(markdown.trimEnd().endsWith(parts.rest)).toBe(true);
      }
    }

    // The sweep reached the lifted case often enough to mean something.
    expect(lifted).toBeGreaterThan(1000);
  });
});
