import AIRunOutputReadFilter, {
  AI_RUN_RECORD_KEYS,
  AIRunRecordKey,
  PERSONAL_RUNS,
  PROJECT_WIDE_RUNS,
  RUNS_ONEUPTIME_STARTS,
} from "../../../../Server/Utils/AI/AIRunOutputReadFilter";
import WorkflowPrincipal from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
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

  test("a chat is a person's own; an investigation and a fix's runs OneUptime's; a CodeFix run the project's", () => {
    expect(PERSONAL_RUNS).toEqual([AIRunType.Chat]);
    expect([...RUNS_ONEUPTIME_STARTS].sort()).toEqual(
      [
        AIRunType.Investigation,
        AIRunType.RemediationPlan,
        AIRunType.RemediationExecution,
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
