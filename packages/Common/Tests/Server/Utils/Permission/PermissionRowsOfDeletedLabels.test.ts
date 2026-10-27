import ApiKeyPermissionService from "../../../../Server/Services/ApiKeyPermissionService";
import CustomRolePermissionService from "../../../../Server/Services/CustomRolePermissionService";
import LabelService from "../../../../Server/Services/LabelService";
import ServiceLevelObjectiveMonitorRuleService from "../../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import StatusPageMonitorRuleService from "../../../../Server/Services/StatusPageMonitorRuleService";
import TeamPermissionService from "../../../../Server/Services/TeamPermissionService";
import DeleteBy from "../../../../Server/Types/Database/DeleteBy";
import CustomRoleSync from "../../../../Server/Utils/CustomRole/CustomRoleSync";
import PermissionRowsOfDeletedLabels, {
  RowsLimitedOnlyTo,
} from "../../../../Server/Utils/Permission/PermissionRowsOfDeletedLabels";
import ApiKeyPermission from "../../../../Models/DatabaseModels/ApiKeyPermission";
import CustomRolePermission from "../../../../Models/DatabaseModels/CustomRolePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../../Models/DatabaseModels/Label";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import { idsNamedBy } from "../../TestingUtils/QueryConditions";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PERMISSION LIMITED TO LABELS THAT ARE DELETED GOES WITH THEM
 * (PermissionRowsOfDeletedLabels, asked by LabelService before a delete).
 *
 * The database deletes a permission's links to a label with the label, and
 * a permission left with no labels reaches the whole project. So a member
 * limited to one customer's incidents who may delete labels could delete
 * that customer's label and read every incident. Now the permissions - a
 * team's, an API key's, a custom role's - limited to the deleted labels
 * alone go first, and whoever held them is refreshed; a permission that
 * keeps another label, and a copy of a role's permission (which goes with
 * the role's own), are left as they are. A cleanup that fails refuses the
 * label's delete.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000002",
);
const TEAM_ID: ObjectID = new ObjectID("bb000000-0000-4000-8000-000000000001");

// The label deleted, and one that stays.
const DELETED: ObjectID = new ObjectID("cc000000-0000-4000-8000-000000000001");
const ALSO_DELETED: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000000002",
);
const KEPT: ObjectID = new ObjectID("cc000000-0000-4000-8000-000000000003");

interface StoredRow {
  id: ObjectID;
  projectId: ObjectID;
  labelIds: Array<ObjectID>;
  teamId?: ObjectID;
  teamCustomRoleId?: ObjectID;
  customRolePermissionId?: ObjectID;
  apiKeyCustomRoleId?: ObjectID;
}

function labelsOf(labelIds: Array<ObjectID>): Array<Label> {
  return labelIds.map((labelId: ObjectID): Label => {
    const label: Label = new Label();
    label.id = labelId;
    return label;
  });
}

/*
 * Stubs a permission service's findBy over `rows`: a query by labels finds
 * the rows carrying one of them (and, as a relation filter does, trims the
 * labels to the matched ones), a query by ids the rows with all their
 * labels. deleteBy is recorded.
 */
function stubService<TModel extends BaseModel>(
  service: {
    findBy: (...args: Array<never>) => unknown;
    deleteBy: (...args: Array<never>) => unknown;
  },
  rows: Array<StoredRow>,
  make: (row: StoredRow, labelIds: Array<ObjectID>) => TModel,
): Array<Dictionary<unknown>> {
  const deletes: Array<Dictionary<unknown>> = [];

  jest.spyOn(service, "findBy").mockImplementation((async (data: {
    query: Dictionary<unknown>;
  }): Promise<Array<TModel>> => {
    const labelFilter: unknown = data.query["labels"];

    if (Array.isArray(labelFilter)) {
      const wanted: Array<string> = (labelFilter as Array<ObjectID>).map(
        (labelId: ObjectID): string => {
          return labelId.toString();
        },
      );

      return rows
        .filter((row: StoredRow): boolean => {
          return row.labelIds.some((labelId: ObjectID): boolean => {
            return wanted.includes(labelId.toString());
          });
        })
        .map((row: StoredRow): TModel => {
          return make(
            row,
            row.labelIds.filter((labelId: ObjectID): boolean => {
              return wanted.includes(labelId.toString());
            }),
          );
        });
    }

    const ids: Array<string> = idsNamedBy(data.query["_id"]);

    return rows
      .filter((row: StoredRow): boolean => {
        return ids.includes(row.id.toString());
      })
      .map((row: StoredRow): TModel => {
        return make(row, row.labelIds);
      });
  }) as never);

  jest.spyOn(service, "deleteBy").mockImplementation((async (data: {
    query: Dictionary<unknown>;
    props: Dictionary<unknown>;
  }): Promise<number> => {
    deletes.push({
      ids: idsNamedBy(data.query["_id"]).sort(),
      projectId: String(data.query["projectId"]),
      props: data.props,
    });
    return 1;
  }) as never);

  return deletes;
}

function teamPermission(row: StoredRow, labelIds: Array<ObjectID>): TeamPermission {
  const model: TeamPermission = new TeamPermission();
  model.id = row.id;
  model.projectId = row.projectId;
  model.teamId = row.teamId!;
  model.labels = labelsOf(labelIds);

  if (row.teamCustomRoleId) {
    model.teamCustomRoleId = row.teamCustomRoleId;
  }

  if (row.customRolePermissionId) {
    model.customRolePermissionId = row.customRolePermissionId;
  }

  return model;
}

function apiKeyPermission(
  row: StoredRow,
  labelIds: Array<ObjectID>,
): ApiKeyPermission {
  const model: ApiKeyPermission = new ApiKeyPermission();
  model.id = row.id;
  model.projectId = row.projectId;
  model.labels = labelsOf(labelIds);

  if (row.apiKeyCustomRoleId) {
    model.apiKeyCustomRoleId = row.apiKeyCustomRoleId;
  }

  return model;
}

function customRolePermission(
  row: StoredRow,
  labelIds: Array<ObjectID>,
): CustomRolePermission {
  const model: CustomRolePermission = new CustomRolePermission();
  model.id = row.id;
  model.projectId = row.projectId;
  model.labels = labelsOf(labelIds);
  return model;
}

const id: (n: number) => ObjectID = (n: number): ObjectID => {
  return new ObjectID(
    `dd000000-0000-4000-8000-${n.toString().padStart(12, "0")}`,
  );
};

// A team's own row limited to the deleted label alone, and one keeping another.
const TEAM_ROWS: Array<StoredRow> = [
  { id: id(1), projectId: PROJECT_ID, teamId: TEAM_ID, labelIds: [DELETED] },
  {
    id: id(2),
    projectId: PROJECT_ID,
    teamId: TEAM_ID,
    labelIds: [DELETED, KEPT],
  },
  {
    id: id(3),
    projectId: PROJECT_ID,
    teamId: TEAM_ID,
    labelIds: [DELETED, ALSO_DELETED],
  },
  // A copy of a role's permission: it goes with the role's own row.
  {
    id: id(4),
    projectId: PROJECT_ID,
    teamId: TEAM_ID,
    labelIds: [DELETED],
    teamCustomRoleId: id(90),
    customRolePermissionId: id(91),
  },
  {
    id: id(5),
    projectId: OTHER_PROJECT_ID,
    teamId: TEAM_ID,
    labelIds: [KEPT],
  },
];

const API_KEY_ROWS: Array<StoredRow> = [
  { id: id(11), projectId: PROJECT_ID, labelIds: [DELETED] },
  { id: id(12), projectId: PROJECT_ID, labelIds: [KEPT, DELETED] },
  {
    id: id(13),
    projectId: PROJECT_ID,
    labelIds: [DELETED],
    apiKeyCustomRoleId: id(92),
  },
];

const ROLE_ROWS: Array<StoredRow> = [
  { id: id(91), projectId: PROJECT_ID, labelIds: [DELETED] },
  { id: id(93), projectId: PROJECT_ID, labelIds: [DELETED, KEPT] },
];

let teamDeletes: Array<Dictionary<unknown>> = [];
let apiKeyDeletes: Array<Dictionary<unknown>> = [];
let roleDeletes: Array<Dictionary<unknown>> = [];

beforeEach(() => {
  teamDeletes = stubService(TeamPermissionService, TEAM_ROWS, teamPermission);
  apiKeyDeletes = stubService(
    ApiKeyPermissionService,
    API_KEY_ROWS,
    apiKeyPermission,
  );
  roleDeletes = stubService(
    CustomRolePermissionService,
    ROLE_ROWS,
    customRolePermission,
  );

  jest
    .spyOn(CustomRoleSync, "refreshMembersOfTeams")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ApiKeyPermissionService, "forgetPermissionsOfProjects")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the permissions a delete of labels leaves without any", () => {
  test("are the ones every label of which is deleted, with all their labels read", async () => {
    const rows: RowsLimitedOnlyTo =
      await PermissionRowsOfDeletedLabels.findRowsLimitedOnlyTo({
        labelIds: [DELETED, ALSO_DELETED],
      });

    expect(
      rows.teamPermissions.map((row: { id: ObjectID }): string => {
        return row.id.toString();
      }),
    ).toEqual([id(1).toString(), id(3).toString()]);
    expect(
      rows.apiKeyPermissions.map((row: { id: ObjectID }): string => {
        return row.id.toString();
      }),
    ).toEqual([id(11).toString()]);
    expect(
      rows.customRolePermissions.map((row: { id: ObjectID }): string => {
        return row.id.toString();
      }),
    ).toEqual([id(91).toString()]);
  });

  test("a label nobody's permission names leaves nothing to do", async () => {
    const rows: RowsLimitedOnlyTo =
      await PermissionRowsOfDeletedLabels.removeRowsLimitedOnlyTo({
        labelIds: [new ObjectID("cc000000-0000-4000-8000-0000000000ff")],
      });

    expect(rows).toEqual({
      teamPermissions: [],
      apiKeyPermissions: [],
      customRolePermissions: [],
    });
    expect(teamDeletes).toEqual([]);
    expect(apiKeyDeletes).toEqual([]);
    expect(roleDeletes).toEqual([]);
  });
});

describe("removing them", () => {
  test("removes each, as OneUptime, and refreshes whoever held them", async () => {
    await PermissionRowsOfDeletedLabels.removeRowsLimitedOnlyTo({
      labelIds: [DELETED, ALSO_DELETED],
    });

    // A role's permission through its service, hooks and all.
    expect(roleDeletes).toEqual([
      {
        ids: [id(91).toString()],
        projectId: PROJECT_ID.toString(),
        props: { isRoot: true },
      },
    ]);

    expect(teamDeletes).toEqual([
      {
        ids: [id(1).toString(), id(3).toString()].sort(),
        projectId: PROJECT_ID.toString(),
        props: { isRoot: true, ignoreHooks: true },
      },
    ]);

    expect(apiKeyDeletes).toEqual([
      {
        ids: [id(11).toString()],
        projectId: PROJECT_ID.toString(),
        props: { isRoot: true, ignoreHooks: true },
      },
    ]);

    expect(
      jest.mocked(CustomRoleSync.refreshMembersOfTeams).mock.calls,
    ).toEqual([[{ projectId: PROJECT_ID, teamIds: [TEAM_ID] }]]);

    expect(
      jest.mocked(ApiKeyPermissionService.forgetPermissionsOfProjects).mock
        .calls,
    ).toEqual([[[PROJECT_ID]]]);
  });
});

describe("deleting a label", () => {
  // Runs LabelService's before-delete hook for a delete of `labelIds`.
  async function runBeforeDelete(labelIds: Array<ObjectID>): Promise<void> {
    jest
      .spyOn(
        LabelService as unknown as {
          findRowsAndHoldDeleteToThem: (...args: Array<never>) => unknown;
        },
        "findRowsAndHoldDeleteToThem",
      )
      .mockResolvedValue(
        labelIds.map((labelId: ObjectID): Label => {
          const label: Label = new Label();
          label.id = labelId;
          return label;
        }) as never,
      );

    await (
      LabelService as unknown as {
        onBeforeDelete: (deleteBy: DeleteBy<Label>) => Promise<unknown>;
      }
    ).onBeforeDelete({
      query: {},
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    } as DeleteBy<Label>);
  }

  beforeEach(() => {
    // The label rules a delete re-runs are not what is asked here.
    jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleService,
        "findServiceLevelObjectiveIdsForRulesUsingLabels",
      )
      .mockResolvedValue([] as never);
    jest
      .spyOn(StatusPageMonitorRuleService, "findBy")
      .mockResolvedValue([] as never);
  });

  test("removes the permissions limited to it alone first", async () => {
    jest.spyOn(PermissionRowsOfDeletedLabels, "removeRowsLimitedOnlyTo");

    await runBeforeDelete([DELETED]);

    expect(
      PermissionRowsOfDeletedLabels.removeRowsLimitedOnlyTo,
    ).toHaveBeenCalledWith({ labelIds: [DELETED] });
    expect(teamDeletes).toHaveLength(1);
  });

  test("is refused when they cannot be removed", async () => {
    jest
      .spyOn(PermissionRowsOfDeletedLabels, "removeRowsLimitedOnlyTo")
      .mockRejectedValue(new Error("The database is away.") as never);

    await expect(runBeforeDelete([DELETED])).rejects.toThrow(
      "The database is away.",
    );
  });
});
