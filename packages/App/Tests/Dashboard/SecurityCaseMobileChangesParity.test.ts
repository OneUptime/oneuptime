import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import { SECURITY_CASE_VERDICTS } from "Common/Types/SecurityCase/SecurityCaseVerdict";
import { JSONObject } from "Common/Types/JSON";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  buildTestPriority,
  buildTestStatus,
} from "Common/Tests/Helpers/SecurityCaseValues";
import {
  SecurityCaseValueChoice,
  getSecurityCaseAssignWrite,
  getSecurityCasePriorityChoices,
  getSecurityCasePriorityWrite,
  getSecurityCaseStatusChoices,
  getSecurityCaseStatusWrite,
  isAssignToMeOffered,
  isAssignToSomeoneElseOffered,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseChanges";

/*
 * A CASE CHANGES THE SAME WAY FROM THE PHONE AS FROM THE DASHBOARD.
 *
 * The OneUptime On-Call app works a security case with the dashboard's four
 * moves - Assign to Me, Assign to Someone Else, Change Status (Close Case
 * and Reopen among them) and Change Priority - through the same API, from
 * its own copy of the rules (MobileApp/src/security/caseChanges and
 * caseValues), because the app is built without the dashboard's code. This
 * suite compiles the app's files as they are and asks them, next to the
 * dashboard's SecurityCaseChanges, the same questions over a new project's
 * statuses and one with statuses of its own and an archived one: which moves
 * a case is offered, what each writes, and the choices the sheets offer. An
 * answer that differs fails here, whichever side moved.
 */

const MOBILE_SECURITY: string = path.resolve(
  __dirname,
  "../../../MobileApp/src/security",
);

type ModuleExports = Record<string, unknown>;

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
    fileName,
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

const caseValues: ModuleExports = loadMobileModule("caseValues.ts", {});
const caseTerms: ModuleExports = loadMobileModule("caseTerms.ts", {});
const caseChanges: ModuleExports = loadMobileModule("caseChanges.ts", {
  "./caseValues": caseValues,
  "./caseTerms": caseTerms,
});

interface MobileRow {
  _id: string;
  [key: string]: unknown;
}

type MobileWrite = Record<string, string | null>;

const mobile: {
  getStatusWrite: (data: {
    statuses: Array<MobileRow>;
    fromStatusId: string | null;
    pick: { statusId: string; verdict?: unknown; closingNote?: unknown };
  }) => MobileWrite;
  getAssignWrite: (userId: string) => MobileWrite;
  getPriorityWrite: (priorityId: string) => MobileWrite;
  isAssignToMeOffered: (data: {
    statuses: Array<MobileRow>;
    statusId: string | null;
    assignedToUserId: string | null;
    userId: string;
  }) => boolean;
  isAssignToSomeoneElseOffered: (data: {
    statuses: Array<MobileRow>;
    statusId: string | null;
  }) => boolean;
  getCaseValueChoices: (
    values: Array<MobileRow>,
    currentId: string | null,
  ) => Array<{ value: MobileRow; isCurrent: boolean; isArchived: boolean }>;
} = {
  ...caseChanges,
  getCaseValueChoices: caseValues["getCaseValueChoices"],
} as unknown as typeof mobile;

/*
 * A status or priority as the app's API read hands it back: plain JSON with
 * its id as text, its place, its built-in flags and when it was made.
 */
const API_COLUMNS: Array<string> = [
  "order",
  "isArchived",
  "isNewStatus",
  "isAcknowledgedStatus",
  "isContainedStatus",
  "isClosedStatus",
  "isCriticalPriority",
  "isHighPriority",
  "isMediumPriority",
  "isLowPriority",
  "isInformationalPriority",
];

function asApiRow(value: SecurityCaseStatus | SecurityCasePriority): MobileRow {
  const record: JSONObject = value as unknown as JSONObject;
  const row: MobileRow = { _id: value._id!.toString() };

  for (const column of API_COLUMNS) {
    const entry: unknown = record[column];

    if (typeof entry === "boolean" || typeof entry === "number") {
      row[column] = entry;
    }
  }

  row["createdAt"] = value.createdAt
    ? new Date(value.createdAt).toISOString()
    : null;

  return row;
}

const ME: string = "4c0b0b7e-0001-4000-8000-000000000001";
const SOMEONE: string = "4c0b0b7e-0002-4000-8000-000000000002";

const OWN_STATUSES: Array<SecurityCaseStatus> = [
  ...buildDefaultTestStatuses(),
  buildTestStatus({
    id: "c2000000-0000-4000-8000-0000000000a1",
    name: "Queued",
    order: 1.5,
  }),
  buildTestStatus({
    id: "c2000000-0000-4000-8000-0000000000a2",
    name: "Eradicating",
    order: 3.5,
  }),
  buildTestStatus({
    id: "c2000000-0000-4000-8000-0000000000a3",
    name: "Closed - Duplicate",
    order: 5,
  }),
  buildTestStatus({
    id: "c2000000-0000-4000-8000-0000000000a4",
    name: "Retired",
    order: 2.5,
    isArchived: true,
  }),
];

const STATUS_LISTS: Array<[string, Array<SecurityCaseStatus>]> = [
  ["a new project's statuses", buildDefaultTestStatuses()],
  ["statuses of the project's own, one archived", OWN_STATUSES],
];

const PRIORITIES: Array<SecurityCasePriority> = [
  ...buildDefaultTestPriorities(),
  buildTestPriority({
    id: "c1000000-0000-4000-8000-0000000000b1",
    name: "Emergency",
    order: 0.5,
  }),
  buildTestPriority({
    id: "c1000000-0000-4000-8000-0000000000b2",
    name: "Retired",
    order: 2.5,
    isArchived: true,
  }),
];

function caseIn(data: {
  statusId: string | null;
  assignedToUserId?: string | null;
  priorityId?: string | null;
}): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();

  if (data.statusId) {
    securityCase.securityCaseStatusId = new ObjectID(data.statusId);
  }

  if (data.assignedToUserId) {
    securityCase.assignedToUserId = new ObjectID(data.assignedToUserId);
  }

  if (data.priorityId) {
    securityCase.securityCasePriorityId = new ObjectID(data.priorityId);
  }

  return securityCase;
}

function choiceRows(
  choices: Array<SecurityCaseValueChoice>,
): Array<[string, boolean, boolean]> {
  return choices.map(
    (choice: SecurityCaseValueChoice): [string, boolean, boolean] => {
      return [choice.id, choice.isCurrent, choice.isArchived];
    },
  );
}

const VERDICTS: Array<string | undefined> = [
  ...SECURITY_CASE_VERDICTS.map((term: { verdict: string }) => {
    return term.verdict;
  }),
  undefined,
  "Probably fine",
];

const NOTES: Array<string | undefined> = [
  undefined,
  "",
  "  The scanner is ours.  ",
];

describe.each(STATUS_LISTS)(
  "over %s",
  (_name: string, statuses: Array<SecurityCaseStatus>) => {
    const rows: Array<MobileRow> = statuses.map(asApiRow);
    const statusIds: Array<string | null> = [
      ...statuses.map((status: SecurityCaseStatus) => {
        return status._id!.toString();
      }),
      null,
    ];

    test("every status change writes what the dashboard writes", () => {
      let compared: number = 0;

      for (const from of statusIds) {
        for (const to of statusIds) {
          if (!to) {
            continue;
          }

          for (const verdict of VERDICTS) {
            for (const closingNote of NOTES) {
              const pick: {
                statusId: string;
                verdict?: string | undefined;
                closingNote?: string | undefined;
              } = { statusId: to, verdict, closingNote };

              expect({
                from,
                pick,
                write: mobile.getStatusWrite({
                  statuses: rows,
                  fromStatusId: from,
                  pick,
                }),
              }).toEqual({
                from,
                pick,
                write: getSecurityCaseStatusWrite({
                  securityCase: caseIn({ statusId: from }),
                  pick: pick as Parameters<
                    typeof getSecurityCaseStatusWrite
                  >[0]["pick"],
                  statuses,
                }),
              });
              compared++;
            }
          }
        }
      }

      expect(compared).toBeGreaterThan(100);
    });

    test("Assign to Me and Assign to Someone Else are offered where the dashboard offers them", () => {
      for (const statusId of statusIds) {
        for (const assignedToUserId of [null, ME, SOMEONE]) {
          const question: {
            statusId: string | null;
            assignedToUserId: string | null;
          } = { statusId, assignedToUserId };

          expect({
            ...question,
            toMe: mobile.isAssignToMeOffered({
              statuses: rows,
              statusId,
              assignedToUserId,
              userId: ME,
            }),
            toSomeoneElse: mobile.isAssignToSomeoneElseOffered({
              statuses: rows,
              statusId,
            }),
          }).toEqual({
            ...question,
            toMe: isAssignToMeOffered({
              securityCase: caseIn({ statusId, assignedToUserId }),
              statuses,
              myUserId: ME,
            }),
            toSomeoneElse: isAssignToSomeoneElseOffered({
              securityCase: caseIn({ statusId, assignedToUserId }),
              statuses,
            }),
          });
        }
      }
    });

    test("Change Status offers the statuses the dashboard's dialog offers", () => {
      for (const statusId of statusIds) {
        expect({
          statusId,
          choices: mobile
            .getCaseValueChoices(rows, statusId)
            .map((choice: {
              value: MobileRow;
              isCurrent: boolean;
              isArchived: boolean;
            }): [string, boolean, boolean] => {
              return [choice.value._id, choice.isCurrent, choice.isArchived];
            }),
        }).toEqual({
          statusId,
          choices: choiceRows(
            getSecurityCaseStatusChoices({
              statuses,
              securityCases: [caseIn({ statusId })],
            }),
          ),
        });
      }
    });
  },
);

describe("assigning and setting a priority", () => {
  test("giving a case to a person writes the person, as the dashboard does", () => {
    for (const userId of [ME, SOMEONE]) {
      expect(mobile.getAssignWrite(userId)).toEqual(
        getSecurityCaseAssignWrite({ userId }),
      );
    }
  });

  test("a priority writes its id, as the dashboard does", () => {
    for (const priority of PRIORITIES) {
      const id: string = priority._id!.toString();

      expect(mobile.getPriorityWrite(id)).toEqual(
        getSecurityCasePriorityWrite(id),
      );
    }
  });

  test("Change Priority offers the priorities the dashboard's dialog offers, most urgent first", () => {
    const rows: Array<MobileRow> = PRIORITIES.map(asApiRow);

    for (const priority of [...PRIORITIES, null]) {
      const priorityId: string | null = priority
        ? priority._id!.toString()
        : null;

      expect({
        priorityId,
        choices: mobile
          .getCaseValueChoices(rows, priorityId)
          .map((choice: {
            value: MobileRow;
            isCurrent: boolean;
            isArchived: boolean;
          }): [string, boolean, boolean] => {
            return [choice.value._id, choice.isCurrent, choice.isArchived];
          }),
      }).toEqual({
        priorityId,
        choices: choiceRows(
          getSecurityCasePriorityChoices({
            priorities: PRIORITIES,
            securityCases: [caseIn({ statusId: null, priorityId })],
          }),
        ),
      });
    }
  });
});

test("the closed status the app moves Close Case to is the dashboard's", () => {
  const rows: Array<MobileRow> = OWN_STATUSES.map(asApiRow);
  const getCaseStatusOfStage: (
    statuses: Array<MobileRow>,
    stage: string,
  ) => MobileRow | undefined = caseValues["getCaseStatusOfStage"] as (
    statuses: Array<MobileRow>,
    stage: string,
  ) => MobileRow | undefined;

  expect(getCaseStatusOfStage(rows, SecurityCaseStage.Closed)?._id).toBe(
    "c2000000-0000-4000-8000-000000000004",
  );
  expect(getCaseStatusOfStage(rows, SecurityCaseStage.Acknowledged)?._id).toBe(
    "c2000000-0000-4000-8000-000000000002",
  );
});
