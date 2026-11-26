import AIRunOutputReadFilter, {
  AI_RUN_ABOUT_KEYS,
  AI_RUN_CARRIED_KEYS,
  AI_RUN_PART_KEYS,
  AI_RUN_RECORD_KEYS,
  AI_RUN_TASK_KEY,
  AIRunCarriedKey,
  AIRunPartKey,
  AIRunRecordKey,
  CARRIED_RECORD_COLUMNS,
  PERSONAL_RUNS,
  PROJECT_WIDE_RUNS,
  RUNS_ONEUPTIME_STARTS,
} from "../../../../Server/Utils/AI/AIRunOutputReadFilter";
import WorkflowPrincipal from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import PrivateRecordPermission, {
  PrivateRecordColumn,
} from "../../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AIChatPageContextType from "../../../../Types/AI/AIChatPageContext";
import { CODE_TASK_RECORD_CONTEXT_TYPES } from "../../../../Types/AI/CodeTask";
import AIRunType from "../../../../Types/AI/AIRunType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import escapeRegExp from "../../../../Utils/RegExpEscape";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * WHAT AN AI RUN RAN AND PRINTED IS READ ONLY BY THOSE WHO MAY READ THE RUN
 * (#9155): the condition AIRunOutputReadFilter puts on a key naming an AI
 * run, for every kind of reader. AiRunOutputReadPostgres runs it on a
 * migrated Postgres, through the Runner job service; this suite holds what
 * it writes, and that every kind of run is one the rule knows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0c0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0c01",
);
const USER_ID: ObjectID = new ObjectID("0c0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0c02");

function person(
  permission: Permission,
  userId: ObjectID | null = USER_ID,
): DatabaseCommonInteractionProps {
  return {
    ...(userId ? { userId: userId } : {}),
    userType: userId ? UserType.User : UserType.API,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          } as UserPermission,
        ],
      },
    },
  };
}

const workflowStep: DatabaseCommonInteractionProps =
  WorkflowPrincipal.getPropsWithoutPlan({
    projectId: PROJECT_ID,
    workflowId: ObjectID.generate(),
  });

interface Reader {
  who: string;
  props: DatabaseCommonInteractionProps;
  // Reads a chat's commands when they asked it.
  isAPerson: boolean;
  // Sees every private incident and alert.
  seesEveryPrivateRecord: boolean;
}

const READERS: Array<Reader> = [
  {
    who: "a Project Owner",
    props: person(Permission.ProjectOwner),
    isAPerson: true,
    seesEveryPrivateRecord: true,
  },
  {
    who: "a Project Admin",
    props: person(Permission.ProjectAdmin),
    isAPerson: true,
    seesEveryPrivateRecord: true,
  },
  {
    who: "a member",
    props: person(Permission.ProjectMember),
    isAPerson: true,
    seesEveryPrivateRecord: false,
  },
  {
    who: "a viewer",
    props: person(Permission.Viewer),
    isAPerson: true,
    seesEveryPrivateRecord: false,
  },
  {
    who: "an API key with Project Admin",
    props: person(Permission.ProjectAdmin, null),
    isAPerson: false,
    seesEveryPrivateRecord: true,
  },
  {
    who: "an API key without Project Owner or Admin",
    props: person(Permission.ProjectMember, null),
    isAPerson: false,
    seesEveryPrivateRecord: false,
  },
  {
    who: "a workflow's step",
    props: workflowStep,
    isAPerson: false,
    seesEveryPrivateRecord: false,
  },
];

interface Written {
  sql: string;
  parameters: Record<string, unknown>;
}

// What a condition this filter wrote says of a column called COLUMN.
function written(condition: unknown): Written {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  return {
    sql: (operator.getSql as (alias: string) => string)("COLUMN"),
    parameters: (operator.objectLiteralParameters || {}) as Record<
      string,
      unknown
    >,
  };
}

// The run's alias in the condition: "aiRun" and ten random characters.
function runAliasIn(sql: string): string {
  const match: RegExpMatchArray | null = sql.match(
    /FROM "AIRun" "(aiRun\w+)" WHERE/,
  );

  expect(match).not.toBeNull();

  return match![1]!;
}

// The value bound to the first parameter `sql` names after `prefix`.
function boundAfter(written: Written, prefix: string): unknown | undefined {
  const match: RegExpMatchArray | null = written.sql.match(
    new RegExp(`${escapeRegExp(prefix)}:(?:\\.\\.\\.)?(\\w+)`),
  );

  return match ? written.parameters[match[1]!] : undefined;
}

describe("every kind of AI run is one the rule knows", () => {
  test("a run is a person's chat, one OneUptime started on its own, or the project's, and never two of these", () => {
    const classified: Array<AIRunType> = [
      ...PERSONAL_RUNS,
      ...RUNS_ONEUPTIME_STARTS,
      ...PROJECT_WIDE_RUNS,
    ];

    expect([...classified].sort()).toEqual(
      [...Object.values(AIRunType)].sort(),
    );
    expect(new Set(classified).size).toBe(classified.length);
  });

  test("a chat is a person's own; an investigation, a fix's and a security case's runs OneUptime's; a CodeFix run the project's", () => {
    expect(PERSONAL_RUNS).toEqual([AIRunType.Chat]);
    expect([...RUNS_ONEUPTIME_STARTS].sort()).toEqual(
      [
        AIRunType.Investigation,
        AIRunType.RemediationPlan,
        AIRunType.RemediationExecution,
        AIRunType.SecurityCaseResponse,
      ].sort(),
    );
    expect(PROJECT_WIDE_RUNS).toEqual([AIRunType.CodeFix]);
  });

  test("a run names the incident or alert it is about by a key of its own", () => {
    const run: AIRun = new AIRun();

    expect(
      AI_RUN_RECORD_KEYS.map((key: AIRunRecordKey): string => {
        return `${key.column} -> ${new key.recordModelType().tableName}`;
      }),
    ).toEqual([
      "triggeredByIncidentId -> Incident",
      "triggeredByAlertId -> Alert",
    ]);

    for (const key of AI_RUN_RECORD_KEYS) {
      const metadata: TableColumnMetadata | undefined =
        run.getTableColumnMetadata(key.column);

      expect(metadata?.type).toBe(TableColumnType.ObjectID);
    }

    expect(run.getTableColumnMetadata("userId")?.type).toBe(
      TableColumnType.ObjectID,
    );
    expect(run.getTableColumnMetadata("runType")).toBeDefined();
  });
});

describe("OneUptime itself and a server admin", () => {
  test.each([
    ["OneUptime itself", { isRoot: true }],
    ["a server admin", { isMasterAdmin: true, userId: USER_ID }],
  ])(
    "%s reads what every run did",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(AIRunOutputReadFilter.getReadableRunsRaw(props)).toBeUndefined();

      const query: Record<string, unknown> = { status: "Running" };

      expect(
        AIRunOutputReadFilter.applyToRunKey({
          query: query,
          props: props,
          modelType: RunnerJob,
          column: "aiRunId",
        }),
      ).toEqual({ status: "Running" });
    },
  );
});

describe.each(READERS)("$who", (reader: Reader) => {
  const condition: Written = written(
    AIRunOutputReadFilter.getReadableRunsRaw(reader.props),
  );
  const run: string = runAliasIn(condition.sql);

  test("reads a row naming no run, or one naming a run they may read: that run, looked up by its key", () => {
    expect(condition.sql).toMatch(
      new RegExp(
        `^\\(COLUMN IS NULL OR EXISTS \\(SELECT 1 FROM "AIRun" "${run}" WHERE "${run}"\\."_id" = COLUMN AND \\(`,
      ),
    );
    expect(condition.sql.endsWith("))")).toBe(true);
    // Never every run the caller may read, gathered first.
    expect(condition.sql).not.toMatch(/COLUMN IN \(SELECT/);
  });

  test("reads what a CodeFix run did, as the run is the project's", () => {
    expect(boundAfter(condition, `"${run}"."runType" IN (`)).toEqual([
      AIRunType.CodeFix,
    ]);
  });

  test("reads what a run OneUptime started on its own did: an investigation, a fix's runs", () => {
    expect(condition.sql).toContain(
      `("${run}"."userId" IS NULL AND "${run}"."runType" IN (:...`,
    );
    expect(
      boundAfter(
        condition,
        `("${run}"."userId" IS NULL AND "${run}"."runType" IN (`,
      ),
    ).toEqual([...RUNS_ONEUPTIME_STARTS]);
  });

  if (reader.isAPerson) {
    test("reads what their own chat did, and no one else's", () => {
      expect(boundAfter(condition, `"${run}"."userId" = `)).toBe(
        USER_ID.toString(),
      );
      expect(condition.sql.split(`"${run}"."userId" = :`).length - 1).toBe(1);
    });
  } else {
    test("reads no chat's: no person asked", () => {
      expect(condition.sql).not.toContain(`"${run}"."userId" = :`);
      expect(Object.values(condition.parameters)).not.toContain(
        USER_ID.toString(),
      );
    });
  }

  if (reader.seesEveryPrivateRecord) {
    test("reads what a run about any incident or alert did: every private one is theirs to see", () => {
      expect(condition.sql).not.toContain("triggeredByIncidentId");
      expect(condition.sql).not.toContain("triggeredByAlertId");
      expect(condition.sql).not.toContain(`FROM "Incident"`);
    });
  } else {
    test.each([
      ["incident", "triggeredByIncidentId", "Incident"],
      ["alert", "triggeredByAlertId", "Alert"],
    ])(
      "reads what a run about no %s did, or about one that exists and they see",
      (_record: string, column: string, table: string) => {
        const key: string = `"${run}"."${column}"`;

        // No record, or one that exists - a record that is gone, none - ...
        expect(condition.sql).toMatch(
          new RegExp(
            `AND \\(${escapeRegExp(key)} IS NULL OR \\(EXISTS \\(SELECT 1 FROM "${table}" "(aiRunRecord\\w+)" WHERE "\\1"\\."_id" = ${escapeRegExp(key)}\\) AND `,
          ),
        );
        // ... and is no private one they do not see.
        expect(condition.sql).toContain(
          `(${key} IS NULL OR NOT EXISTS (SELECT 1 FROM "${table}" pr WHERE pr."_id" = ${key} AND pr."isPrivate" = TRUE`,
        );
      },
    );

    if (reader.isAPerson) {
      test("sees a private one they own, or one a team of theirs owns", () => {
        expect(condition.sql).toContain(`FROM "IncidentOwnerUser" prou`);
        expect(condition.sql).toContain(`FROM "IncidentOwnerTeam" prot`);
        expect(condition.sql).toContain(`FROM "AlertOwnerUser" prou`);
        expect(condition.sql).toContain(`FROM "AlertOwnerTeam" prot`);
      });
    } else {
      test("sees no private one: it is no person and owns nothing", () => {
        expect(condition.sql).not.toContain("OwnerUser");
        expect(condition.sql).not.toContain("OwnerTeam");
      });
    }
  }

  test("binds every parameter its SQL names", () => {
    const named: Array<string> = Array.from(
      condition.sql.matchAll(/:(?:\.\.\.)?(\w+)/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(named.length).toBeGreaterThan(0);

    for (const name of named) {
      expect(Object.keys(condition.parameters)).toContain(name);
    }
  });

  test("puts the condition on the key, beside every other filter, as sent", () => {
    const query: Record<string, unknown> = AIRunOutputReadFilter.applyToRunKey({
      query: { status: "Running" } as Record<string, unknown>,
      props: reader.props,
      modelType: RunnerJob,
      column: "aiRunId",
    });

    expect(Object.keys(query).sort()).toEqual(["aiRunId", "status"]);
    expect(query["status"]).toBe("Running");
    expect((query["aiRunId"] as FindOperator<unknown>).type).toBe("raw");
  });

  test.each([
    [
      "a run's id",
      (): unknown => {
        return ObjectID.generate();
      },
    ],
    [
      "OneUptime's operator for a key naming a run",
      (): unknown => {
        return new NotNull();
      },
    ],
    [
      "OneUptime's operator for a key naming none",
      (): unknown => {
        return new IsNull();
      },
    ],
  ])(
    "keeps the caller's own filter on the key: %s",
    (_what: string, value: () => unknown) => {
      const query: Record<string, unknown> =
        AIRunOutputReadFilter.applyToRunKey({
          query: { aiRunId: value() } as Record<string, unknown>,
          props: reader.props,
          modelType: RunnerJob,
          column: "aiRunId",
        });

      const kept: FindOperator<unknown> = query[
        "aiRunId"
      ] as FindOperator<unknown>;

      expect(kept.type).toBe("and");

      const parts: Array<FindOperator<unknown>> =
        kept.value as unknown as Array<FindOperator<unknown>>;

      expect(parts).toHaveLength(2);
      expect(parts[1]!.type).toBe("raw");
      expect(written(parts[1]).sql).toContain(`FROM "AIRun"`);
    },
  );

  test("reads its own condition for each read: another read gets aliases of its own", () => {
    const again: Written = written(
      AIRunOutputReadFilter.getReadableRunsRaw(reader.props),
    );

    expect(runAliasIn(again.sql)).not.toBe(run);
  });
});

/*
 * WHAT A RUN IS ABOUT, BESIDES ITS INCIDENT OR ALERT (#9165): a fix
 * OneUptime AI proposed for one - the Code task asked for a fix's declared
 * code names it - and, for a reply in a Code task, what its task is about.
 */
describe("what a run can be about", () => {
  test("a run names a fix by a key of its own, and the fix is a part of the incident or alert it is for", () => {
    const run: AIRun = new AIRun();

    expect(
      AI_RUN_PART_KEYS.map((key: AIRunPartKey): string => {
        return `${key.column} -> ${new key.partModelType().tableName}`;
      }),
    ).toEqual([
      "triggeredByAutoRemediationSuggestionId -> AutoRemediationSuggestion",
    ]);

    for (const key of AI_RUN_PART_KEYS) {
      expect(run.getTableColumnMetadata(key.column)?.type).toBe(
        TableColumnType.ObjectID,
      );
    }

    expect(
      PrivateRecordPermission.getPrivateRecordColumns(AutoRemediationSuggestion)
        .map((column: PrivateRecordColumn): string => {
          return `${column.column} -> ${column.kind.tableName}`;
        })
        .sort(),
    ).toEqual(["alertId -> Alert", "incidentId -> Incident"]);
  });

  test("a turn names the task it is a reply in", () => {
    expect(AI_RUN_TASK_KEY).toBe("codeTaskId");
    expect(new AIRun().getTableColumnMetadata(AI_RUN_TASK_KEY)?.type).toBe(
      TableColumnType.ObjectID,
    );
  });

  test("every key the rule reads is one the run's own read is said to narrow by", () => {
    expect([...AI_RUN_ABOUT_KEYS].sort()).toEqual(
      [
        "carriedAlertIds",
        "carriedIncidentIds",
        "codeTaskId",
        "triggeredByAlertId",
        "triggeredByAutoRemediationSuggestionId",
        "triggeredByIncidentId",
      ].sort(),
    );
  });

  /*
   * A task can carry an incident or alert without being a fix of one
   * (#9186): lists of its own, which nothing that reads a fix's keys reads.
   */
  test("a run lists the incidents and alerts it carries apart from the record it is a fix of", () => {
    expect(
      AI_RUN_CARRIED_KEYS.map((key: AIRunCarriedKey): string => {
        return `${key.column} -> ${new key.recordModelType().tableName}`;
      }),
    ).toEqual(["carriedIncidentIds -> Incident", "carriedAlertIds -> Alert"]);

    for (const key of AI_RUN_CARRIED_KEYS) {
      // A list, as a task can carry several.
      expect(new AIRun().getTableColumnMetadata(key.column)?.type).toBe(
        TableColumnType.JSON,
      );
      // A pull request opened from a chat carries its chat's subject in the same keys.
      expect(
        new AIAgentTaskPullRequest().getTableColumnMetadata(key.column)?.type,
      ).toBe(TableColumnType.JSON);
      // Not a key a fix names its record by.
      expect(
        AI_RUN_RECORD_KEYS.map((recordKey: AIRunRecordKey): string => {
          return recordKey.column;
        }),
      ).not.toContain(key.column);
    }

    expect([...CARRIED_RECORD_COLUMNS]).toEqual([
      "carriedIncidentIds",
      "carriedAlertIds",
    ]);
  });

  test("every kind of record that can be private and that Code work can carry has a list", () => {
    const carriedTables: Array<string> = AI_RUN_CARRIED_KEYS.map(
      (key: AIRunCarriedKey): string => {
        return new key.recordModelType().tableName as string;
      },
    );

    // What a request's context can name: each that can be private is carried.
    for (const type of CODE_TASK_RECORD_CONTEXT_TYPES) {
      if (PrivateRecordPermission.getKind(type)) {
        expect({ type, isCarried: carriedTables.includes(type) }).toEqual({
          type,
          isCarried: true,
        });
      }
    }

    // What a chat can be about: each that can be private is carried.
    for (const type of Object.values(AIChatPageContextType)) {
      if (PrivateRecordPermission.getKind(type)) {
        expect({ type, isCarried: carriedTables.includes(type) }).toEqual({
          type,
          isCarried: true,
        });
      }
    }
  });
});

/*
 * WHAT A ROW CARRIES (#9186): each list read entry by entry, every entry
 * looked up by its primary key.
 */
describe.each(READERS)("$who, on what a run carries", (reader: Reader) => {
  const condition: Written = written(
    AIRunOutputReadFilter.getReadableRunsRaw(reader.props),
  );
  const run: string = runAliasIn(condition.sql);

  if (reader.seesEveryPrivateRecord) {
    test("reads what a run carrying any incident or alert did: every private one is theirs to see", () => {
      for (const key of AI_RUN_CARRIED_KEYS) {
        expect(condition.sql).not.toContain(key.column);
      }

      expect(condition.sql).not.toContain("jsonb_array_elements_text");
    });

    return;
  }

  test.each([
    ["incidents", "carriedIncidentIds", "Incident"],
    ["alerts", "carriedAlertIds", "Alert"],
  ])(
    "reads what a run carrying no %s did, or carrying only ones that exist and they see",
    (_records: string, column: string, table: string) => {
      const key: string = `"${run}"."${column}"`;
      const match: RegExpMatchArray | null = condition.sql.match(
        new RegExp(
          `AND \\(${escapeRegExp(key)} IS NULL OR NOT EXISTS \\(SELECT 1 FROM \\(SELECT CASE WHEN char_length\\("(aiRunCarried\\w+)"\\."value"\\) = 36 AND "\\1"\\."value" ~\\* '\\^\\[0-9a-f\\]\\{8\\}-`,
        ),
      );

      expect(match).not.toBeNull();

      const entry: string = match![1]!;
      const id: string = entry.replace("aiRunCarried", "aiRunCarriedId");

      // Every entry of the list, which is read as none when it is no list.
      expect(condition.sql).toContain(
        `FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${key}) = 'array' THEN ${key} ELSE CAST('[]' AS jsonb) END) AS "${entry}"("value")) AS "${id}"`,
      );
      // An entry is cast only once it reads as an id: no entry fails the read.
      expect(condition.sql).toContain(
        `THEN CAST("${entry}"."value" AS uuid) END AS "id"`,
      );
      // Each entry: an id, of a record that exists ...
      expect(condition.sql).toContain(
        `WHERE NOT ("${id}"."id" IS NOT NULL AND EXISTS (SELECT 1 FROM "${table}" "aiRunCarriedRecord`,
      );
      // ... and is no private one they do not see.
      expect(condition.sql).toContain(
        `("${id}"."id" IS NULL OR NOT EXISTS (SELECT 1 FROM "${table}" pr WHERE pr."_id" = "${id}"."id" AND pr."isPrivate" = TRUE`,
      );
      // Never every record the caller may read, gathered first.
      expect(condition.sql).not.toMatch(
        new RegExp(`${escapeRegExp(key)} \\?|${escapeRegExp(key)} @>`),
      );
    },
  );

  test("reads what a turn of a task did only as the task is read: what the task carries included", () => {
    const key: string = `"${run}"."${AI_RUN_TASK_KEY}"`;
    const match: RegExpMatchArray | null = condition.sql.match(
      new RegExp(
        `AND \\(${escapeRegExp(key)} IS NULL OR EXISTS \\(SELECT 1 FROM "AIRun" "(aiRunTask\\w+)" WHERE "\\1"\\."_id" = ${escapeRegExp(key)} AND `,
      ),
    );

    expect(match).not.toBeNull();

    const task: string = match![1]!;

    expect(condition.sql).toContain(
      `("${task}"."carriedIncidentIds" IS NULL OR NOT EXISTS (SELECT 1 FROM (SELECT CASE WHEN`,
    );
    expect(condition.sql).toContain(
      `("${task}"."carriedAlertIds" IS NULL OR NOT EXISTS (SELECT 1 FROM (SELECT CASE WHEN`,
    );
  });

  if (reader.isAPerson) {
    test("sees a private one they own, or one a team of theirs owns, in what a run carries", () => {
      const carried: string = condition.sql.substring(
        condition.sql.indexOf(`"${run}"."carriedIncidentIds" IS NULL`),
      );

      expect(carried).toContain(`FROM "IncidentOwnerUser" prou`);
      expect(carried).toContain(`FROM "IncidentOwnerTeam" prot`);
    });
  }
});

/*
 * A pull request record a chat opened names no run: it carries the chat's
 * subject in keys of its own (#9186), held to the same rule.
 */
describe("a row's own list of what it carries", () => {
  test.each(
    READERS.filter((reader: Reader): boolean => {
      return !reader.seesEveryPrivateRecord;
    }),
  )("$who: each list is held to the rule", (reader: Reader) => {
    const query: Record<string, unknown> =
      AIRunOutputReadFilter.applyToCarriedKeys({
        query: { pullRequestState: "Open" } as Record<string, unknown>,
        props: reader.props,
        modelType: AIAgentTaskPullRequest,
      });

    expect(Object.keys(query).sort()).toEqual(
      ["carriedAlertIds", "carriedIncidentIds", "pullRequestState"].sort(),
    );
    expect(query["pullRequestState"]).toBe("Open");
    expect(written(query["carriedIncidentIds"]).sql).toMatch(
      /^\(COLUMN IS NULL OR NOT EXISTS \(SELECT 1 FROM \(SELECT CASE WHEN /,
    );
    expect(written(query["carriedIncidentIds"]).sql).toContain(
      `EXISTS (SELECT 1 FROM "Incident" "aiRunCarriedRecord`,
    );
    expect(written(query["carriedAlertIds"]).sql).toContain(
      `EXISTS (SELECT 1 FROM "Alert" "aiRunCarriedRecord`,
    );
  });

  test.each(
    READERS.filter((reader: Reader): boolean => {
      return reader.seesEveryPrivateRecord;
    }),
  )(
    "$who: nothing, as every private record is theirs to see",
    (reader: Reader) => {
      expect(
        AIRunOutputReadFilter.applyToCarriedKeys({
          query: { pullRequestState: "Open" },
          props: reader.props,
          modelType: AIAgentTaskPullRequest,
        }),
      ).toEqual({ pullRequestState: "Open" });
    },
  );

  test("keeps the caller's own filter on a list", () => {
    const query: Record<string, unknown> =
      AIRunOutputReadFilter.applyToCarriedKeys({
        query: { carriedIncidentIds: new NotNull() } as Record<string, unknown>,
        props: person(Permission.ProjectMember),
        modelType: AIAgentTaskPullRequest,
      });

    const kept: FindOperator<unknown> = query[
      "carriedIncidentIds"
    ] as FindOperator<unknown>;

    expect(kept.type).toBe("and");
    expect(
      (kept.value as unknown as Array<FindOperator<unknown>>)[1]!.type,
    ).toBe("raw");
  });

  test("written with positional parameters for the Code pages' own SQL, every value bound after the statement's own", () => {
    const parameters: Array<unknown> = [PROJECT_ID.toString()];
    const sql: string = AIRunOutputReadFilter.getCarriedRecordsSql({
      alias: "AIAgentTaskPullRequest",
      props: person(Permission.ProjectMember),
      parameters,
    })!;

    expect(sql).not.toMatch(/:(?:\.\.\.)?[A-Za-z]/);
    expect(sql).toContain(
      `"AIAgentTaskPullRequest"."carriedIncidentIds" IS NULL`,
    );
    expect(sql).toContain(`"AIAgentTaskPullRequest"."carriedAlertIds" IS NULL`);
    expect(
      Math.min(
        ...Array.from(sql.matchAll(/\$(\d+)/g), (match: RegExpMatchArray) => {
          return Number(match[1]);
        }),
      ),
    ).toBe(2);
    expect(parameters.slice(1)).toContain(USER_ID.toString());

    for (const props of [
      person(Permission.ProjectOwner),
      person(Permission.ProjectAdmin),
      { isRoot: true },
    ]) {
      const untouched: Array<unknown> = [];

      expect(
        AIRunOutputReadFilter.getCarriedRecordsSql({
          alias: "AIAgentTaskPullRequest",
          props,
          parameters: untouched,
        }),
      ).toBeNull();
      expect(untouched).toEqual([]);
    }
  });
});

describe.each(READERS)("$who, on a fix and a task", (reader: Reader) => {
  const condition: Written = written(
    AIRunOutputReadFilter.getReadableRunsRaw(reader.props),
  );
  const run: string = runAliasIn(condition.sql);

  if (reader.seesEveryPrivateRecord) {
    test("reads what a run about any fix did, and any turn of any task", () => {
      expect(condition.sql).not.toContain(
        "triggeredByAutoRemediationSuggestionId",
      );
      expect(condition.sql).not.toContain(AI_RUN_TASK_KEY);
      expect(condition.sql).not.toContain(`FROM "AutoRemediationSuggestion"`);
    });

    return;
  }

  test("reads what a run about no fix did, or about one that exists and whose incident or alert they see, looked up by its key", () => {
    const key: string = `"${run}"."triggeredByAutoRemediationSuggestionId"`;
    const match: RegExpMatchArray | null = condition.sql.match(
      new RegExp(
        `AND \\(${escapeRegExp(key)} IS NULL OR EXISTS \\(SELECT 1 FROM "AutoRemediationSuggestion" "(aiRunPart\\w+)" WHERE "\\1"\\."_id" = ${escapeRegExp(key)} AND `,
      ),
    );

    expect(match).not.toBeNull();

    const fix: string = match![1]!;

    // The fix's incident and its alert: none, or no private one unseen.
    expect(condition.sql).toContain(
      `("${fix}"."incidentId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Incident" pr WHERE pr."_id" = "${fix}"."incidentId" AND pr."isPrivate" = TRUE`,
    );
    expect(condition.sql).toContain(
      `("${fix}"."alertId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Alert" pr WHERE pr."_id" = "${fix}"."alertId" AND pr."isPrivate" = TRUE`,
    );
    // Never every fix the caller may read, gathered first.
    expect(condition.sql).not.toMatch(/IN \(SELECT "record\w+"\."_id"/);
  });

  test("reads what a turn of a task did only as the task is read: the task looked up by its key, its own keys held the same way", () => {
    const key: string = `"${run}"."${AI_RUN_TASK_KEY}"`;
    const match: RegExpMatchArray | null = condition.sql.match(
      new RegExp(
        `AND \\(${escapeRegExp(key)} IS NULL OR EXISTS \\(SELECT 1 FROM "AIRun" "(aiRunTask\\w+)" WHERE "\\1"\\."_id" = ${escapeRegExp(key)} AND `,
      ),
    );

    expect(match).not.toBeNull();

    const task: string = match![1]!;

    expect(condition.sql).toContain(
      `("${task}"."triggeredByIncidentId" IS NULL OR (EXISTS (SELECT 1 FROM "Incident"`,
    );
    expect(condition.sql).toContain(
      `("${task}"."triggeredByAlertId" IS NULL OR (EXISTS (SELECT 1 FROM "Alert"`,
    );
    expect(condition.sql).toContain(
      `("${task}"."triggeredByAutoRemediationSuggestionId" IS NULL OR EXISTS (SELECT 1 FROM "AutoRemediationSuggestion"`,
    );
    // A task is a first turn: it is not read through a task of its own.
    expect(condition.sql).not.toContain(`"${task}"."${AI_RUN_TASK_KEY}"`);
  });
});

/*
 * The AI run's own row (AIRunPrivacyFilter puts this beside its own rule):
 * a condition on each key the rule reads, beside the caller's filter.
 */
describe("a run's own row", () => {
  const readersNarrowed: Array<Reader> = READERS.filter(
    (reader: Reader): boolean => {
      return !reader.seesEveryPrivateRecord;
    },
  );

  test.each(readersNarrowed)(
    "$who: each key the rule reads is held to it",
    (reader: Reader) => {
      const query: Record<string, unknown> =
        AIRunOutputReadFilter.applyToRunRow(
          { status: "Running" } as Record<string, unknown>,
          reader.props,
        );

      expect(Object.keys(query).sort()).toEqual(
        [...AI_RUN_ABOUT_KEYS, "status"].sort(),
      );
      expect(query["status"]).toBe("Running");

      for (const key of AI_RUN_ABOUT_KEYS) {
        const sql: string = written(query[key]).sql;

        expect(sql.startsWith(`(COLUMN IS NULL OR `)).toBe(true);
      }

      expect(written(query["triggeredByIncidentId"]).sql).toContain(
        `FROM "Incident"`,
      );
      expect(written(query["triggeredByAlertId"]).sql).toContain(
        `FROM "Alert"`,
      );
      expect(
        written(query["triggeredByAutoRemediationSuggestionId"]).sql,
      ).toContain(`FROM "AutoRemediationSuggestion"`);
      expect(written(query[AI_RUN_TASK_KEY]).sql).toMatch(
        /^\(COLUMN IS NULL OR EXISTS \(SELECT 1 FROM "AIRun" "aiRunTask\w+" WHERE "aiRunTask\w+"\."_id" = COLUMN AND /,
      );
    },
  );

  test.each(
    READERS.filter((reader: Reader): boolean => {
      return reader.seesEveryPrivateRecord;
    }),
  )(
    "$who: nothing, as every private record is theirs to see",
    (reader: Reader) => {
      expect(
        AIRunOutputReadFilter.applyToRunRow(
          { status: "Running" },
          reader.props,
        ),
      ).toEqual({ status: "Running" });
    },
  );

  test.each([
    ["OneUptime itself", { isRoot: true }],
    ["a server admin", { isMasterAdmin: true, userId: USER_ID }],
  ])("%s: nothing", (_who: string, props: DatabaseCommonInteractionProps) => {
    expect(AIRunOutputReadFilter.applyToRunRow({}, props)).toEqual({});
  });

  test.each([
    [
      "a record's id",
      (): unknown => {
        return ObjectID.generate();
      },
    ],
    [
      "OneUptime's operator for a key naming one",
      (): unknown => {
        return new NotNull();
      },
    ],
    [
      "OneUptime's operator for a key naming none",
      (): unknown => {
        return new IsNull();
      },
    ],
  ])(
    "keeps the caller's own filter on a key: %s",
    (_what: string, value: () => unknown) => {
      const member: DatabaseCommonInteractionProps = person(
        Permission.ProjectMember,
      );

      for (const key of AI_RUN_ABOUT_KEYS) {
        const query: Record<string, unknown> =
          AIRunOutputReadFilter.applyToRunRow(
            { [key]: value() } as Record<string, unknown>,
            member,
          );

        const kept: FindOperator<unknown> = query[key] as FindOperator<unknown>;

        expect(kept.type).toBe("and");

        const parts: Array<FindOperator<unknown>> =
          kept.value as unknown as Array<FindOperator<unknown>>;

        expect(parts).toHaveLength(2);
        expect(parts[1]!.type).toBe("raw");
      }
    },
  );
});

/*
 * The Code pages read runs and pull requests with SQL of their own, written
 * with positional parameters (CodeTaskListQuery, CodeTaskStats): the rule,
 * written for them.
 */
describe("the rule for a statement with positional parameters", () => {
  const member: DatabaseCommonInteractionProps = person(
    Permission.ProjectMember,
  );

  function placeholdersIn(sql: string): Array<number> {
    return Array.from(sql.matchAll(/\$(\d+)/g), (match: RegExpMatchArray) => {
      return Number(match[1]);
    });
  }

  test("a run's: every value bound after the statement's own, and no named parameter left", () => {
    const parameters: Array<unknown> = [PROJECT_ID.toString(), "CodeFix"];
    const sql: string = AIRunOutputReadFilter.getRunAboutSql({
      alias: "AIRun",
      props: member,
      parameters,
    })!;

    expect(sql).not.toMatch(/:(?:\.\.\.)?[A-Za-z]/);
    expect(Math.min(...placeholdersIn(sql))).toBe(3);
    expect(Math.max(...placeholdersIn(sql))).toBe(parameters.length);
    // The person, bound once however often the rule reads them.
    expect(parameters.slice(2)).toContain(USER_ID.toString());

    for (const key of AI_RUN_ABOUT_KEYS) {
      expect(sql).toContain(`"AIRun"."${key}"`);
    }
  });

  test("a pull request's, through its run: the run's kinds bound one by one", () => {
    const parameters: Array<unknown> = [PROJECT_ID.toString()];
    const sql: string = AIRunOutputReadFilter.getReadableRunsSql({
      key: `"AIAgentTaskPullRequest"."aiRunId"`,
      props: member,
      parameters,
    })!;

    expect(sql).not.toMatch(/:(?:\.\.\.)?[A-Za-z]/);
    expect(sql).toMatch(
      /^\("AIAgentTaskPullRequest"\."aiRunId" IS NULL OR EXISTS \(SELECT 1 FROM "AIRun" "aiRun\w+" WHERE "aiRun\w+"\."_id" = "AIAgentTaskPullRequest"\."aiRunId" AND /,
    );
    expect(Math.min(...placeholdersIn(sql))).toBe(2);
    expect(Math.max(...placeholdersIn(sql))).toBe(parameters.length);
    expect(parameters).toContain(AIRunType.CodeFix);

    for (const kind of RUNS_ONEUPTIME_STARTS) {
      expect(parameters).toContain(kind);
    }
  });

  test("nothing for those who see every private record, and for OneUptime", () => {
    for (const props of [
      person(Permission.ProjectOwner),
      person(Permission.ProjectAdmin),
      { isRoot: true },
    ]) {
      const parameters: Array<unknown> = [];

      expect(
        AIRunOutputReadFilter.getRunAboutSql({
          alias: "AIRun",
          props,
          parameters,
        }),
      ).toBeNull();
      expect(parameters).toEqual([]);
    }

    expect(
      AIRunOutputReadFilter.getReadableRunsSql({
        key: "COLUMN",
        props: { isRoot: true },
        parameters: [],
      }),
    ).toBeNull();
  });
});
