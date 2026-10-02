import StatusPageHeaderLink from "../../../Models/DatabaseModels/StatusPageHeaderLink";
import NetworkSiteAssignmentRule from "../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

/*
 * DatabaseService keeps the number column of a drag-ordered list
 * (@ListOrderColumn) for every caller. These drive the real create(),
 * updateOneById() and deleteOneById() pipelines - only the database and the
 * side effects that would reach the network are stubbed - and pin:
 *
 *   - a row created without a number goes to the end of its list;
 *   - a row created or moved onto a number another row holds takes that
 *     place, and the rows in the way step aside, AFTER the row is written;
 *   - a number nobody holds is kept exactly as written (an API or Terraform
 *     caller reads back what it wrote);
 *   - an update that does not touch the list costs no extra query;
 *   - deletes leave the other numbers alone;
 *   - a failure to step the others aside is logged, never thrown, because
 *     the caller's own write has already happened;
 *   - a list that counts down (site assignment rules: highest wins) counts
 *     down here too;
 *   - none of it runs for a model that is not a drag-ordered list.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const id: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

const at: (minute: number) => Date = (minute: number): Date => {
  return new Date(Date.UTC(2026, 0, 1, 0, minute));
};

const link: (data: {
  n: number;
  order: number | null;
  statusPageId?: ObjectID;
}) => StatusPageHeaderLink = (data: {
  n: number;
  order: number | null;
  statusPageId?: ObjectID;
}): StatusPageHeaderLink => {
  const row: StatusPageHeaderLink = new StatusPageHeaderLink();
  row._id = id(data.n);
  row.order = data.order as number;
  row.statusPageId = data.statusPageId || STATUS_PAGE_ID;
  row.createdAt = at(data.n);
  return row;
};

const newLink: (order?: number) => StatusPageHeaderLink = (
  order?: number,
): StatusPageHeaderLink => {
  const row: StatusPageHeaderLink = new StatusPageHeaderLink();
  row.title = "Docs";
  row.link = URL.fromString("https://docs.example.com");
  row.statusPageId = STATUS_PAGE_ID;
  row.projectId = PROJECT_ID;

  if (order !== undefined) {
    row.order = order;
  }

  return row;
};

type Written = { id: string; data: Record<string, unknown> };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const service: any = StatusPageHeaderLinkService;

let siblings: Array<StatusPageHeaderLink>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let save: jest.Mock<(entity: any) => Promise<any>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let repositoryUpdate: jest.Mock<(...args: Array<any>) => Promise<any>>;
let findAllBy: jest.SpyInstance;
let written: Array<Written>;
let errors: Array<string>;

const stubService: (target: any) => void = (target: any): void => {
  getJestSpyOn(target, "getRepository").mockReturnValue({
    save,
    update: repositoryUpdate,
  } as never);
  getJestSpyOn(target, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(target, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(target, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );

  findAllBy = getJestSpyOn(target, "findAllBy").mockImplementation((async (
    args: { query: Record<string, unknown> },
  ): Promise<Array<unknown>> => {
    const scope: string | undefined = args.query["statusPageId"]?.toString();

    return siblings.filter((row: StatusPageHeaderLink) => {
      return !scope || row.statusPageId?.toString() === scope;
    });
  }) as never);

  getJestSpyOn(target, "updateColumnsByIdWithoutHooks").mockImplementation(
    (async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
    }): Promise<void> => {
      written.push({ id: input.id.toString(), data: input.data });
    }) as never,
  );
};

beforeEach(() => {
  jest.restoreAllMocks();

  siblings = [];
  written = [];
  errors = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  save = jest.fn(async (entity: any) => {
    entity._id = entity._id || id(999);
    return entity;
  }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  repositoryUpdate = jest.fn(async () => {
    return { affected: 1 };
  }) as any;

  stubService(service);

  jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
    errors.push(String(message));
  }) as never);

  jest
    .spyOn(ModelPermission, "checkUpdateQueryPermissions")
    .mockImplementation(((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating a row of a drag-ordered list", () => {
  test("a row created without a number goes to the end of its list", async () => {
    siblings = [
      link({ n: 1, order: 1 }),
      link({ n: 2, order: 2 }),
      link({ n: 3, order: 5 }),
    ];

    await service.create({ data: newLink(), props: { isRoot: true } });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].order).toBe(6);
    expect(written).toEqual([]);
  });

  test("the first row of a list gets 1", async () => {
    await service.create({ data: newLink(), props: { isRoot: true } });

    expect(save.mock.calls[0]![0].order).toBe(1);
  });

  test("the list read is the row's own list, as root, in the list's order", async () => {
    await service.create({ data: newLink(), props: { isRoot: true } });

    expect(findAllBy).toHaveBeenCalledTimes(1);

    const args: any = findAllBy.mock.calls[0]![0];

    expect(args.query["statusPageId"].toString()).toBe(
      STATUS_PAGE_ID.toString(),
    );
    expect(args.props).toEqual({ isRoot: true, ignoreHooks: true });
    expect(args.sort).toEqual({
      order: SortOrder.Ascending,
      createdAt: SortOrder.Ascending,
    });
    expect(args.select).toEqual({ _id: true, createdAt: true, order: true });
  });

  test("a row created with the number another row holds takes its place, and the rest step aside after it is saved", async () => {
    siblings = [
      link({ n: 1, order: 1 }),
      link({ n: 2, order: 2 }),
      link({ n: 3, order: 3 }),
    ];

    const update: jest.SpyInstance = getJestSpyOn(
      service,
      "updateColumnsByIdWithoutHooks",
    );

    await service.create({ data: newLink(2), props: { isRoot: true } });

    expect(save.mock.calls[0]![0].order).toBe(2);
    expect(written).toEqual([
      { id: id(2), data: { order: 3 } },
      { id: id(3), data: { order: 4 } },
    ]);

    // Stepping aside waits for the new row to exist.
    expect(save.mock.invocationCallOrder[0]!).toBeLessThan(
      update.mock.invocationCallOrder[0]!,
    );
  });

  test("a number no other row holds is kept as written and nothing else moves", async () => {
    siblings = [link({ n: 1, order: 10 }), link({ n: 2, order: 20 })];

    await service.create({ data: newLink(15), props: { isRoot: true } });

    expect(save.mock.calls[0]![0].order).toBe(15);
    expect(written).toEqual([]);
  });

  test("a number sent as a string, the way a number input sends it, counts as that number", async () => {
    siblings = [link({ n: 1, order: 1 }), link({ n: 2, order: 2 })];

    const data: StatusPageHeaderLink = newLink();
    (data as any).order = "1";

    await service.create({ data: data, props: { isRoot: true } });

    expect(written).toEqual([
      { id: id(1), data: { order: 2 } },
      { id: id(2), data: { order: 3 } },
    ]);
  });

  test("the create still succeeds when the rows in the way cannot be moved, and says so in the log", async () => {
    siblings = [link({ n: 1, order: 1 })];

    getJestSpyOn(service, "updateColumnsByIdWithoutHooks").mockRejectedValue(
      new Error("connection reset") as never,
    );

    await expect(
      service.create({ data: newLink(1), props: { isRoot: true } }),
    ).resolves.toBeDefined();

    expect(save).toHaveBeenCalledTimes(1);
    expect(errors.join("\n")).toContain("connection reset");
  });

  test("a failure to read the list fails the create before anything is saved", async () => {
    findAllBy.mockRejectedValue(new Error("database is down") as never);

    await expect(
      service.create({ data: newLink(), props: { isRoot: true } }),
    ).rejects.toThrow("database is down");

    expect(save).not.toHaveBeenCalled();
  });
});

describe("moving a row of a drag-ordered list", () => {
  /*
   * The row as _updateBy reads it before the write, and the list as it reads
   * after it.
   */
  const stubRowBeforeUpdate: (row: StatusPageHeaderLink) => void = (
    row: StatusPageHeaderLink,
  ): void => {
    getJestSpyOn(service, "_findBy").mockResolvedValue([row] as never);
  };

  test("dropping a row on the first row moves it to the top and the rows in between step down", async () => {
    siblings = [
      link({ n: 1, order: 1 }),
      link({ n: 2, order: 2 }),
      link({ n: 3, order: 3 }),
      link({ n: 4, order: 1 }), // the moved row, already written
    ];
    stubRowBeforeUpdate(link({ n: 4, order: 4 }));

    await service.updateOneById({
      id: new ObjectID(id(4)),
      data: { order: 1 },
      props: { isRoot: true },
    });

    // The row's own write carries the number it was given.
    expect(repositoryUpdate).toHaveBeenCalledTimes(1);
    expect(repositoryUpdate.mock.calls[0]![1]).toMatchObject({ order: 1 });

    expect(written).toEqual([
      { id: id(1), data: { order: 2 } },
      { id: id(2), data: { order: 3 } },
      { id: id(3), data: { order: 4 } },
    ]);
  });

  test("dropping a row further down moves the rows in between up", async () => {
    siblings = [
      link({ n: 1, order: 3 }), // the moved row, already written
      link({ n: 2, order: 2 }),
      link({ n: 3, order: 3 }),
      link({ n: 4, order: 4 }),
    ];
    stubRowBeforeUpdate(link({ n: 1, order: 1 }));

    await service.updateOneById({
      id: new ObjectID(id(1)),
      data: { order: 3 },
      props: { isRoot: true },
    });

    expect(written).toEqual([
      { id: id(3), data: { order: 2 } },
      { id: id(2), data: { order: 1 } },
    ]);
  });

  test("the pre-update read selects what moving the row needs", async () => {
    siblings = [link({ n: 1, order: 2 })];
    const findBy: jest.SpyInstance = getJestSpyOn(
      service,
      "_findBy",
    ).mockResolvedValue([link({ n: 1, order: 1 })] as never);

    await service.updateOneById({
      id: new ObjectID(id(1)),
      data: { order: 2 },
      props: { isRoot: true },
    });

    const select: Record<string, unknown> = (findBy.mock.calls[0]![0] as any)
      .select;

    expect(select).toMatchObject({
      _id: true,
      order: true,
      statusPageId: true,
    });
  });

  test("saving a row with the number it already has moves nothing and reads no list", async () => {
    siblings = [link({ n: 1, order: 1 }), link({ n: 2, order: 2 })];
    stubRowBeforeUpdate(link({ n: 2, order: 2 }));

    await service.updateOneById({
      id: new ObjectID(id(2)),
      data: { order: 2 },
      props: { isRoot: true },
    });

    expect(findAllBy).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });

  test("an edit that does not touch the order costs no extra query", async () => {
    const findBy: jest.SpyInstance = getJestSpyOn(
      service,
      "_findBy",
    ).mockResolvedValue([link({ n: 1, order: 1 })] as never);

    await service.updateOneById({
      id: new ObjectID(id(1)),
      data: { title: "Status" },
      props: { isRoot: true },
    });

    expect(findAllBy).not.toHaveBeenCalled();
    expect(written).toEqual([]);

    const select: Record<string, unknown> = (findBy.mock.calls[0]![0] as any)
      .select;
    expect(select["statusPageId"]).toBeUndefined();
  });

  test("clearing a row's number sends it to the end of its list", async () => {
    siblings = [
      link({ n: 1, order: null }), // the cleared row, already written
      link({ n: 2, order: 2 }),
      link({ n: 3, order: 7 }),
    ];
    stubRowBeforeUpdate(link({ n: 1, order: 1 }));

    await service.updateOneById({
      id: new ObjectID(id(1)),
      data: { order: null },
      props: { isRoot: true },
    });

    expect(written).toEqual([{ id: id(1), data: { order: 8 } }]);
  });

  test("a row moved to another list without a number goes to the end of that list", async () => {
    siblings = [
      link({ n: 1, order: 1 }), // moved, now on the other page
      link({ n: 5, order: 1, statusPageId: OTHER_STATUS_PAGE_ID }),
      link({ n: 6, order: 4, statusPageId: OTHER_STATUS_PAGE_ID }),
    ];
    siblings[0]!.statusPageId = OTHER_STATUS_PAGE_ID;
    stubRowBeforeUpdate(link({ n: 1, order: 1 }));

    await service.updateOneById({
      id: new ObjectID(id(1)),
      data: { statusPageId: OTHER_STATUS_PAGE_ID },
      props: { isRoot: true },
    });

    expect(written).toEqual([{ id: id(1), data: { order: 5 } }]);
    expect(
      (findAllBy.mock.calls[0]![0] as any).query["statusPageId"].toString(),
    ).toBe(OTHER_STATUS_PAGE_ID.toString());
  });

  test("the update still succeeds when the rows in the way cannot be moved, and says so in the log", async () => {
    siblings = [link({ n: 1, order: 1 }), link({ n: 2, order: 1 })];
    stubRowBeforeUpdate(link({ n: 2, order: 2 }));
    getJestSpyOn(service, "updateColumnsByIdWithoutHooks").mockRejectedValue(
      new Error("lock timeout") as never,
    );

    await expect(
      service.updateOneById({
        id: new ObjectID(id(2)),
        data: { order: 1 },
        props: { isRoot: true },
      }),
    ).resolves.toBeDefined();

    expect(errors.join("\n")).toContain("lock timeout");
  });

  test("the rows in the way step aside before the service's own update hook runs", async () => {
    siblings = [link({ n: 1, order: 1 }), link({ n: 2, order: 1 })];
    stubRowBeforeUpdate(link({ n: 2, order: 2 }));

    const update: jest.SpyInstance = getJestSpyOn(
      service,
      "updateColumnsByIdWithoutHooks",
    );
    const hook: jest.SpyInstance = getJestSpyOn(service, "onUpdateSuccess");

    await service.updateOneById({
      id: new ObjectID(id(2)),
      data: { order: 1 },
      props: { isRoot: true },
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(update.mock.invocationCallOrder[0]!).toBeLessThan(
      hook.mock.invocationCallOrder[0]!,
    );
  });
});

describe("deleting a row of a drag-ordered list", () => {
  test("leaves the other rows' numbers alone", async () => {
    jest
      .spyOn(ModelPermission, "checkDeletePermissionByModel")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation(((_modelType: unknown, query: unknown) => {
        return Promise.resolve(query);
      }) as never);
    getJestSpyOn(service, "_findBy").mockResolvedValue([
      link({ n: 2, order: 2 }),
    ] as never);
    getJestSpyOn(service, "getRepository").mockReturnValue({
      delete: jest.fn(async () => {
        return { affected: 1 };
      }),
    } as never);

    await service.deleteOneById({
      id: new ObjectID(id(2)),
      props: { isRoot: true },
    });

    expect(findAllBy).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });
});

describe("a list that counts down (site assignment rules: the highest number wins)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ruleService: any = NetworkSiteAssignmentRuleService;

  const rule: (n: number, priority: number) => NetworkSiteAssignmentRule = (
    n: number,
    priority: number,
  ): NetworkSiteAssignmentRule => {
    const row: NetworkSiteAssignmentRule = new NetworkSiteAssignmentRule();
    row._id = id(n);
    row.priority = priority;
    row.projectId = PROJECT_ID;
    row.createdAt = at(n);
    return row;
  };

  let rules: Array<NetworkSiteAssignmentRule>;

  beforeEach(() => {
    rules = [rule(1, 3), rule(2, 2), rule(3, 1)];

    getJestSpyOn(ruleService, "findAllBy").mockImplementation((async () => {
      return rules;
    }) as never);
    getJestSpyOn(ruleService, "updateColumnsByIdWithoutHooks").mockImplementation(
      (async (input: {
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<void> => {
        written.push({ id: input.id.toString(), data: input.data });
      }) as never,
    );
  });

  test("is a list ordered within its project, highest number first", () => {
    expect(new NetworkSiteAssignmentRule().getListOrder()).toEqual({
      column: "priority",
      scopeColumns: ["projectId"],
      sortOrder: SortOrder.Descending,
    });
  });

  test("renumbering reads every rule with its priority and project", async () => {
    await ruleService.normalizeListOrders();

    const args: any = (ruleService.findAllBy as jest.Mock).mock.calls[0]![0];
    expect(args.select).toMatchObject({ priority: true, projectId: true });
  });

  test("a rule given the top rule's number becomes the top, and the rules in the way step down", async () => {
    getJestSpyOn(ruleService, "_findBy").mockResolvedValue([
      rule(3, 1),
    ] as never);
    getJestSpyOn(ruleService, "getRepository").mockReturnValue({
      update: jest.fn(async () => {
        return { affected: 1 };
      }),
    } as never);
    rules = [rule(1, 3), rule(2, 2), rule(3, 3)];

    await ruleService.updateOneById({
      id: new ObjectID(id(3)),
      data: { priority: 3 },
      props: { isRoot: true },
    });

    expect(written).toEqual([
      { id: id(1), data: { priority: 2 } },
      { id: id(2), data: { priority: 1 } },
    ]);

    // The list it stepped through was read highest priority first.
    const args: any = (ruleService.findAllBy as jest.Mock).mock.calls[0]![0];
    expect(args.sort).toEqual({
      priority: SortOrder.Descending,
      createdAt: SortOrder.Ascending,
    });
  });

  test("a rule created without a priority goes to the bottom, below the lowest", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ruleSave: jest.Mock<(entity: any) => Promise<any>> = jest.fn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (entity: any) => {
        return entity;
      },
    ) as any;
    stubService(ruleService);
    getJestSpyOn(ruleService, "getRepository").mockReturnValue({
      save: ruleSave,
    } as never);
    getJestSpyOn(ruleService, "findAllBy").mockImplementation((async () => {
      return rules;
    }) as never);
    getJestSpyOn(ruleService, "onBeforeCreate").mockImplementation(((
      createBy: unknown,
    ) => {
      return Promise.resolve({ createBy: createBy, carryForward: null });
    }) as never);

    const data: NetworkSiteAssignmentRule = new NetworkSiteAssignmentRule();
    data.projectId = PROJECT_ID;
    data.siteId = new ObjectID(id(77));
    data.subnetCidr = "10.0.0.0/8";

    await ruleService.create({ data: data, props: { isRoot: true } });

    expect(ruleSave.mock.calls[0]![0].priority).toBe(0);
  });
});

describe("normalizeListOrders: the data migration's renumbering", () => {
  test("renumbers only the lists with rows sharing a number or without one, in the order they are shown", async () => {
    siblings = [
      // Status page A: every link saved as 1, the older first.
      link({ n: 1, order: 1 }),
      link({ n: 2, order: 1 }),
      link({ n: 3, order: null }),
      // Status page B: unique numbers with gaps - left as they are.
      link({ n: 4, order: 10, statusPageId: OTHER_STATUS_PAGE_ID }),
      link({ n: 5, order: 30, statusPageId: OTHER_STATUS_PAGE_ID }),
    ];

    const result: { lists: number; rowsChanged: number } =
      await service.normalizeListOrders();

    expect(written).toEqual([
      { id: id(2), data: { order: 2 } },
      { id: id(3), data: { order: 3 } },
    ]);
    expect(result).toEqual({ lists: 1, rowsChanged: 2 });
  });

  test("reads every row of the table, as root, with the list columns", async () => {
    await service.normalizeListOrders();

    const args: any = findAllBy.mock.calls[0]![0];

    expect(args.query).toEqual({});
    expect(args.props).toEqual({ isRoot: true, ignoreHooks: true });
    expect(args.select).toEqual({
      _id: true,
      createdAt: true,
      order: true,
      statusPageId: true,
    });
  });

  test("a second run finds nothing to do", async () => {
    siblings = [link({ n: 1, order: 1 }), link({ n: 2, order: 1 })];

    await service.normalizeListOrders();

    for (const change of written) {
      siblings.find((row: StatusPageHeaderLink) => {
        return row._id === change.id;
      })!.order = change.data["order"] as number;
    }
    written = [];

    expect(await service.normalizeListOrders()).toEqual({
      lists: 0,
      rowsChanged: 0,
    });
    expect(written).toEqual([]);
  });
});

describe("a model that is not a drag-ordered list", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scanService: any = NetworkDeviceDiscoveryScanService;

  test("has no list order", () => {
    expect(new NetworkDeviceDiscoveryScan().getListOrder()).toBeNull();
  });

  test("normalizeListOrders does nothing and reads nothing", async () => {
    const scanFindAllBy: jest.SpyInstance = getJestSpyOn(
      scanService,
      "findAllBy",
    );

    expect(await scanService.normalizeListOrders()).toEqual({
      lists: 0,
      rowsChanged: 0,
    });
    expect(scanFindAllBy).not.toHaveBeenCalled();
  });
});
