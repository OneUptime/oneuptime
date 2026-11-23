import Entities from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIAgentTaskPullRequestService from "../../../../Server/Services/AIAgentTaskPullRequestService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import PrivateRecordPermission from "../../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import {
  AI_RUN_ABOUT_KEYS,
  CARRIED_RECORD_COLUMNS,
} from "../../../../Server/Utils/AI/AIRunOutputReadFilter";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import UserType from "../../../../Types/UserType";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * EVERY MODEL THAT STORES WHAT AN AI RUN DID HAS A READ RULE (#9155).
 *
 * A Runner job OneUptime AI ran for a chat or an investigation held the
 * command and what it printed, and every project member who could read
 * Runner jobs read it: the job's table had a read rule for the runbook runs
 * and fixes it named, none for the AI run. So a new table that keeps an AI
 * run's output - a message, a step, a tool call, a log, an attachment -
 * is named here with the rule that keeps it to the run's readers, and this
 * suite checks the rule is there. A model "stores what an AI run did" when
 * it names an AI run (a key ending in aiRunId, or a relation to AIRun) or a
 * chat (a relation to AIConversation).
 *
 * A model that names one and is not listed fails "is listed with the rule
 * it follows": put it in RULES with the rule its service applies, or with
 * why it holds none of the run's output, and the rule is checked below.
 */

type ServiceOf = DatabaseService<BaseModel>;

type Rule =
  // Read only by those who may read the run it names (AIRunOutputReadFilter).
  | { kind: "readThroughTheRun"; service: ServiceOf; column: string }
  // A person's own: pinned to the person who asked (AIChatPrivacyFilter).
  | { kind: "thePersonWhoAsked"; service: ServiceOf; column: string }
  // The AI run itself: its own read rule (AIRunPrivacyFilter).
  | { kind: "theRunItself"; service: ServiceOf }
  // Read and written only by OneUptime: no read permission and no API.
  | { kind: "readOnlyByOneUptime" }
  /*
   * A part of the incident or alert it is about, read as that record is
   * (PrivateRecordReadFilter): what it holds of a run is posted there.
   */
  | { kind: "partOfTheRecord"; why: string }
  // The project's, as the run it names is: a CodeFix run's, or OneUptime's own.
  | { kind: "projectWide"; why: string };

function asService(service: unknown): ServiceOf {
  return service as ServiceOf;
}

// Every model that stores what an AI run did, by table, with its rule.
const RULES: Record<string, Rule> = {
  RunnerJob: {
    kind: "readThroughTheRun",
    service: asService(RunnerJobService),
    column: "aiRunId",
  },
  AIRunEvent: {
    kind: "thePersonWhoAsked",
    service: asService(AIRunEventService),
    column: "userId",
  },
  AIConversationMessage: {
    kind: "thePersonWhoAsked",
    service: asService(AIConversationMessageService),
    column: "userId",
  },
  /*
   * A chat: Ask AI's, or an incident's or alert's AI conversation, which
   * has no person of its own and is read only through its subject's
   * investigation API.
   */
  AIConversation: {
    kind: "thePersonWhoAsked",
    service: asService(AIConversationService),
    column: "createdByUserId",
  },
  AIRun: { kind: "theRunItself", service: asService(AIRunService) },
  AIRunRecording: { kind: "readOnlyByOneUptime" },
  CodeRepositoryMintedToken: { kind: "readOnlyByOneUptime" },
  LlmLog: {
    kind: "partOfTheRecord",
    why: "A run's model calls never store the prompt or the answer (storeContentPreviews: false on every chat, investigation, fix and CodeFix run's call): what is left is their cost and usage, read as the incident or alert they were about.",
  },
  IncidentFeed: {
    kind: "partOfTheRecord",
    why: "The report an investigation posts on its incident is part of the incident.",
  },
  AlertFeed: {
    kind: "partOfTheRecord",
    why: "The report an investigation posts on its alert is part of the alert.",
  },
  AutoRemediationSuggestion: {
    kind: "partOfTheRecord",
    why: "The fix OneUptime AI proposed for an incident or alert, read only by those who see it (#9101).",
  },
  /*
   * A CodeFix run's pull request: the project's as CodeFix runs are, and
   * one about a private incident or alert only its owners' (#9165).
   */
  AIAgentTaskPullRequest: {
    kind: "readThroughTheRun",
    service: asService(AIAgentTaskPullRequestService),
    column: "aiRunId",
  },
  AIInsight: {
    kind: "projectWide",
    why: "An insight's triage, which OneUptime starts on its own about no incident or alert, and its fix task, a CodeFix run.",
  },
  /*
   * What OneUptime AI proposed for a Data Security issue (#10364): the
   * change and why, in names and counts, read only by the issue's readers
   * (CanAccessIfCanReadOn the issue). The run it names is OneUptime AI's
   * own work on the issue, which nobody chats with, and none of the run's
   * output is kept on it.
   */
  DataSecurityAiProposal: {
    kind: "projectWide",
    why: "A change OneUptime AI proposed for a Data Security issue, about no incident or alert, read by the issue's readers; it keeps none of the run's output.",
  },
  /*
   * OneUptime AI's log of a security case it works (#10352): each step it
   * took, asked about or left, and why, read only by the case's readers
   * (CanAccessIfCanReadOn the case), as a Data Security issue's proposals
   * are. The run it names is OneUptime AI's own look at the case, which
   * asks no model and nobody chats with.
   */
  SecurityCaseAiAction: {
    kind: "projectWide",
    why: "What OneUptime AI did, asked or left on a security case it works, and why, about no incident or alert, read by the case's readers; the run it names asks no model, so it keeps no model output.",
  },
};

// A key naming an AI run: aiRunId, triageAiRunId, fixAiRunId.
const AI_RUN_KEY: RegExp = /(?:^a|A)iRunId$/;

/*
 * What `modelType` names of AI runs and chats: its keys and relations - and
 * the run and the chat themselves, which hold what was asked and answered.
 */
function namesOfAiRuns(modelType: { new (): BaseModel }): Array<string> {
  const model: BaseModel = new modelType();
  const names: Array<string> =
    modelType === AIRun || modelType === AIConversation ? ["(itself)"] : [];

  for (const column of model.getTableColumns().columns) {
    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(column);

    if (!metadata) {
      continue;
    }

    const isRelation: boolean =
      metadata.type === TableColumnType.Entity ||
      metadata.type === TableColumnType.EntityArray;

    if (
      (metadata.type === TableColumnType.ObjectID && AI_RUN_KEY.test(column)) ||
      (isRelation &&
        (metadata.modelType === AIRun || metadata.modelType === AIConversation))
    ) {
      names.push(column);
    }
  }

  return names;
}

const HOLDERS: Array<{ tableName: string; names: Array<string> }> =
  Entities.map((modelType: { new (): BaseModel }) => {
    return {
      tableName: new modelType().tableName as string,
      names: namesOfAiRuns(modelType),
    };
  }).filter((holder: { names: Array<string> }): boolean => {
    return holder.names.length > 0;
  });

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

function person(permission: Permission): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
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

// Each of them reads a run's output only by its rule: none sees every one.
const READERS: Array<[string, DatabaseCommonInteractionProps]> = [
  ["a member", person(Permission.ProjectMember)],
  ["a Project Owner", person(Permission.ProjectOwner)],
];

// What a service's read hook makes of an empty query for `props`.
async function hookedQuery(
  service: ServiceOf,
  props: DatabaseCommonInteractionProps,
): Promise<Record<string, unknown>> {
  const found: { findBy: { query: Record<string, unknown> } } = await (
    service as unknown as {
      onBeforeFind: (findBy: unknown) => Promise<{
        findBy: { query: Record<string, unknown> };
      }>;
    }
  ).onBeforeFind({ query: {}, props: props, skip: 0, limit: 10 });

  return found.findBy.query;
}

// What a service's count makes of an empty query for `props`.
async function countedQuery(
  service: ServiceOf,
  props: DatabaseCommonInteractionProps,
): Promise<Record<string, unknown>> {
  const counted: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    DatabaseService.prototype,
    "countBy",
  ).mockResolvedValue(new PositiveNumber(0) as never);

  await service.countBy({ query: {}, props: props });

  const query: Record<string, unknown> = (
    counted.mock.calls[0]![0] as { query: Record<string, unknown> }
  ).query;

  counted.mockRestore();

  return query;
}

function sqlOf(condition: unknown): string {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  return typeof operator?.getSql === "function"
    ? (operator.getSql as (alias: string) => string)("COLUMN")
    : "";
}

function modelTypeOf(tableName: string): { new (): BaseModel } {
  return Entities.find((modelType: { new (): BaseModel }): boolean => {
    return new modelType().tableName === tableName;
  })!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every model that stores what an AI run did", () => {
  test("finds the models it knows to hold one", () => {
    const tables: Array<string> = HOLDERS.map(
      (holder: { tableName: string }): string => {
        return holder.tableName;
      },
    );

    for (const known of [
      "RunnerJob",
      "AIRunEvent",
      "AIConversationMessage",
      "AIRun",
      "LlmLog",
      "AIInsight",
    ]) {
      expect(tables).toContain(known);
    }
  });

  test.each(HOLDERS)(
    "$tableName is listed with the rule it follows",
    (holder: { tableName: string; names: Array<string> }) => {
      expect({
        table: holder.tableName,
        names: holder.names,
        isListed: Boolean(RULES[holder.tableName]),
      }).toEqual({
        table: holder.tableName,
        names: holder.names,
        isListed: true,
      });
    },
  );

  test("lists no model that stores none", () => {
    const tables: Array<string> = HOLDERS.map(
      (holder: { tableName: string }): string => {
        return holder.tableName;
      },
    );

    expect(
      Object.keys(RULES).filter((table: string): boolean => {
        return !tables.includes(table);
      }),
    ).toEqual([]);
  });
});

describe.each(
  Object.entries(RULES).map(([tableName, rule]: [string, Rule]) => {
    return { tableName, rule };
  }),
)("$tableName", ({ tableName, rule }: { tableName: string; rule: Rule }) => {
  if (rule.kind === "readThroughTheRun") {
    test.each(READERS)(
      "is read by %s only through the AI run it names, in a find and a count",
      async (_who: string, props: DatabaseCommonInteractionProps) => {
        for (const query of [
          await hookedQuery(rule.service, props),
          await countedQuery(rule.service, props),
        ]) {
          expect(sqlOf(query[rule.column])).toMatch(
            /^\(COLUMN IS NULL OR EXISTS \(SELECT 1 FROM "AIRun" "(aiRun\w+)" WHERE "\1"\."_id" = COLUMN AND /,
          );
        }

        expect(rule.service.getColumnsReadHooksNarrowBy()).toContain(
          rule.column,
        );
      },
    );
  }

  if (rule.kind === "thePersonWhoAsked") {
    test.each(READERS)(
      "is read by %s only as their own, in a find and a count",
      async (_who: string, props: DatabaseCommonInteractionProps) => {
        expect((await hookedQuery(rule.service, props))[rule.column]).toEqual(
          USER_ID,
        );
        expect((await countedQuery(rule.service, props))[rule.column]).toEqual(
          USER_ID,
        );

        /*
         * What its read hook narrows by names the person's column, or is
         * not said, which every live update then takes as every column.
         */
        const narrowedBy: Array<string> | null =
          rule.service.getColumnsReadHooksNarrowBy();

        expect(narrowedBy === null || narrowedBy.includes(rule.column)).toBe(
          true,
        );
      },
    );
  }

  if (rule.kind === "theRunItself") {
    test.each(READERS)(
      "is read by %s by the AI run's own rule: a CodeFix run, or their own",
      async (_who: string, props: DatabaseCommonInteractionProps) => {
        for (const query of [
          await hookedQuery(rule.service, props),
          await countedQuery(rule.service, props),
        ]) {
          expect(sqlOf(query["runType"])).toMatch(
            /^\(COLUMN = :aiRunType_\w+ OR "AIRun"\."userId" = :aiRunUid_\w+\)$/,
          );
        }
      },
    );

    /*
     * And a run about a private incident or alert only by those who see it
     * (#9165): a condition on every key naming what a run is about, in a
     * find and a count alike, which the read hook says it narrows by. A
     * Project Owner sees every private record, so none.
     */
    test("is read by a member only where they see the private record it is about; by a Project Owner everywhere", async () => {
      const [member, owner]: Array<DatabaseCommonInteractionProps> =
        READERS.map(([, props]: [string, DatabaseCommonInteractionProps]) => {
          return props;
        });

      for (const query of [
        await hookedQuery(rule.service, member!),
        await countedQuery(rule.service, member!),
      ]) {
        for (const key of AI_RUN_ABOUT_KEYS) {
          expect({ key, sql: sqlOf(query[key]) }).toEqual({
            key,
            sql: expect.stringMatching(/^\(COLUMN IS NULL OR /),
          });
        }
      }

      for (const query of [
        await hookedQuery(rule.service, owner!),
        await countedQuery(rule.service, owner!),
      ]) {
        for (const key of AI_RUN_ABOUT_KEYS) {
          expect(query[key]).toBeUndefined();
        }
      }

      expect(rule.service.getColumnsReadHooksNarrowBy()).toEqual(
        expect.arrayContaining([...AI_RUN_ABOUT_KEYS]),
      );
    });
  }

  if (rule.kind === "readOnlyByOneUptime") {
    test("has no read permission and no API", () => {
      const model: BaseModel = new (modelTypeOf(tableName))();

      expect(model.getReadPermissions()).toEqual([]);
      expect(model.getCrudApiPath()).toBeFalsy();
    });
  }

  if (rule.kind === "partOfTheRecord") {
    test("is read as the incident or alert it is part of", () => {
      expect(
        PrivateRecordPermission.getPrivateRecordColumns(modelTypeOf(tableName))
          .length,
      ).toBeGreaterThan(0);
      expect(rule.why.length).toBeGreaterThan(0);
    });
  }

  if (rule.kind === "projectWide") {
    test("says why it is the project's", () => {
      expect(rule.why.length).toBeGreaterThan(0);
    });
  }
});

/*
 * A pull request OneUptime AI opened from a chat names no run: it carries
 * the chat's subject in keys of its own (#9186), each held to the rule in a
 * find and a count alike, and named among what its read hook narrows by. A
 * Project Owner sees every private record, so none.
 */
describe("a pull request record a chat opened", () => {
  const service: ServiceOf = asService(AIAgentTaskPullRequestService);

  test("is read by a member only where they see what it carries; by a Project Owner everywhere", async () => {
    const [member, owner]: Array<DatabaseCommonInteractionProps> = READERS.map(
      ([, props]: [string, DatabaseCommonInteractionProps]) => {
        return props;
      },
    );

    for (const query of [
      await hookedQuery(service, member!),
      await countedQuery(service, member!),
    ]) {
      for (const column of CARRIED_RECORD_COLUMNS) {
        expect({ column, sql: sqlOf(query[column]) }).toEqual({
          column,
          sql: expect.stringMatching(
            /^\(COLUMN IS NULL OR NOT EXISTS \(SELECT 1 FROM \(SELECT CASE WHEN /,
          ),
        });
      }
    }

    for (const query of [
      await hookedQuery(service, owner!),
      await countedQuery(service, owner!),
    ]) {
      for (const column of CARRIED_RECORD_COLUMNS) {
        expect(query[column]).toBeUndefined();
      }
    }

    expect(service.getColumnsReadHooksNarrowBy()).toEqual(
      expect.arrayContaining([...CARRIED_RECORD_COLUMNS]),
    );
  });
});
