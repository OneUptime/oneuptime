import DatabaseModels from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  ALL_ALWAYS_ASK_WRITES,
  ALWAYS_ASK_ACTIONS,
  ALWAYS_ASK_CHANGES,
  AlwaysAskChange,
  AlwaysAskCondition,
  AlwaysAskPage,
  AlwaysAskRecordWrite,
  AlwaysAskWrite,
  AlwaysAskWriteFound,
  DATA_SECURITY_ISSUE_TABLE_NAME,
  DATA_STORE_FINDING_TABLE_NAME,
  LABEL_RULE_TERMS,
  OWNER_RULE_TERMS,
  PLAYBOOK_REACH_COLUMNS,
  RESIDENCY_RULE_TERMS,
  RESPONSE_ON_A_STORE_STEPS,
  actionAlwaysAsks,
  isStepGuardedByApproval,
  doCriticalIssuesPage,
  findAlwaysAskChange,
  getAlwaysAskChangesOfTable,
  getAsksInEveryModeRefusal,
  writeAlwaysAsks,
} from "../../../Types/AI/AIAlwaysAskChanges";
import {
  ASKS_IN_EVERY_MODE_REFUSAL_PREFIX,
  CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME,
  DATA_SECURITY_ACTION_TOOL_NAMES,
  DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
  FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME,
  JUDGE_DATA_SECURITY_FINDING_TOOL_NAME,
  RESPOND_ON_DATA_STORE_TOOL_NAME,
  SAVE_DATA_SECURITY_RULE_TOOL_NAME,
  SCRUB_DATA_SECURITY_FINDING_TOOL_NAME,
  SET_DATA_STORE_OWNERS_TOOL_NAME,
} from "../../../Types/AI/AIDataSecurityActions";
import { AI_DATA_SECURITY_ACTION_ASKS_BECAUSE } from "../../../Types/AI/AIDataSecurityActionWords";
import DataSecurityIssueStatus, {
  ALL_DATA_SECURITY_ISSUE_STATUSES,
} from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { JSONObject } from "../../../Types/JSON";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  getConfirmFindingWrite,
  getNotSensitiveFindingWrite,
  getSensitiveAgainFindingWrite,
} from "../../../Utils/DataSecurity/DataStoreFindingDecisions";
import {
  getIssueAssignWrite,
  getIssueMoveWrite,
  IssueMove,
  ISSUE_MOVES,
} from "../../../Utils/DataSecurity/DataSecurityIssueChanges";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT ONEUPTIME ASKS A PERSON BEFORE, AS THE RECORDS IT WRITES (#11177).
 *
 * The one list Ask AI's actions ask by and the MCP server holds every
 * record's write to. These hold what it says about each change: the write
 * that makes it is found, the person's ordinary edits of the same record
 * are not, a value is read as the database stores it, and what it names -
 * tables, columns, actions - is real.
 */

function found(
  tableName: string,
  write: AlwaysAskWrite,
  data?: JSONObject,
  stored?: JSONObject | null,
): string | null {
  return (
    findAlwaysAskChange({ tableName, write, data: data || {}, stored })?.change
      .name || null
  );
}

function issueUpdate(data: JSONObject): string | null {
  return found(DATA_SECURITY_ISSUE_TABLE_NAME, AlwaysAskWrite.Update, data);
}

function findingUpdate(data: JSONObject): string | null {
  return found(DATA_STORE_FINDING_TABLE_NAME, AlwaysAskWrite.Update, data);
}

const MODELS_BY_TABLE: Map<string, DatabaseBaseModel> = new Map(
  DatabaseModels.map((ModelClass: { new (): DatabaseBaseModel }) => {
    const model: DatabaseBaseModel = new ModelClass();

    return [model.tableName || ModelClass.name, model];
  }),
);

describe("an issue's write", () => {
  test("setting its status to Accepted is Accept Risk, as the button sends it", () => {
    expect(
      issueUpdate(
        getIssueMoveWrite(IssueMove.Accept, {
          reason: "Compensating control",
          until: new Date("2027-01-31T23:59:59.999Z"),
        }),
      ),
    ).toBe("Accept Risk");
    expect(issueUpdate({ status: DataSecurityIssueStatus.Accepted })).toBe(
      "Accept Risk",
    );
  });

  test("setting its status to Not an issue is Not an Issue, with a reason or without", () => {
    expect(
      issueUpdate(
        getIssueMoveWrite(IssueMove.NotAnIssue, undefined, "A test fixture"),
      ),
    ).toBe("Not an Issue");
    expect(issueUpdate(getIssueMoveWrite(IssueMove.NotAnIssue))).toBe(
      "Not an Issue",
    );
  });

  test("a status is read whatever its case and the space around it", () => {
    for (const status of [
      "accepted",
      " Accepted ",
      "ACCEPTED",
      "\tAccepted\n",
    ]) {
      expect({ status, change: issueUpdate({ status }) }).toEqual({
        status,
        change: "Accept Risk",
      });
    }

    for (const status of ["not an issue", "NOT AN ISSUE", " Not an issue "]) {
      expect({ status, change: issueUpdate({ status }) }).toEqual({
        status,
        change: "Not an Issue",
      });
    }
  });

  test("Reopen, Mark Resolved, Assign and Unassign are the person's own edits", () => {
    expect(issueUpdate(getIssueMoveWrite(IssueMove.Reopen))).toBeNull();
    expect(issueUpdate(getIssueMoveWrite(IssueMove.Resolve))).toBeNull();
    expect(
      issueUpdate(
        getIssueAssignWrite({ userId: "10378000-0000-4000-8000-0000000000c1" }),
      ),
    ).toBeNull();
    expect(issueUpdate(getIssueAssignWrite({}))).toBeNull();
  });

  test("of every move the Dashboard offers, exactly Accept Risk and Not an Issue ask", () => {
    const asking: Array<IssueMove> = ISSUE_MOVES.filter(
      (move: IssueMove): boolean => {
        return issueUpdate(getIssueMoveWrite(move)) !== null;
      },
    );

    expect([...asking].sort()).toEqual(
      [IssueMove.Accept, IssueMove.NotAnIssue].sort(),
    );
  });

  test("of every status, exactly Accepted and Not an issue ask", () => {
    expect(
      ALL_DATA_SECURITY_ISSUE_STATUSES.filter(
        (status: DataSecurityIssueStatus): boolean => {
          return issueUpdate({ status }) !== null;
        },
      ).sort(),
    ).toEqual(
      [
        DataSecurityIssueStatus.Accepted,
        DataSecurityIssueStatus.NotAnIssue,
      ].sort(),
    );
  });

  test("a status that is not text, or no status, asks nothing here: the route refuses it", () => {
    expect(issueUpdate({ status: 1 })).toBeNull();
    expect(issueUpdate({ status: null })).toBeNull();
    expect(issueUpdate({ status: true })).toBeNull();
    expect(issueUpdate({ assignedToTeamId: null })).toBeNull();
  });

  test("an issue is never created or deleted as one of these changes", () => {
    expect(
      found(DATA_SECURITY_ISSUE_TABLE_NAME, AlwaysAskWrite.Create, {
        status: DataSecurityIssueStatus.Accepted,
      }),
    ).toBeNull();
    expect(
      found(DATA_SECURITY_ISSUE_TABLE_NAME, AlwaysAskWrite.Delete),
    ).toBeNull();
  });
});

describe("a finding's write", () => {
  test("turning isSuppressed on is Not Sensitive, as the button sends it", () => {
    expect(findingUpdate(getNotSensitiveFindingWrite("Test data"))).toBe(
      "Not Sensitive",
    );
  });

  test("a switch is read as Postgres stores it", () => {
    for (const on of [true, "true", "TRUE", " yes ", "on", "1", 1, "t", "y"]) {
      expect({ on, change: findingUpdate({ isSuppressed: on }) }).toEqual({
        on,
        change: "Not Sensitive",
      });
    }

    for (const off of [false, "false", "no", "off", "0", 0, null, "f", "n"]) {
      expect({ off, change: findingUpdate({ isSuppressed: off }) }).toEqual({
        off,
        change: null,
      });
    }
  });

  test("Sensitive Again, and a reason alone, are the person's own edits", () => {
    expect(findingUpdate(getSensitiveAgainFindingWrite())).toBeNull();
    expect(findingUpdate({ suppressedReason: "Changed my mind" })).toBeNull();
  });

  test("Confirm is found, and asks only where a Critical issue pages someone", () => {
    const confirm: AlwaysAskWriteFound | null = findAlwaysAskChange({
      tableName: DATA_STORE_FINDING_TABLE_NAME,
      write: AlwaysAskWrite.Update,
      data: getConfirmFindingWrite(),
    });

    expect(confirm?.change.onlyWhen).toBe(
      AlwaysAskCondition.CriticalIssuesPage,
    );
    expect(confirm?.change.asksBecause).toBe(
      AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.confirmCanPage,
    );
    // Wherever it is made, it is the card's to decide: not "always".
    expect(
      writeAlwaysAsks({
        tableName: DATA_STORE_FINDING_TABLE_NAME,
        write: AlwaysAskWrite.Update,
        data: getConfirmFindingWrite(),
      }),
    ).toBe(false);
    expect(findingUpdate({ isConfirmed: false })).toBeNull();
  });

  test("Not Sensitive asks wherever it is made", () => {
    expect(
      writeAlwaysAsks({
        tableName: DATA_STORE_FINDING_TABLE_NAME,
        write: AlwaysAskWrite.Update,
        data: getNotSensitiveFindingWrite("Test data"),
      }),
    ).toBe(true);
  });

  test("a write that both suppresses and confirms is Not Sensitive, which always asks", () => {
    expect(findingUpdate({ isSuppressed: true, isConfirmed: true })).toBe(
      "Not Sensitive",
    );
  });
});

describe("a store's owners, rules, proposals and scrub rules", () => {
  test("every write of a store's owner is a store's owners", () => {
    for (const tableName of ["DataStoreOwnerUser", "DataStoreOwnerTeam"]) {
      for (const write of ALL_ALWAYS_ASK_WRITES) {
        expect({
          tableName,
          write,
          change: found(tableName, write, {}),
        }).toEqual({ tableName, write, change: "A store's owners" });
      }
    }
  });

  test("a residency rule made, or its terms changed, is a rule saved", () => {
    const rule: string = "DataSecurityResidencyRule";

    expect(
      found(rule, AlwaysAskWrite.Create, {
        name: "EU data in the EU",
        allowedRegions: ["eu-*"],
      }),
    ).toBe("A rule saved");

    for (const term of [
      "dataCategories",
      "subjectCountries",
      "allowedRegions",
    ]) {
      expect({
        term,
        change: found(rule, AlwaysAskWrite.Update, { [term]: ["x"] }),
      }).toEqual({ term, change: "A rule saved" });
    }

    expect(found(rule, AlwaysAskWrite.Update, { isEnabled: true })).toBe(
      "A rule saved",
    );
    expect(found(rule, AlwaysAskWrite.Update, { isEnabled: "yes" })).toBe(
      "A rule saved",
    );
  });

  test("a residency rule renamed, described or turned off, or deleted, is the person's own edit", () => {
    const rule: string = "DataSecurityResidencyRule";

    expect(found(rule, AlwaysAskWrite.Update, { name: "Renamed" })).toBeNull();
    expect(
      found(rule, AlwaysAskWrite.Update, { description: "Why we keep it" }),
    ).toBeNull();
    expect(found(rule, AlwaysAskWrite.Update, { isEnabled: false })).toBeNull();
    expect(found(rule, AlwaysAskWrite.Delete)).toBeNull();
  });

  test("an owner or a label rule is held to the same: made, or its terms changed", () => {
    for (const [table, terms] of [
      ["DataStoreOwnerRule", OWNER_RULE_TERMS],
      ["DataStoreLabelRule", LABEL_RULE_TERMS],
    ] as Array<[string, ReadonlyArray<string>]>) {
      expect(found(table, AlwaysAskWrite.Create, { name: "x" })).toBe(
        "A rule saved",
      );

      for (const term of terms) {
        const value: unknown = term === "isEnabled" ? true : ["x"];

        expect({
          table,
          term,
          change: found(table, AlwaysAskWrite.Update, {
            [term]: value,
          } as JSONObject),
        }).toEqual({ table, term, change: "A rule saved" });
      }

      expect(
        found(table, AlwaysAskWrite.Update, { name: "Renamed" }),
      ).toBeNull();
      expect(
        found(table, AlwaysAskWrite.Update, { isEnabled: false }),
      ).toBeNull();
      expect(found(table, AlwaysAskWrite.Delete)).toBeNull();
    }
  });

  test("an owner rule's notifyOwners is one of its terms either way: it changes who is told", () => {
    expect(
      found("DataStoreOwnerRule", AlwaysAskWrite.Update, {
        notifyOwners: false,
      }),
    ).toBe("A rule saved");
  });

  test("every write of a proposal is a proposal decided", () => {
    for (const write of ALL_ALWAYS_ASK_WRITES) {
      expect(found("DataSecurityAiProposal", write, { status: "x" })).toBe(
        "A proposal decided",
      );
    }
  });

  test("a scrub rule made or changed is a scrub something reads, which asks where that cannot be checked", () => {
    for (const table of ["LogScrubRule", "TraceScrubRule"]) {
      for (const write of [AlwaysAskWrite.Create, AlwaysAskWrite.Update]) {
        const scrub: AlwaysAskWriteFound | null = findAlwaysAskChange({
          tableName: table,
          write,
          data: { name: "x" },
        });

        expect(scrub?.change.name).toBe("A scrub something reads");
        expect(scrub?.change.onlyWhen).toBe(
          AlwaysAskCondition.SomethingReadsWhatItHides,
        );
      }

      expect(found(table, AlwaysAskWrite.Delete)).toBeNull();
    }
  });

  test("a response on a store is made outside OneUptime: no record's write makes it", () => {
    const respond: AlwaysAskChange | undefined = ALWAYS_ASK_CHANGES.find(
      (change: AlwaysAskChange): boolean => {
        return change.action === RESPOND_ON_DATA_STORE_TOOL_NAME;
      },
    );

    expect(respond?.records).toEqual([]);
    expect(respond?.madeOutsideOneUptime).toContain("cloud");
  });

  test("a record no change is about is never held", () => {
    for (const write of ALL_ALWAYS_ASK_WRITES) {
      expect(
        found("Incident", write, { title: "x", status: "Accepted" }),
      ).toBeNull();
      expect(found("DataStore", write, { isSuppressed: true })).toBeNull();
    }
  });
});

describe("which actions ask in every mode", () => {
  test("are the Data Security actions that ask, and not Fix with AI", () => {
    expect([...ALWAYS_ASK_ACTIONS].sort()).toEqual(
      [
        SCRUB_DATA_SECURITY_FINDING_TOOL_NAME,
        JUDGE_DATA_SECURITY_FINDING_TOOL_NAME,
        CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME,
        SET_DATA_STORE_OWNERS_TOOL_NAME,
        SAVE_DATA_SECURITY_RULE_TOOL_NAME,
        RESPOND_ON_DATA_STORE_TOOL_NAME,
        DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
      ].sort(),
    );
    expect(ALWAYS_ASK_ACTIONS).not.toContain(
      FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME,
    );

    for (const action of ALWAYS_ASK_ACTIONS) {
      expect(DATA_SECURITY_ACTION_TOOL_NAMES).toContain(action);
    }
  });

  test("whatever they are called with, only the actions every call of which asks", () => {
    expect(actionAlwaysAsks(SET_DATA_STORE_OWNERS_TOOL_NAME)).toBe(true);
    expect(actionAlwaysAsks(SAVE_DATA_SECURITY_RULE_TOOL_NAME)).toBe(true);
    expect(actionAlwaysAsks(DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME)).toBe(
      true,
    );
    expect(actionAlwaysAsks(RESPOND_ON_DATA_STORE_TOOL_NAME)).toBe(true);
    // Accept Risk asks and Reopen does not: the call's write decides.
    expect(actionAlwaysAsks(CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME)).toBe(false);
    expect(actionAlwaysAsks(JUDGE_DATA_SECURITY_FINDING_TOOL_NAME)).toBe(false);
    // Only where something reads what it hides: the card decides.
    expect(actionAlwaysAsks(SCRUB_DATA_SECURITY_FINDING_TOOL_NAME)).toBe(false);
    expect(actionAlwaysAsks(FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME)).toBe(
      false,
    );
    expect(actionAlwaysAsks("acknowledge_incident")).toBe(false);
  });

  test("an action every call of which makes its change says so, and one whose call decides does not", () => {
    expect(
      ALWAYS_ASK_CHANGES.filter((change: AlwaysAskChange): boolean => {
        return change.madeByEveryCall;
      })
        .map((change: AlwaysAskChange): string => {
          return change.name;
        })
        .sort(),
    ).toEqual(
      [
        "A store's owners",
        "A rule saved",
        "A proposal decided",
        "A scrub something reads",
        "A response on a store",
      ].sort(),
    );

    // A change every call makes is an action's: a playbook's step is no action's.
    for (const change of ALWAYS_ASK_CHANGES) {
      if (change.madeByEveryCall) {
        expect(change.action).toBeDefined();
      }
    }
  });
});

describe("what the list names is real", () => {
  test("every record is a table OneUptime has, and every column one of its columns", () => {
    for (const change of ALWAYS_ASK_CHANGES) {
      for (const record of change.records) {
        const model: DatabaseBaseModel | undefined = MODELS_BY_TABLE.get(
          record.tableName,
        );

        expect({ table: record.tableName, known: Boolean(model) }).toEqual({
          table: record.tableName,
          known: true,
        });

        for (const column of [
          ...(record.columns || []),
          ...(record.comparesWith || []),
        ]) {
          expect({
            table: record.tableName,
            column,
            isColumn: Boolean(model?.getTableColumnMetadata(column)),
          }).toEqual({ table: record.tableName, column, isColumn: true });
        }

        // What a write is compared with is among what makes it.
        for (const column of record.comparesWith || []) {
          expect(record.columns).toContain(column);
        }
      }
    }
  });

  test("every rule's terms are its table's columns", () => {
    for (const [table, terms] of [
      ["DataSecurityResidencyRule", RESIDENCY_RULE_TERMS],
      ["DataStoreOwnerRule", OWNER_RULE_TERMS],
      ["DataStoreLabelRule", LABEL_RULE_TERMS],
    ] as Array<[string, ReadonlyArray<string>]>) {
      for (const term of terms) {
        expect({
          table,
          term,
          isColumn: Boolean(
            MODELS_BY_TABLE.get(table)?.getTableColumnMetadata(term),
          ),
        }).toEqual({ table, term, isColumn: true });
      }
    }
  });

  test("every change says why it asks in the card's own words, says where, and says how in words", () => {
    const reasons: Array<string> = Object.values(
      AI_DATA_SECURITY_ACTION_ASKS_BECAUSE,
    );

    for (const change of ALWAYS_ASK_CHANGES) {
      // Ask AI's own card says why in its words; any other change says it as they do.
      if (change.card.startsWith("Ask AI's approval card")) {
        expect(reasons).toContain(change.asksBecause);
      } else {
        expect(
          change.asksBecause.startsWith("Asks first in every mode: "),
        ).toBe(true);
        expect(change.asksBecause.endsWith(".")).toBe(true);
      }

      expect(change.card.length).toBeGreaterThan(0);
      expect(["Data Security", "Security Events"]).toContain(change.product);

      for (const record of change.records) {
        expect(Object.values(AlwaysAskPage)).toContain(record.page);
        expect(record.written.length).toBeGreaterThan(0);
        expect(record.writes.length).toBeGreaterThan(0);
        // A write that names its columns says what makes it.
        expect(Boolean(record.columns)).toBe(Boolean(record.makesIt));
      }
    }
  });

  test("a change made outside OneUptime has no record, and every other change has one", () => {
    for (const change of ALWAYS_ASK_CHANGES) {
      expect({
        change: change.name,
        hasRecords: change.records.length > 0,
      }).toEqual({
        change: change.name,
        hasRecords: !change.madeOutsideOneUptime,
      });
    }
  });

  test("a table's changes are every change on it", () => {
    expect(
      getAlwaysAskChangesOfTable(DATA_SECURITY_ISSUE_TABLE_NAME).map(
        (each: AlwaysAskWriteFound): string => {
          return each.change.name;
        },
      ),
    ).toEqual(["Accept Risk", "Not an Issue"]);
    expect(
      getAlwaysAskChangesOfTable(DATA_STORE_FINDING_TABLE_NAME).map(
        (each: AlwaysAskWriteFound): string => {
          return each.change.name;
        },
      ),
    ).toEqual([
      "Not Sensitive",
      "Confirm, in a project that pages someone for a Critical issue",
    ]);
    expect(getAlwaysAskChangesOfTable("Incident")).toEqual([]);
  });

  test("every record write is listed once", () => {
    const seen: Set<string> = new Set();

    for (const change of ALWAYS_ASK_CHANGES) {
      for (const record of change.records) {
        const key: string = `${change.name}|${record.tableName}|${record.writes.join(",")}`;

        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  test("a record's writes are writes the API takes", () => {
    for (const change of ALWAYS_ASK_CHANGES) {
      for (const record of change.records as Array<AlwaysAskRecordWrite>) {
        for (const write of record.writes) {
          expect(ALL_ALWAYS_ASK_WRITES).toContain(write);
        }
      }
    }
  });
});

describe("whether a Critical issue pages someone", () => {
  test("an alert raised or an incident declared for one does", () => {
    expect(doCriticalIssuesPage({ raiseAlertsForCriticalIssues: true })).toBe(
      true,
    );
    expect(
      doCriticalIssuesPage({ declareIncidentsForCriticalIssues: true }),
    ).toBe(true);
    expect(
      doCriticalIssuesPage({
        raiseAlertsForCriticalIssues: true,
        declareIncidentsForCriticalIssues: true,
      }),
    ).toBe(true);
  });

  test("neither, or no setting at all, does not", () => {
    expect(
      doCriticalIssuesPage({
        raiseAlertsForCriticalIssues: false,
        declareIncidentsForCriticalIssues: false,
      }),
    ).toBe(false);
    expect(doCriticalIssuesPage({})).toBe(false);
    expect(doCriticalIssuesPage(null)).toBe(false);
    expect(doCriticalIssuesPage(undefined)).toBe(false);
  });

  test("a switch the API answers with as text is read as the database stores it", () => {
    expect(
      doCriticalIssuesPage({
        raiseAlertsForCriticalIssues: "true" as unknown as boolean,
      }),
    ).toBe(true);
    expect(
      doCriticalIssuesPage({
        declareIncidentsForCriticalIssues: "false" as unknown as boolean,
      }),
    ).toBe(false);
  });
});

describe("the refusal", () => {
  test("opens with what the MCP server reads, says why, names what is not run, and the page", () => {
    const refusal: string = getAsksInEveryModeRefusal({
      action: "update_data_security_issue",
      reason: "Asks first in every mode: it stops an issue counting.",
      pageUrl: "https://oneuptime.example/dashboard/p/data-security/issues/i",
    });

    expect(refusal.startsWith(ASKS_IN_EVERY_MODE_REFUSAL_PREFIX)).toBe(true);
    expect(refusal).toContain(
      "Asks first in every mode: it stops an issue counting.",
    );
    expect(refusal).toContain("so update_data_security_issue is not run here.");
    expect(refusal).toContain(
      "on https://oneuptime.example/dashboard/p/data-security/issues/i, with the page's own button or with Ask AI there",
    );
  });

  test("with no page known, sends the person to Data Security's own button", () => {
    const refusal: string = getAsksInEveryModeRefusal({
      action: "this call",
      reason: undefined,
      pageUrl: null,
    });

    expect(refusal).toBe(
      `${ASKS_IN_EVERY_MODE_REFUSAL_PREFIX} An MCP client shows no card OneUptime can wait on, so this call is not run here. Do it in OneUptime, with Data Security's own button or with Ask AI, which shows the change on a card for the person to approve.`,
    );
  });

  test("with no page known, names the product whose button the person presses", () => {
    expect(
      getAsksInEveryModeRefusal({
        action: "update_security_playbook",
        reason: undefined,
        pageUrl: null,
        product: "Security Events",
      }),
    ).toContain("with Security Events's own button or with Ask AI");
  });
});

/*
 * What OneUptime AI asks a person before whatever its rules say, made by
 * hand: a data type turned off, a place left out of a store's scans
 * (DataSecurityAi's ChangesWhatScansLookFor). Each is a list the record
 * holds, so a write is judged against what it holds now.
 */
describe("a data type turned off", () => {
  const SETTING: string = "DataSecuritySetting";

  test("is a write that adds a data type the setting does not turn off yet", () => {
    expect(
      found(
        SETTING,
        AlwaysAskWrite.Update,
        { disabledDataTypeIds: ["email", "credit-card"] },
        { disabledDataTypeIds: ["email"] },
      ),
    ).toBe("A data type turned off");
    // Made with one, a setting turns it off.
    expect(
      found(SETTING, AlwaysAskWrite.Create, {
        disabledDataTypeIds: ["credit-card"],
      }),
    ).toBe("A data type turned off");
  });

  test("is not the list written as it is, a data type turned back on, or none", () => {
    const stored: JSONObject = { disabledDataTypeIds: ["email", "iban"] };

    expect(
      found(
        SETTING,
        AlwaysAskWrite.Update,
        { disabledDataTypeIds: ["email", "iban"] },
        stored,
      ),
    ).toBeNull();
    expect(
      found(
        SETTING,
        AlwaysAskWrite.Update,
        { disabledDataTypeIds: ["iban", " email "] },
        stored,
      ),
    ).toBeNull();
    expect(
      found(
        SETTING,
        AlwaysAskWrite.Update,
        { disabledDataTypeIds: ["email"] },
        stored,
      ),
    ).toBeNull();
    expect(
      found(
        SETTING,
        AlwaysAskWrite.Update,
        { disabledDataTypeIds: [] },
        stored,
      ),
    ).toBeNull();
    expect(
      found(
        SETTING,
        AlwaysAskWrite.Update,
        { disabledDataTypeIds: null },
        stored,
      ),
    ).toBeNull();
    expect(
      found(SETTING, AlwaysAskWrite.Create, { disabledDataTypeIds: [] }),
    ).toBeNull();
  });

  test("is every other write of the setting: the person's own", () => {
    expect(
      found(SETTING, AlwaysAskWrite.Update, { keepMaskedSamples: false }, {}),
    ).toBeNull();
    expect(
      found(
        SETTING,
        AlwaysAskWrite.Update,
        { raiseAlertsForCriticalIssues: false },
        {},
      ),
    ).toBeNull();
  });

  test("is taken to be one where the setting could not be read, or the value is not a list", () => {
    expect(
      found(
        SETTING,
        AlwaysAskWrite.Update,
        { disabledDataTypeIds: ["email"] },
        null,
      ),
    ).toBe("A data type turned off");
    expect(
      found(SETTING, AlwaysAskWrite.Update, { disabledDataTypeIds: ["email"] }),
    ).toBe("A data type turned off");
    expect(
      found(
        SETTING,
        AlwaysAskWrite.Update,
        { disabledDataTypeIds: "email" },
        { disabledDataTypeIds: ["email"] },
      ),
    ).toBe("A data type turned off");
    expect(
      found(
        SETTING,
        AlwaysAskWrite.Update,
        { disabledDataTypeIds: [42] },
        { disabledDataTypeIds: [] },
      ),
    ).toBe("A data type turned off");
  });

  test("asks wherever it is made, and is OneUptime AI's proposal's, decided by a person", () => {
    const turnedOff: AlwaysAskWriteFound | null = findAlwaysAskChange({
      tableName: SETTING,
      write: AlwaysAskWrite.Update,
      data: { disabledDataTypeIds: ["email"] },
      stored: { disabledDataTypeIds: [] },
    });

    expect(turnedOff?.change.onlyWhen).toBeUndefined();
    expect(turnedOff?.change.action).toBe(
      DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
    );
    expect(turnedOff?.change.madeByEveryCall).toBe(false);
    expect(turnedOff?.record.page).toBe(AlwaysAskPage.DataTypes);
  });
});

describe("a place left out of a store's scans", () => {
  const STORE: string = "DataStore";

  test("is a write that adds a place the store's scans do not leave out yet", () => {
    expect(
      found(
        STORE,
        AlwaysAskWrite.Update,
        { scanExclusions: ["logs/", "tmp/"] },
        { scanExclusions: ["logs/"] },
      ),
    ).toBe("A place left out of a store's scans");
    expect(
      found(STORE, AlwaysAskWrite.Create, {
        name: "Payments bucket",
        scanExclusions: ["exports/"],
      }),
    ).toBe("A place left out of a store's scans");
  });

  test("is told apart from a place it leaves out already as the scans tell them, case and space aside", () => {
    expect(
      found(
        STORE,
        AlwaysAskWrite.Update,
        { scanExclusions: [" Logs/ "] },
        { scanExclusions: ["logs/"] },
      ),
    ).toBeNull();
  });

  test("is not a place taken off, the list as it is, or a store's other fields", () => {
    const stored: JSONObject = { scanExclusions: ["logs/", "tmp/"] };

    expect(
      found(
        STORE,
        AlwaysAskWrite.Update,
        { scanExclusions: ["logs/"] },
        stored,
      ),
    ).toBeNull();
    expect(
      found(STORE, AlwaysAskWrite.Update, { scanExclusions: [] }, stored),
    ).toBeNull();
    expect(
      found(STORE, AlwaysAskWrite.Update, { description: "Payments" }, stored),
    ).toBeNull();
    expect(
      found(STORE, AlwaysAskWrite.Create, { name: "Payments bucket" }),
    ).toBeNull();
    expect(found(STORE, AlwaysAskWrite.Delete, {}, stored)).toBeNull();
  });

  test("is taken to be one where the store could not be read", () => {
    expect(
      found(STORE, AlwaysAskWrite.Update, { scanExclusions: ["logs/"] }, null),
    ).toBe("A place left out of a store's scans");
  });
});

/*
 * A containment step waits for a person's approval in the playbook's run;
 * only a person in OneUptime lets one run without it, and a response on a
 * store's cloud waits too unless its author turned that off. A playbook's
 * write that lets one run with nobody's approval makes the change the
 * approval stands for.
 */
describe("a playbook's containment or store response run with nobody's approval", () => {
  const PLAYBOOK: string = "SecurityPlaybook";
  const CHANGE: string =
    "A playbook's containment or store response run with nobody's approval";
  const CONNECTION_ID: string = "11177000-0000-4000-8000-0000000000a1";

  function suspend(
    id: string,
    requiresApproval: boolean | undefined,
  ): JSONObject {
    return {
      id,
      action: SecurityPlaybookActionType.SuspendOktaUser,
      config: { connectionId: CONNECTION_ID },
      ...(requiresApproval === undefined ? {} : { requiresApproval }),
    };
  }

  function blockPublicAccess(
    id: string,
    requiresApproval: boolean | undefined,
  ): JSONObject {
    return {
      id,
      action: SecurityPlaybookActionType.BlockDataStorePublicAccess,
      config: {},
      ...(requiresApproval === undefined ? {} : { requiresApproval }),
    };
  }

  const NOTE: JSONObject = {
    id: "note",
    action: SecurityPlaybookActionType.AddCaseNote,
    config: { note: "Look at the sign-ins first." },
  };

  test("a new playbook with a containment step that runs without approval is one", () => {
    expect(
      found(PLAYBOOK, AlwaysAskWrite.Create, {
        name: "Contain",
        steps: [suspend("s1", false)],
      }),
    ).toBe(CHANGE);
  });

  test("a containment step that waits for approval, or says nothing of it, is the person's own", () => {
    expect(
      found(PLAYBOOK, AlwaysAskWrite.Create, {
        name: "Contain",
        steps: [suspend("s1", true)],
      }),
    ).toBeNull();
    // A containment step waits unless told not to, as the playbook's service reads it.
    expect(
      found(PLAYBOOK, AlwaysAskWrite.Create, {
        name: "Contain",
        steps: [suspend("s1", undefined)],
      }),
    ).toBeNull();
  });

  test("a store's response waits only when it says so, so one that says nothing runs unasked", () => {
    expect(
      found(PLAYBOOK, AlwaysAskWrite.Create, {
        name: "Close exposure",
        steps: [blockPublicAccess("s1", undefined)],
      }),
    ).toBe(CHANGE);
    expect(
      found(PLAYBOOK, AlwaysAskWrite.Create, {
        name: "Close exposure",
        steps: [blockPublicAccess("s1", true)],
      }),
    ).toBeNull();
  });

  test("a step the playbook holds without approval already, kept as it was, is the person's earlier choice", () => {
    const stored: JSONObject = {
      steps: [suspend("s1", false), NOTE],
    };

    expect(
      found(
        PLAYBOOK,
        AlwaysAskWrite.Update,
        { steps: [suspend("s1", false), NOTE] },
        stored,
      ),
    ).toBeNull();
    // Another step added that waits: still theirs.
    expect(
      found(
        PLAYBOOK,
        AlwaysAskWrite.Update,
        { steps: [suspend("s1", false), NOTE, suspend("s2", true)] },
        stored,
      ),
    ).toBeNull();
  });

  test("that step changed, or a new one beside it, without approval is one", () => {
    const stored: JSONObject = { steps: [suspend("s1", false)] };
    const changed: JSONObject = {
      ...suspend("s1", false),
      config: { connectionId: "11177000-0000-4000-8000-0000000000a2" },
    };

    expect(
      found(PLAYBOOK, AlwaysAskWrite.Update, { steps: [changed] }, stored),
    ).toBe(CHANGE);
    expect(
      found(
        PLAYBOOK,
        AlwaysAskWrite.Update,
        { steps: [suspend("s1", false), suspend("s2", false)] },
        stored,
      ),
    ).toBe(CHANGE);
    // A step that waited, turned off: one.
    expect(
      found(
        PLAYBOOK,
        AlwaysAskWrite.Update,
        { steps: [suspend("s1", false)] },
        { steps: [suspend("s1", true)] },
      ),
    ).toBe(CHANGE);
  });

  test("when or whether it runs, changed on a playbook with such a step, is one", () => {
    const stored: JSONObject = { steps: [suspend("s1", false)] };

    for (const column of PLAYBOOK_REACH_COLUMNS) {
      const value: unknown =
        column === "isEnabled"
          ? true
          : column === "detectionRuleIds"
            ? ["11177000-0000-4000-8000-0000000000b1"]
            : "x";

      expect({
        column,
        change: found(
          PLAYBOOK,
          AlwaysAskWrite.Update,
          { [column]: value } as JSONObject,
          stored,
        ),
      }).toEqual({ column, change: CHANGE });
    }
  });

  test("turning such a playbook off, renaming it, or changing when one with no such step runs, is the person's own", () => {
    const withOne: JSONObject = { steps: [suspend("s1", false)] };
    const without: JSONObject = { steps: [suspend("s1", true), NOTE] };

    expect(
      found(PLAYBOOK, AlwaysAskWrite.Update, { isEnabled: false }, withOne),
    ).toBeNull();
    expect(
      found(PLAYBOOK, AlwaysAskWrite.Update, { name: "Renamed" }, withOne),
    ).toBeNull();
    expect(
      found(PLAYBOOK, AlwaysAskWrite.Update, { trigger: "x" }, without),
    ).toBeNull();
    expect(
      found(PLAYBOOK, AlwaysAskWrite.Update, { isEnabled: true }, without),
    ).toBeNull();
    expect(found(PLAYBOOK, AlwaysAskWrite.Delete, {}, withOne)).toBeNull();
  });

  test("where the playbook could not be read, a step without approval or a change of reach is taken to be one", () => {
    expect(
      found(
        PLAYBOOK,
        AlwaysAskWrite.Update,
        { steps: [suspend("s1", false)] },
        null,
      ),
    ).toBe(CHANGE);
    expect(
      found(PLAYBOOK, AlwaysAskWrite.Update, { isEnabled: true }, null),
    ).toBe(CHANGE);
    // Steps that all wait leave nothing to run unasked, whatever it held.
    expect(
      found(
        PLAYBOOK,
        AlwaysAskWrite.Update,
        { steps: [suspend("s1", true)], isEnabled: true },
        null,
      ),
    ).toBeNull();
  });

  test("steps the playbook's service would refuse are its to refuse", () => {
    expect(
      found(PLAYBOOK, AlwaysAskWrite.Create, {
        steps: [{ action: "Not An Action", requiresApproval: false }],
      }),
    ).toBeNull();
    expect(
      found(PLAYBOOK, AlwaysAskWrite.Create, { steps: "not json" }),
    ).toBeNull();
  });

  test("guards every containment step, every store response, and nothing else", () => {
    const guarded: Array<string> = SECURITY_PLAYBOOK_ACTIONS.filter(
      (action: SecurityPlaybookActionDefinition): boolean => {
        return isStepGuardedByApproval({ action: action.type });
      },
    ).map((action: SecurityPlaybookActionDefinition): string => {
      return action.type;
    });

    const expected: Array<string> = SECURITY_PLAYBOOK_ACTIONS.filter(
      (action: SecurityPlaybookActionDefinition): boolean => {
        return (
          action.isDisruptive || RESPONSE_ON_A_STORE_STEPS.includes(action.type)
        );
      },
    ).map((action: SecurityPlaybookActionDefinition): string => {
      return action.type;
    });

    expect([...guarded].sort()).toEqual([...expected].sort());
    expect(guarded).toContain(SecurityPlaybookActionType.SuspendOktaUser);
    expect(guarded).toContain(SecurityPlaybookActionType.BlockAddress);
    expect(guarded).toContain(
      SecurityPlaybookActionType.RevokeDataStoreSharing,
    );
    // Declaring an incident, paging and a note are not containment.
    expect(guarded).not.toContain(SecurityPlaybookActionType.DeclareIncident);
    expect(guarded).not.toContain(SecurityPlaybookActionType.PageOnCall);
    expect(guarded).not.toContain(SecurityPlaybookActionType.AddCaseNote);
  });

  test("is no action of Ask AI's, and names Security Events", () => {
    const playbook: AlwaysAskWriteFound | null = findAlwaysAskChange({
      tableName: PLAYBOOK,
      write: AlwaysAskWrite.Create,
      data: { steps: [suspend("s1", false)] },
    });

    expect(playbook?.change.action).toBeUndefined();
    expect(playbook?.change.product).toBe("Security Events");
    expect(playbook?.record.page).toBe(AlwaysAskPage.SecurityPlaybook);
    expect(ALWAYS_ASK_ACTIONS).not.toContain(undefined);
  });
});
