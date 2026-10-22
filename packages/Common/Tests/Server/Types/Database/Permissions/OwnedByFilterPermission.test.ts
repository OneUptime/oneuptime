import Label from "../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import ColumnRefusalMessage from "../../../../../Server/Types/Database/Permissions/ColumnRefusalMessage";
import { CheckReadPermissionType } from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import Query from "../../../../../Server/Types/Database/Query";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OwnedBy, {
  OwnedByMatch,
} from "../../../../../Types/BaseDatabase/OwnedBy";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A FILTER BY OWNERS IS A READ OF THE OWNER TABLES.
 *
 * Which on-call schedules the SRE team owns is what the schedules' owner
 * tables hold, so filtering the schedules by an owner is held to what
 * listing those tables by that owner would be: the read of the people's
 * table for a person, of the teams' table for a team, of both to ask whether
 * a schedule has owners at all - each one's own read permission, no block
 * on it, and the read of the columns compared. Before the filter ran on the
 * server, the Dashboard read the owner tables itself and was held to exactly
 * that; a reader of schedules who may not read their owners learns no more
 * now than then.
 *
 * Every case goes through ModelPermission.checkReadQueryPermission, the
 * entry point every read takes before anything reaches the database.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const ADA: string = "0d4c9b2e-6a3f-4e1d-9b7a-2c5e8f1a3b60";
const SRE_TEAM: string = "2f6ebd40-8c51-4a3f-9d9c-4e7a0b3c5d82";

function caller(
  permissions: Array<Permission>,
  blocks?: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions,
      projectId: PROJECT_ID,
      blocks: blocks,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

async function checkRead(
  modelType: { new (): BaseModel },
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<CheckReadPermissionType<BaseModel>> {
  return await ModelPermission.checkReadQueryPermission<BaseModel>(
    modelType,
    query as Query<BaseModel>,
    { _id: true },
    props,
  );
}

async function refusalOf(
  modelType: { new (): BaseModel },
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<Error | null> {
  try {
    await checkRead(modelType, query, props);
    return null;
  } catch (err) {
    return err as Error;
  }
}

// The SQL a checked query's condition on the id runs, as a SELECT.
function idConditionSql(result: CheckReadPermissionType<BaseModel>): string {
  const render: (condition: FindOperator<any>) => string = (
    condition: FindOperator<any>,
  ): string => {
    if (condition.type === "and") {
      return (condition.value as unknown as Array<FindOperator<any>>)
        .map(render)
        .join(" AND ");
    }

    return condition.getSql
      ? condition.getSql("OnCallDutyPolicySchedule._id")
      : "";
  };

  return render(
    (result.query as Record<string, unknown>)["_id"] as FindOperator<any>,
  );
}

const BY_A_PERSON: () => OwnedBy = (): OwnedBy => {
  return new OwnedBy({ userIds: [ADA] });
};

const BY_A_TEAM: () => OwnedBy = (): OwnedBy => {
  return new OwnedBy({ teamIds: [SRE_TEAM] });
};

const BY_BOTH: () => OwnedBy = (): OwnedBy => {
  return new OwnedBy({ userIds: [ADA], teamIds: [SRE_TEAM] });
};

const ANYONE: () => OwnedBy = (): OwnedBy => {
  return new OwnedBy({ match: OwnedByMatch.AnyOwner });
};

const NOBODY: () => OwnedBy = (): OwnedBy => {
  return new OwnedBy({ match: OwnedByMatch.NoOwner });
};

const NONE_OF_THE_TEAM: () => OwnedBy = (): OwnedBy => {
  return new OwnedBy({ match: OwnedByMatch.NoneOf, teamIds: [SRE_TEAM] });
};

const EVERY_FILTER: Array<[string, () => OwnedBy]> = [
  ["by a person", BY_A_PERSON],
  ["by a team", BY_A_TEAM],
  ["by a person and a team", BY_BOTH],
  ["owned by anyone", ANYONE],
  ["owned by nobody", NOBODY],
  ["owned by none of a team", NONE_OF_THE_TEAM],
];

// Who reads on-call schedules and their owners.
const SCHEDULE_AND_OWNER_READERS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project member", [Permission.ProjectMember]],
  ["a viewer", [Permission.Viewer]],
  ["an on-call admin", [Permission.OnCallAdmin]],
  ["an on-call viewer", [Permission.OnCallViewer]],
  [
    "a reader of schedules and of both owner tables",
    [
      Permission.ReadProjectOnCallDutyPolicySchedule,
      Permission.ReadOnCallDutyPolicyScheduleOwnerUser,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
    ],
  ],
];

describe("a filter by owners, held to the owner tables' read", () => {
  describe.each(SCHEDULE_AND_OWNER_READERS)(
    "%s",
    (_who: string, permissions: Array<Permission>) => {
      test.each(EVERY_FILTER)(
        "filters the schedules %s, on the server",
        async (_filter: string, ownedBy: () => OwnedBy) => {
          const result: CheckReadPermissionType<BaseModel> = await checkRead(
            OnCallDutyPolicySchedule,
            { owners: ownedBy() },
            caller(permissions),
          );

          // The key is gone; the ids carry the owner tables' subquery.
          expect(
            (result.query as Record<string, unknown>)["owners"],
          ).toBeUndefined();
          expect(idConditionSql(result)).toContain(
            '"OnCallDutyPolicyScheduleOwner',
          );
        },
      );
    },
  );

  test("a reader of schedules who may not read their owners filters them by nobody", async () => {
    const readerOfSchedulesOnly: DatabaseCommonInteractionProps = caller([
      Permission.ReadProjectOnCallDutyPolicySchedule,
    ]);

    // The list itself reads.
    expect(
      await refusalOf(OnCallDutyPolicySchedule, {}, readerOfSchedulesOnly),
    ).toBeNull();

    for (const [, ownedBy] of EVERY_FILTER) {
      const error: Error | null = await refusalOf(
        OnCallDutyPolicySchedule,
        { owners: ownedBy() },
        readerOfSchedulesOnly,
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).toMatch(OWNER_TABLE_REFUSAL);
    }
  });

  test("a reader of the people's table filters by people, not by teams", async () => {
    const props: () => DatabaseCommonInteractionProps =
      (): DatabaseCommonInteractionProps => {
        return caller([
          Permission.ReadProjectOnCallDutyPolicySchedule,
          Permission.ReadOnCallDutyPolicyScheduleOwnerUser,
        ]);
      };

    expect(
      await refusalOf(
        OnCallDutyPolicySchedule,
        { owners: BY_A_PERSON() },
        props(),
      ),
    ).toBeNull();

    for (const ownedBy of [BY_A_TEAM, BY_BOTH, ANYONE, NOBODY]) {
      const error: Error | null = await refusalOf(
        OnCallDutyPolicySchedule,
        { owners: ownedBy() },
        props(),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).toContain("On-Call Schedule Team Owner");
    }
  });

  test("a reader of the teams' table filters by teams, not by people", async () => {
    const props: () => DatabaseCommonInteractionProps =
      (): DatabaseCommonInteractionProps => {
        return caller([
          Permission.ReadProjectOnCallDutyPolicySchedule,
          Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
        ]);
      };

    for (const ownedBy of [BY_A_TEAM, NONE_OF_THE_TEAM]) {
      expect(
        await refusalOf(
          OnCallDutyPolicySchedule,
          { owners: ownedBy() },
          props(),
        ),
      ).toBeNull();
    }

    const error: Error | null = await refusalOf(
      OnCallDutyPolicySchedule,
      { owners: BY_A_PERSON() },
      props(),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error?.message).toContain("On-Call Schedule User Owner");
  });

  test("a block on reading the teams' table takes the team filter away, not the person filter", async () => {
    const props: () => DatabaseCommonInteractionProps =
      (): DatabaseCommonInteractionProps => {
        return caller(
          [Permission.ProjectMember],
          [Permission.ReadOnCallDutyPolicyScheduleOwnerTeam],
        );
      };

    expect(
      await refusalOf(
        OnCallDutyPolicySchedule,
        { owners: BY_A_PERSON() },
        props(),
      ),
    ).toBeNull();

    expect(
      await refusalOf(
        OnCallDutyPolicySchedule,
        { owners: BY_A_TEAM() },
        props(),
      ),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("the refusal for a column of an owner table names the table and the filter", () => {
    expect(
      ColumnRefusalMessage.getRelationQueryRefusal({
        column: "teamId",
        relatedModelName: "On-Call Schedule Team Owner",
        relationColumn: "owners",
        permissions: [Permission.ProjectOwner],
      }),
    ).toContain("teamId of On-Call Schedule Team Owner through owners");
  });

  test("a kind without owners is told so, whoever asks", async () => {
    const error: Error | null = await refusalOf(
      Label,
      { owners: BY_A_TEAM() },
      caller([Permission.ProjectOwner]),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      "Labels have no owners, so they cannot be filtered by their owners.",
    );
  });

  test("a filter by owners under another key is refused, never read as that column", async () => {
    const error: Error | null = await refusalOf(
      Monitor,
      { name: BY_A_TEAM() },
      caller([Permission.ProjectOwner]),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      'A filter by owners goes under "owners", not "name".',
    );
  });

  test("root reads (the server's own) filter by owners with no check", async () => {
    const result: CheckReadPermissionType<BaseModel> = await checkRead(
      OnCallDutyPolicySchedule,
      { owners: BY_BOTH(), projectId: PROJECT_ID },
      { isRoot: true },
    );

    expect(idConditionSql(result)).toContain(
      '"OnCallDutyPolicyScheduleOwnerTeam"."teamId" IN (',
    );
  });
});

// A refusal of a read of one of the schedule's owner tables.
const OWNER_TABLE_REFUSAL: RegExp =
  /On-Call Schedule (User|Team) Owner/;
