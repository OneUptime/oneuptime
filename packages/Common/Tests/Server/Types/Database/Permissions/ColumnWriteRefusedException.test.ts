import Team from "../../../../../Models/DatabaseModels/Team";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ExceptionCode from "../../../../../Types/Exception/ExceptionCode";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A REFUSED COLUMN HAS A TYPE OF ITS OWN, AND THE SAME FACE AS BEFORE.
 *
 * A create or update that writes a column the caller may not write is
 * refused with a ColumnWriteRefusedException: to an API caller still the
 * BadDataException it always was (the same code, the same words), and to a
 * workflow step's run log a refusal it can name in plain words without
 * reading the message (LogComponentError).
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

// A column refusal written out as plain bad data, as both checks used to.
const PLAIN_COLUMN_REFUSAL: RegExp =
  /new BadDataException\(\s*`User is not allowed to/;

// A project owner: the most a person in a project holds.
function owner(): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [
          {
            permission: Permission.ProjectOwner,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          },
        ],
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function refusalOf(type: DatabaseRequestType): unknown {
  const team: Team = new Team();
  team.name = "Responders";
  // A team's protection switch: OneUptime's to set, nobody else's.
  team.isTeamEditable = false;

  try {
    ColumnPermissions.checkDataColumnPermissions(Team, team, owner(), type);
  } catch (error) {
    return error;
  }

  return null;
}

describe("ColumnWriteRefusedException", () => {
  test("is the BadDataException an API caller always got: the same code and words", () => {
    const error: ColumnWriteRefusedException = new ColumnWriteRefusedException({
      requestType: "update",
      columnName: "isCnameVerified",
      modelName: "Status Page Domain",
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.code).toBe(ExceptionCode.BadDataException);
    expect(error.message).toBe(
      "User is not allowed to update on isCnameVerified column of Status Page Domain",
    );
  });

  test.each([DatabaseRequestType.Create, DatabaseRequestType.Update])(
    "is what the column check throws on %s for a column the caller may not write",
    (type: DatabaseRequestType) => {
      const error: unknown = refusalOf(type);

      expect(error).toBeInstanceOf(ColumnWriteRefusedException);
      expect((error as Error).message).toBe(
        `User is not allowed to ${type} on isTeamEditable column of Team`,
      );
    },
  );

  test("both column checks throw it, never the words in a plain BadDataException", () => {
    const serverDir: string = path.resolve(__dirname, "../../../../../Server");

    for (const file of [
      "Types/Database/Permissions/ColumnPermission.ts",
      "Types/AnalyticsDatabase/ModelPermission.ts",
    ]) {
      const source: string = fs.readFileSync(
        path.join(serverDir, file),
        "utf8",
      );

      expect({
        file,
        typed: source.includes("new ColumnWriteRefusedException("),
      }).toEqual({
        file,
        typed: true,
      });
      expect({
        file,
        plain: PLAIN_COLUMN_REFUSAL.test(source),
      }).toEqual({ file, plain: false });
    }
  });
});
