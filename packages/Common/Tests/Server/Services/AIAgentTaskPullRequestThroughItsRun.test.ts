import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIAgentTaskPullRequestService, {
  PULL_REQUEST_AI_RUN_KEY,
  PULL_REQUEST_AI_RUN_NOT_FOUND_MESSAGE,
} from "../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../Server/Services/AIRunService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { CARRIED_RECORD_COLUMNS } from "../../../Server/Utils/AI/AIRunOutputReadFilter";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A CODEFIX RUN'S PULL REQUEST IS READ, CHANGED AND DELETED ONLY THROUGH
 * THE RUN THAT OPENED IT (#9165).
 *
 * Its title, description and how it stands say what the run did, so one
 * opened by a run about a private incident or alert is its owners' alone
 * (AIRunOutputReadFilter on aiRunId). AiRunOutputReadRules holds a find and
 * a count to that, and CodeFixRunReadPostgres runs them; this holds the
 * writes a person may make through the API to it: an update and a delete
 * reach only the pull requests the person may read, and a person records a
 * pull request only for a run they may read. OneUptime's own writes - a
 * Runner's record, the sync of a pull request's state - are not narrowed.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const RUN_ID: ObjectID = ObjectID.generate();

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

const MEMBER: DatabaseCommonInteractionProps = person(Permission.ProjectMember);

// The SQL a condition on the run key writes for a column called COLUMN.
function sqlOf(condition: unknown): string {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  return typeof operator?.getSql === "function"
    ? (operator.getSql as (alias: string) => string)("COLUMN")
    : "";
}

const THROUGH_THE_RUN: RegExp =
  /^\(COLUMN IS NULL OR EXISTS \(SELECT 1 FROM "AIRun" "(aiRun\w+)" WHERE "\1"\."_id" = COLUMN AND /;

// What a pull request a chat opened carries, entry by entry (#9186).
const WHAT_IT_CARRIES: RegExp =
  /^\(COLUMN IS NULL OR NOT EXISTS \(SELECT 1 FROM \(SELECT CASE WHEN /;

interface Hooks {
  onBeforeUpdate: (
    updateBy: UpdateBy<AIAgentTaskPullRequest>,
  ) => Promise<OnUpdate<AIAgentTaskPullRequest>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<AIAgentTaskPullRequest>,
  ) => Promise<OnDelete<AIAgentTaskPullRequest>>;
  checkCreateBeforeReferences: (
    createBy: CreateBy<AIAgentTaskPullRequest>,
  ) => Promise<void>;
}

const hooks: Hooks = AIAgentTaskPullRequestService as unknown as Hooks;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("changing and deleting a pull request", () => {
  test("a person's update reaches only the pull requests whose run they may read, their own filter kept", async () => {
    // The project's own check of what an update names: nothing here.
    jest
      .spyOn(ProjectReferenceCheck, "validateUpdate")
      .mockResolvedValue(undefined as never);

    const updated: OnUpdate<AIAgentTaskPullRequest> =
      await hooks.onBeforeUpdate({
        query: { _id: ObjectID.generate().toString() },
        data: { title: "renamed" },
        props: MEMBER,
      } as unknown as UpdateBy<AIAgentTaskPullRequest>);

    const query: Record<string, unknown> = updated.updateBy.query as Record<
      string,
      unknown
    >;

    expect(Object.keys(query).sort()).toEqual(
      ["_id", PULL_REQUEST_AI_RUN_KEY, ...CARRIED_RECORD_COLUMNS].sort(),
    );
    expect(sqlOf(query[PULL_REQUEST_AI_RUN_KEY])).toMatch(THROUGH_THE_RUN);

    // And only those whose chat's subject they may read (#9186).
    for (const column of CARRIED_RECORD_COLUMNS) {
      expect(sqlOf(query[column])).toMatch(WHAT_IT_CARRIES);
    }
  });

  test("a person's delete reaches only those too", async () => {
    const deleted: OnDelete<AIAgentTaskPullRequest> =
      await hooks.onBeforeDelete({
        query: { _id: ObjectID.generate().toString() },
        props: MEMBER,
      } as unknown as DeleteBy<AIAgentTaskPullRequest>);

    const query: Record<string, unknown> = deleted.deleteBy.query as Record<
      string,
      unknown
    >;

    expect(sqlOf(query[PULL_REQUEST_AI_RUN_KEY])).toMatch(THROUGH_THE_RUN);

    for (const column of CARRIED_RECORD_COLUMNS) {
      expect(sqlOf(query[column])).toMatch(WHAT_IT_CARRIES);
    }
  });

  test("OneUptime's own update and delete are not narrowed", async () => {
    jest
      .spyOn(ProjectReferenceCheck, "validateUpdate")
      .mockResolvedValue(undefined as never);

    const updated: OnUpdate<AIAgentTaskPullRequest> =
      await hooks.onBeforeUpdate({
        query: { _id: "a" },
        data: { pullRequestState: "Merged" },
        props: { isRoot: true },
      } as unknown as UpdateBy<AIAgentTaskPullRequest>);
    const deleted: OnDelete<AIAgentTaskPullRequest> =
      await hooks.onBeforeDelete({
        query: { _id: "a" },
        props: { isRoot: true },
      } as unknown as DeleteBy<AIAgentTaskPullRequest>);

    expect(updated.updateBy.query).toEqual({ _id: "a" });
    expect(deleted.deleteBy.query).toEqual({ _id: "a" });
  });
});

describe("recording a pull request", () => {
  function createBy(
    props: DatabaseCommonInteractionProps,
    runId?: ObjectID,
  ): CreateBy<AIAgentTaskPullRequest> {
    const row: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();

    if (runId) {
      row.aiRunId = runId;
    }

    return { data: row, props } as CreateBy<AIAgentTaskPullRequest>;
  }

  test("a person names only a run they may read: one they may not is answered as one that does not exist", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null);

    let refusal: unknown = null;

    try {
      await hooks.checkCreateBeforeReferences(createBy(MEMBER, RUN_ID));
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe(
      PULL_REQUEST_AI_RUN_NOT_FOUND_MESSAGE,
    );

    // Looked up as OneUptime, by its id, through the rule, in their project.
    const asked: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = read.mock.calls[0]![0] as never;

    expect(asked.props).toEqual({ isRoot: true });
    expect(asked.query["projectId"]).toEqual(PROJECT_ID);

    const id: FindOperator<unknown> = asked.query[
      "_id"
    ] as FindOperator<unknown>;

    expect(id.type).toBe("and");
    expect(
      sqlOf((id.value as unknown as Array<FindOperator<unknown>>)[1]),
    ).toMatch(THROUGH_THE_RUN);
  });

  test("a run they may read is recorded", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(new AIRun(RUN_ID));

    await expect(
      hooks.checkCreateBeforeReferences(createBy(MEMBER, RUN_ID)),
    ).resolves.toBeUndefined();
  });

  test("OneUptime's own records, and one naming no run, are not asked", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AIRunService,
      "findOneBy",
    );

    await hooks.checkCreateBeforeReferences(createBy({ isRoot: true }, RUN_ID));
    await hooks.checkCreateBeforeReferences(createBy(MEMBER));

    expect(read).not.toHaveBeenCalled();
  });
});
