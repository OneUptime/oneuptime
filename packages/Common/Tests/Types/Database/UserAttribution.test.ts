import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "../../../Models/DatabaseModels/User";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import ColumnAccessControlDecorator, {
  getColumnAccessControl,
} from "../../../Types/Database/AccessControl/ColumnAccessControl";
import TableColumn, {
  getTableColumn,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import UserAttribution, {
  ATTRIBUTED_SWITCHES,
  CREATED_BY_USER_COLUMN,
  CREATED_BY_USER_ID_COLUMN,
  ModelWithUserAttribution,
} from "../../../Types/Database/UserAttribution";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Who did something to a record - created it, archived it, triggered it - is
 * recorded in a column named for the act (`createdByUserId`, and the relation
 * `createdByUser`). OneUptime decides those, never a write: the rule follows
 * the name, so these pin exactly which names it covers, and that the column
 * decorators apply it to whatever a model declares.
 */

describe("which columns say who did something to a record", () => {
  test.each([
    "createdByUserId",
    "createdByUser",
    "deletedByUserId",
    "archivedByUser",
    "acknowledgedByUserId",
    "markedAsResolvedByUserId",
    "markedAsArchivedByUser",
    "humanVerdictByUserId",
    "projectCreatedByUserId",
    "triggeredByUser",
    "addedByUserId",
  ])("%s does", (columnName: string) => {
    expect(UserAttribution.isColumn(columnName)).toBe(true);
  });

  test.each([
    // A person a record is about, or for: the request chooses them.
    "userId",
    "user",
    "ownerUserId",
    "alertSentToUserId",
    "onCallUserId",
    // Not a person.
    "createdByProbeId",
    "createdByProbe",
    "viewedByApiKeyId",
    "triggeredByIncidentId",
    "acknowledgedByTeamId",
    "isAddedByTeam",
    // The name and email kept beside a deleted project: text, not a user.
    "projectDeletedByUserName",
    "projectCreatedByUserEmail",
    // Close, but not the shape.
    "createdByUsers",
    "createdbyuserid",
    "ByUserId",
    "createdAt",
    "",
  ])("%s does not", (columnName: string) => {
    expect(UserAttribution.isColumn(columnName)).toBe(false);
  });

  test("a symbol or nothing is not a column", () => {
    expect(UserAttribution.isColumn(Symbol("createdByUserId"))).toBe(false);
    expect(UserAttribution.isColumn(undefined)).toBe(false);
  });

  test("the creator's two names are the ones every model uses", () => {
    expect(CREATED_BY_USER_ID_COLUMN).toBe("createdByUserId");
    expect(CREATED_BY_USER_COLUMN).toBe("createdByUser");
  });
});

describe("how a column's declaration applies", () => {
  const declared: ColumnAccessControl = {
    create: [Permission.ProjectOwner, Permission.ProjectMember],
    read: [Permission.ProjectOwner, Permission.Viewer],
    update: [Permission.ProjectAdmin],
  };

  test("who did something to a record is read as declared and written by no request", () => {
    expect(
      UserAttribution.getAccessControl("createdByUserId", declared),
    ).toEqual({
      create: [],
      read: [Permission.ProjectOwner, Permission.Viewer],
      update: [],
    });
  });

  test("the declaration itself is left as it was", () => {
    UserAttribution.getAccessControl("archivedByUser", declared);

    expect(declared.create).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectMember,
    ]);
    expect(declared.update).toEqual([Permission.ProjectAdmin]);
  });

  test("any other column keeps its declaration, the same object", () => {
    expect(UserAttribution.getAccessControl("name", declared)).toBe(declared);
    expect(UserAttribution.getAccessControl(undefined, declared)).toBe(
      declared,
    );
  });

  test("who did something to a record is computed, on a copy", () => {
    const metadata: TableColumnMetadata = {
      type: TableColumnType.ObjectID,
      title: "Created by User ID",
    };

    const applied: TableColumnMetadata = UserAttribution.getColumnMetadata(
      "createdByUserId",
      metadata,
    );

    expect(applied).toEqual({
      type: TableColumnType.ObjectID,
      title: "Created by User ID",
      computed: true,
    });
    expect(metadata.computed).toBeUndefined();
  });

  test("any other column keeps its metadata, the same object", () => {
    const metadata: TableColumnMetadata = { type: TableColumnType.Name };

    expect(UserAttribution.getColumnMetadata("name", metadata)).toBe(metadata);
  });
});

describe("a model's columns that say who did something to a record", () => {
  function modelWith(
    columns: Record<string, { manyToOneRelationColumn?: string }>,
  ): ModelWithUserAttribution {
    return {
      getTableColumns: (): { columns: Array<string> } => {
        return { columns: Object.keys(columns) };
      },
      getTableColumnMetadata: (
        columnName: string,
      ): { manyToOneRelationColumn?: string | undefined } | undefined => {
        return columns[columnName];
      },
    };
  }

  test("both names of each, and nothing else", () => {
    expect(
      UserAttribution.getColumns(
        modelWith({
          name: {},
          userId: {},
          user: { manyToOneRelationColumn: "userId" },
          createdByUserId: {},
          createdByUser: { manyToOneRelationColumn: "createdByUserId" },
          archivedByUserId: {},
        }),
      ),
    ).toEqual(["createdByUserId", "createdByUser", "archivedByUserId"]);
  });

  test("a relation over one of them counts whatever it is called", () => {
    expect(
      UserAttribution.getColumns(
        modelWith({
          createdByUserId: {},
          author: { manyToOneRelationColumn: "createdByUserId" },
        }),
      ),
    ).toEqual(["createdByUserId", "author"]);
  });

  test("a model with none has none", () => {
    expect(
      UserAttribution.getColumns(
        modelWith({ name: {}, ownerUserId: {}, createdByProbeId: {} }),
      ),
    ).toEqual([]);
  });
});

/*
 * The decorators apply the rule to whatever a model declares, so a new model
 * that copies a creator column with a create list from an older one is
 * covered as it is declared.
 */
class DeclaredAttribution extends BaseModel {
  @ColumnAccessControlDecorator({
    create: [Permission.ProjectOwner],
    read: [Permission.ProjectOwner],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
  })
  public createdByUser?: User = undefined;

  @ColumnAccessControlDecorator({
    create: [Permission.ProjectOwner],
    read: [Permission.ProjectOwner],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControlDecorator({
    create: [Permission.ProjectOwner],
    read: [Permission.ProjectOwner],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Owner",
  })
  public ownerUserId?: ObjectID = undefined;
}

describe("the column decorators", () => {
  const model: DeclaredAttribution = new DeclaredAttribution();

  test.each(["createdByUser", "createdByUserId"])(
    "%s is computed and closed to every write",
    (columnName: string) => {
      expect(getTableColumn(model, columnName).computed).toBe(true);
      expect(getColumnAccessControl(model, columnName)).toEqual({
        create: [],
        read: [Permission.ProjectOwner],
        update: [],
      });
    },
  );

  test("the rest of the declaration stays", () => {
    expect(getTableColumn(model, "createdByUser")).toEqual(
      expect.objectContaining({
        manyToOneRelationColumn: "createdByUserId",
        type: TableColumnType.Entity,
        title: "Created by User",
      }),
    );
  });

  test("a column a request chooses is declared exactly as written", () => {
    expect(getTableColumn(model, "ownerUserId").computed).toBeUndefined();
    expect(getColumnAccessControl(model, "ownerUserId")).toEqual({
      create: [Permission.ProjectOwner],
      read: [Permission.ProjectOwner],
      update: [Permission.ProjectOwner],
    });
  });

  test("the model reports them that way too", () => {
    expect(model.getTableColumnMetadata("createdByUserId").computed).toBe(true);
    expect(model.getColumnAccessControlFor("createdByUserId")).toEqual({
      create: [],
      read: [Permission.ProjectOwner],
      update: [],
    });
    expect(UserAttribution.getColumns(model)).toEqual([
      "createdByUser",
      "createdByUserId",
    ]);
  });
});

describe("when a switch was turned", () => {
  test.each(["archivedAt", "markedAsResolvedAt", "markedAsArchivedAt"])(
    "%s is OneUptime's to say",
    (columnName: string) => {
      expect(UserAttribution.isTimeColumn(columnName)).toBe(true);
      expect(UserAttribution.isDecidedByServer(columnName)).toBe(true);
      expect(UserAttribution.isColumn(columnName)).toBe(false);
    },
  );

  test.each([
    "createdAt",
    "updatedAt",
    "addedAt",
    "postedAt",
    "autoArchivedAt",
    "manuallyRestoredAt",
    "lastSeenAt",
  ])("%s is not one of them", (columnName: string) => {
    expect(UserAttribution.isTimeColumn(columnName)).toBe(false);
    expect(UserAttribution.isDecidedByServer(columnName)).toBe(false);
  });

  test("each switch names who turned it and when", () => {
    expect(ATTRIBUTED_SWITCHES.length).toBeGreaterThan(0);

    for (const attributedSwitch of ATTRIBUTED_SWITCHES) {
      expect(UserAttribution.isColumn(attributedSwitch.byUserColumn)).toBe(
        true,
      );
      expect(UserAttribution.isTimeColumn(attributedSwitch.atColumn)).toBe(
        true,
      );
      expect(
        UserAttribution.isDecidedByServer(attributedSwitch.switchColumn),
      ).toBe(false);
    }
  });

  test("a time is closed and computed like a person", () => {
    expect(
      UserAttribution.getAccessControl("markedAsResolvedAt", {
        create: [Permission.ProjectOwner],
        read: [Permission.ProjectOwner],
        update: [Permission.ProjectOwner],
      }),
    ).toEqual({ create: [], read: [Permission.ProjectOwner], update: [] });

    const metadata: TableColumnMetadata = { type: TableColumnType.Date };

    expect(
      UserAttribution.getColumnMetadata("archivedAt", metadata).computed,
    ).toBe(true);
  });

  test("a model's switch times are among the columns OneUptime decides", () => {
    expect(
      UserAttribution.getColumns({
        getTableColumns: (): { columns: Array<string> } => {
          return {
            columns: ["name", "isArchived", "archivedAt", "archivedByUserId"],
          };
        },
        getTableColumnMetadata: (): undefined => {
          return undefined;
        },
      }),
    ).toEqual(["archivedAt", "archivedByUserId"]);
  });
});

class DeclaredSwitchTime extends BaseModel {
  @ColumnAccessControlDecorator({
    create: [Permission.ProjectOwner],
    read: [Permission.ProjectOwner],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({ type: TableColumnType.Date, title: "Marked as Resolved At" })
  public markedAsResolvedAt?: Date = undefined;
}

describe("the column decorators, on a switch's time", () => {
  test("it is computed and closed to every write, whatever it declares", () => {
    const model: DeclaredSwitchTime = new DeclaredSwitchTime();

    expect(getTableColumn(model, "markedAsResolvedAt").computed).toBe(true);
    expect(getColumnAccessControl(model, "markedAsResolvedAt")).toEqual({
      create: [],
      read: [Permission.ProjectOwner],
      update: [],
    });
  });
});
