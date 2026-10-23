import Label from "../../../Models/DatabaseModels/Label";
import DatabaseService from "../../../Server/Services/DatabaseService";
import LabelService from "../../../Server/Services/LabelService";
import TeamService from "../../../Server/Services/TeamService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import { getColumnAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnAccessControl";
import { getTableColumn } from "../../../Types/Database/TableColumn";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getNaturalSortKey } from "../../../Utils/NaturalOrder";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A LABEL'S SORT KEY (Label.nameSortKey), through the whole write and read.
 *
 * Labels are listed in natural order everywhere (OneUptime issue #5183):
 * numbered labels first, by their numbers, then the others alphabetically.
 * The server keeps each label's sort key (Utils/NaturalOrder) so the lists
 * it pages through - Project Settings > Labels, a picker's search, Slack and
 * Teams - are in that order too. The key is OneUptime's: written from the
 * name on every create and rename, after every permission check (written
 * before them, it would be held to the caller's column permissions, and
 * nobody may write it, so every create would be refused), never by a
 * caller, never read back. And labels are read in its order whenever they
 * are asked for by name or in no order.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd45183",
);
const LABEL_ID: string = "6ba7b812-9dad-41d1-80b4-00c04fd45183";

// Who may create a label: the table's create list.
const CREATORS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  [
    "someone holding Create Label",
    [Permission.CreateProjectLabel, Permission.ReadProjectLabel],
  ],
];

// Who may rename one: the table's update list.
const EDITORS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  [
    "someone holding Edit Label",
    [Permission.EditProjectLabel, Permission.ReadProjectLabel],
  ],
];

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the write to be refused, but it went through.");
}

// The hooks, reached through a cast as every service suite does.
interface LabelHooks {
  onBeforeCreate(createBy: CreateBy<Label>): Promise<OnCreate<Label>>;
  onCreatePermitted(onCreate: OnCreate<Label>): Promise<void>;
  onUpdatePermitted(updateBy: UpdateBy<Label>): Promise<void>;
  getReadSort(sort: unknown): Record<string, SortOrder>;
}

const hooks: LabelHooks = LabelService as unknown as LabelHooks;

describe("a label's sort key, as the members who write labels", () => {
  let labels: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});

    labels = useInMemoryTable(LabelService, [
      {
        _id: LABEL_ID,
        projectId: PROJECT_ID.toString(),
        name: "3.Item=Connectivity",
        slug: "3-item-connectivity-1234567890",
        color: "#6366f1",
        isArchived: false,
        nameSortKey: getNaturalSortKey("3.Item=Connectivity"),
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stored(column: string): unknown {
    return labels.get(LABEL_ID)?.[column];
  }

  async function create(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<StoredRow> {
    const label: Label = new Label();
    label.projectId = PROJECT_ID;
    label.color = new Color("#ef4444");
    Object.assign(label, data);

    const created: Label = await LabelService.create({
      data: label,
      props: props,
    });

    const inserted: StoredRow | undefined = labels.inserts.find(
      (row: StoredRow): boolean => {
        return String(row["_id"]) === created.id?.toString();
      },
    );

    if (!inserted) {
      throw new Error("The label was not inserted.");
    }

    return inserted;
  }

  async function change(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    await LabelService.updateOneById({
      id: new ObjectID(LABEL_ID),
      data: data as never,
      props: props,
    });
  }

  test.each(CREATORS)(
    "%s creates a label, and its key is written from its name in the same insert",
    async (_who: string, permissions: Array<Permission>) => {
      const inserted: StoredRow = await create(
        { name: "4.Business System=Customer Mobile App" },
        member(permissions),
      );

      expect(inserted["name"]).toBe("4.Business System=Customer Mobile App");
      expect(inserted["nameSortKey"]).toBe(
        getNaturalSortKey("4.Business System=Customer Mobile App"),
      );
    },
  );

  test("a key a caller sends with a new label is never what is written", async () => {
    const inserted: StoredRow = await create(
      { name: "10.Owner=Platform", nameSortKey: "0000 first of all" },
      member([Permission.ProjectOwner]),
    );

    expect(inserted["nameSortKey"]).toBe(getNaturalSortKey("10.Owner=Platform"));
  });

  test("a label made by OneUptime itself (telemetry, the label rules) gets its key too", async () => {
    const inserted: StoredRow = await create(
      { name: "team:payments" },
      { isRoot: true },
    );

    expect(inserted["nameSortKey"]).toBe(getNaturalSortKey("team:payments"));
  });

  test.each(EDITORS)(
    "%s renames a label, and its key follows the new name",
    async (_who: string, permissions: Array<Permission>) => {
      await change({ name: "2.SubCategory=Website" }, member(permissions));

      expect(stored("name")).toBe("2.SubCategory=Website");
      expect(stored("nameSortKey")).toBe(
        getNaturalSortKey("2.SubCategory=Website"),
      );
    },
  );

  test("an edit that leaves the name alone leaves the key alone, and writes none", async () => {
    await change(
      { color: new Color("#10b981"), description: "Network reachability" },
      member([Permission.ProjectOwner]),
    );

    expect(stored("nameSortKey")).toBe(getNaturalSortKey("3.Item=Connectivity"));
    expect(
      labels.updates.some((update: { set: StoredRow }): boolean => {
        return "nameSortKey" in update.set;
      }),
    ).toBe(false);
  });

  test("the key is OneUptime's: a member who sends one is refused, and nothing changes", async () => {
    const error: unknown = await refusalOf(
      change(
        { name: "1.Category=Application", nameSortKey: "0" },
        member([Permission.ProjectOwner]),
      ),
    );

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect((error as ColumnWriteRefusedException).columnName).toBe(
      "nameSortKey",
    );
    expect(stored("name")).toBe("3.Item=Connectivity");
    expect(stored("nameSortKey")).toBe(getNaturalSortKey("3.Item=Connectivity"));
  });

  test("OneUptime itself renames a label the same way", async () => {
    await change({ name: "Claude" }, { isRoot: true });

    expect(stored("nameSortKey")).toBe(getNaturalSortKey("Claude"));
  });
});

describe("the hooks that write the key run after every permission check", () => {
  function createOf(name: string): CreateBy<Label> {
    const label: Label = new Label();
    label.projectId = PROJECT_ID;
    label.name = name;

    return { data: label, props: { isRoot: true } };
  }

  test("onBeforeCreate, which the caller's column permissions read after it, writes no key", async () => {
    jest
      .spyOn(LabelService, "countBy")
      .mockResolvedValue({ toNumber: (): number => 0 } as never);
    jest.spyOn(LabelService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(LabelService, "findBy").mockResolvedValue([]);

    const createBy: CreateBy<Label> = createOf("1.Category=Application");
    const onCreate: OnCreate<Label> = await hooks.onBeforeCreate(createBy);

    expect(onCreate.createBy.data.nameSortKey).toBeUndefined();

    await hooks.onCreatePermitted(onCreate);

    expect(onCreate.createBy.data.nameSortKey).toBe(
      getNaturalSortKey("1.Category=Application"),
    );

    jest.restoreAllMocks();
  });

  test("onUpdatePermitted writes the key of a new name, and nothing for an update without one", async () => {
    const rename: UpdateBy<Label> = {
      query: { _id: LABEL_ID },
      data: { name: "10.Owner=Platform" },
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<Label>;
    const recolour: UpdateBy<Label> = {
      query: { _id: LABEL_ID },
      data: { color: new Color("#000000") },
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<Label>;

    await hooks.onUpdatePermitted(rename);
    await hooks.onUpdatePermitted(recolour);

    expect(
      (rename.data as unknown as Record<string, unknown>)["nameSortKey"],
    ).toBe(getNaturalSortKey("10.Owner=Platform"));
    expect("nameSortKey" in (recolour.data as object)).toBe(false);
  });
});

describe("the column", () => {
  test("nobody writes it and nobody reads it", () => {
    const access: {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    } = getColumnAccessControlForAllColumns(new Label())["nameSortKey"] as {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    };

    expect(access).toBeDefined();
    expect(access.create).toEqual([]);
    expect(access.read).toEqual([]);
    expect(access.update).toEqual([]);
  });

  test("is computed, nullable until written, kept out of the docs, with no title a picker would show", () => {
    const column: ReturnType<typeof getTableColumn> = getTableColumn(
      new Label(),
      "nameSortKey",
    );

    expect(column.computed).toBe(true);
    expect(column.required).toBe(false);
    expect(column.hideColumnInDocumentation).toBe(true);
    expect(column.title).toBeUndefined();
  });
});

describe("the order labels are read in", () => {
  let labels: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    labels = useInMemoryTable(
      LabelService,
      ["10.Owner", "2.SubCategory", "Claude", "1.Category"].map(
        (name: string, index: number): StoredRow => {
          return {
            _id: `6ba7b81${index}-9dad-41d1-80b4-00c04fd45183`,
            projectId: PROJECT_ID.toString(),
            name: name,
            color: "#6366f1",
            isArchived: false,
            nameSortKey: getNaturalSortKey(name),
            version: 1,
          };
        },
      ),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function orderOfRead(
    sort: Record<string, SortOrder> | undefined,
    props: DatabaseCommonInteractionProps = { isRoot: true },
  ): Promise<{ order: unknown; select: Record<string, unknown> }> {
    labels.repository.find.mockClear();

    await LabelService.findBy({
      query: { projectId: PROJECT_ID },
      select: { _id: true, name: true, color: true },
      ...(sort ? { sort: sort as never } : {}),
      skip: 0,
      limit: 50,
      props: props,
    });

    const call: Array<unknown> = labels.repository.find.mock.calls[0] as Array<
      unknown
    >;
    const options: { order: unknown; select: Record<string, unknown> } =
      call[0] as { order: unknown; select: Record<string, unknown> };

    return options;
  }

  test("asked for no order: in natural order by name, not newest first", async () => {
    expect((await orderOfRead(undefined)).order).toEqual({
      nameSortKey: SortOrder.Ascending,
      name: SortOrder.Ascending,
      _id: SortOrder.Ascending,
    });
  });

  test("asked for them by name: by the key, either way", async () => {
    expect((await orderOfRead({ name: SortOrder.Ascending })).order).toEqual({
      nameSortKey: SortOrder.Ascending,
      name: SortOrder.Ascending,
      _id: SortOrder.Ascending,
    });
    expect((await orderOfRead({ name: SortOrder.Descending })).order).toEqual({
      nameSortKey: SortOrder.Descending,
      name: SortOrder.Descending,
      _id: SortOrder.Ascending,
    });
  });

  test("asked for another order: as asked", async () => {
    expect(
      (await orderOfRead({ createdAt: SortOrder.Descending })).order,
    ).toEqual({
      createdAt: SortOrder.Descending,
      _id: SortOrder.Ascending,
    });
  });

  test("a member who may read labels reads them in that order, and never reads the key", async () => {
    const options: { order: unknown; select: Record<string, unknown> } =
      await orderOfRead(
        { name: SortOrder.Ascending },
        member([Permission.ReadProjectLabel]),
      );

    // Ordered by it: selected for the query, as every sorted column is...
    expect(options.select["nameSortKey"]).toBe(true);

    // ...and taken off what comes back.
    const read: Array<Label> = await LabelService.findBy({
      query: { projectId: PROJECT_ID },
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: 50,
      props: member([Permission.ReadProjectLabel]),
    });

    expect(read).toHaveLength(4);
    for (const label of read) {
      expect(label.nameSortKey).toBeUndefined();
    }
  });

  test("a member who asks for the key itself is refused it", async () => {
    await expect(
      LabelService.findBy({
        query: { projectId: PROJECT_ID },
        select: { _id: true, nameSortKey: true },
        skip: 0,
        limit: 50,
        props: member([Permission.ProjectOwner]),
      }),
    ).rejects.toThrow("nameSortKey");
  });
});

describe("other records keep their order", () => {
  test("every other service still reads newest first when asked for no order", () => {
    const getReadSort: (sort: unknown) => unknown = (
      TeamService as unknown as { getReadSort: (sort: unknown) => unknown }
    ).getReadSort.bind(TeamService);

    expect(getReadSort(undefined)).toEqual({
      createdAt: SortOrder.Descending,
    });
    expect(getReadSort({})).toEqual({ createdAt: SortOrder.Descending });

    const asked: Record<string, SortOrder> = { name: SortOrder.Ascending };
    expect(getReadSort(asked)).toBe(asked);
  });

  test("the label service reads its order without an onBeforeFind of its own, so a list and its count are still read side by side", () => {
    expect(
      (LabelService as unknown as { onBeforeFind: unknown }).onBeforeFind,
    ).toBe(
      (DatabaseService.prototype as unknown as { onBeforeFind: unknown })
        .onBeforeFind,
    );
    expect(hooks.getReadSort(undefined)).toEqual({
      nameSortKey: SortOrder.Ascending,
      name: SortOrder.Ascending,
    });
  });
});
