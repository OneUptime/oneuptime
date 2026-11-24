import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SharedNameKind } from "../../../Types/Database/SharedNames";
import type { SpyInstance } from "jest-mock";
import StatusPageSetupApi, {
  OWN_STATUS_PAGES_READ_LIMIT,
  PROJECT_STATUS_PAGES_READ_LIMIT,
  StatusPageSetupRecord,
  getStatusPageEditReach,
  mayCreateStatusPage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetupApi";
import {
  NO_STATUS_PAGE_EDIT_REACH,
  StatusPageEditReach,
  StatusPageSetupMonitor,
  StatusPageSetupPage,
  mayEditStatusPage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetup";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageOwnerTeam from "../../../Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "../../../Models/DatabaseModels/StatusPageOwnerUser";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color from "../../../Types/Color";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

/*
 * What the status page guided setup asks the model API for (issue #6806):
 * the creates Create Status Page and Add Multiple Monitors send, so the
 * server's permissions, plan limits and defaults apply to it as they do
 * to them - and a page that shows nothing is never reported as done.
 */

const id: (n: number) => ObjectID = (n: number): ObjectID => {
  return new ObjectID(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
};

const PROJECT_ID: ObjectID = id(6806);

const model: <T>(type: { new (): T }, values: Record<string, unknown>) => T = <
  T,
>(
  type: { new (): T },
  values: Record<string, unknown>,
): T => {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
};

const list: <T>(data: Array<T>) => {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
} = <T>(
  data: Array<T>,
): { data: Array<T>; count: number; skip: number; limit: number } => {
  return { data, count: data.length, skip: 0, limit: data.length };
};

type LooseSpy = SpyInstance<(...args: Array<never>) => Promise<unknown>>;

let getListSpy: LooseSpy;
let createSpy: LooseSpy;
let getItemSpy: LooseSpy;

const createdModels: () => Array<unknown> = (): Array<unknown> => {
  return createSpy.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { model: unknown }).model;
  });
};

beforeEach(() => {
  getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as LooseSpy;
  createSpy = jest.spyOn(ModelAPI, "create") as unknown as LooseSpy;
  getItemSpy = jest.spyOn(ModelAPI, "getItem") as unknown as LooseSpy;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getListSpy.mockResolvedValue(list([]) as never);
  createSpy.mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may run it", () => {
  const allow: (models: Array<unknown>) => void = (
    models: Array<unknown>,
  ): void => {
    jest
      .spyOn(PermissionGate, "check")
      .mockImplementation((record: unknown): PermissionGateResult => {
        return {
          isAllowed: models.some((type: unknown) => {
            return record instanceof (type as { new (): unknown });
          }),
        } as PermissionGateResult;
      });
  };

  test("someone who may create a status page and put monitors on it", () => {
    allow([StatusPage, StatusPageResource]);
    expect(mayCreateStatusPage()).toBe(true);
  });

  test("not someone who may create the page but not put monitors on it: it would stay empty", () => {
    allow([StatusPage]);
    expect(mayCreateStatusPage()).toBe(false);
  });

  test("not someone who may not create a status page", () => {
    allow([StatusPageResource]);
    expect(mayCreateStatusPage()).toBe(false);
  });
});

describe("the monitors listed", () => {
  test("are the project's, by name, with their current status", async () => {
    getListSpy.mockResolvedValue(
      list([
        model(Monitor, {
          _id: id(1).toString(),
          name: "API",
          currentMonitorStatus: model(MonitorStatus, {
            name: "Operational",
            color: new Color("#00ff00"),
          }),
        }),
        model(Monitor, { _id: id(2).toString(), name: "Website" }),
        model(Monitor, { name: "no id" }),
      ]) as never,
    );

    expect(await StatusPageSetupApi.loadMonitors()).toEqual([
      {
        id: id(1).toString(),
        name: "API",
        statusName: "Operational",
        statusColor: "#00ff00",
      },
      {
        id: id(2).toString(),
        name: "Website",
        statusName: undefined,
        statusColor: undefined,
      },
    ]);

    const args: Record<string, unknown> = getListSpy.mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    expect(args["modelType"]).toBe(Monitor);
    expect(args["query"]).toEqual({ projectId: PROJECT_ID });
    expect(args["sort"]).toEqual({ name: "ASC" });
  });
});

describe("the page", () => {
  test("is made as Create Status Page makes it: the name, trimmed, in this project", async () => {
    createSpy.mockResolvedValue({
      data: model(StatusPage, { _id: id(50).toString() }),
    } as never);

    expect(await StatusPageSetupApi.createStatusPage("  Acme Status ")).toBe(
      id(50).toString(),
    );

    const page: StatusPage = createdModels()[0] as StatusPage;
    expect(page).toBeInstanceOf(StatusPage);
    expect(page.name).toBe("Acme Status");
    expect(page.projectId?.toString()).toBe(PROJECT_ID.toString());
    // Public or not is the server's default: on Cloud private needs Growth.
    expect(page.isPublicStatusPage).toBeUndefined();
  });

  test("a create that returns no page throws, rather than a run with no page", async () => {
    createSpy.mockResolvedValue({ data: undefined } as never);

    await expect(StatusPageSetupApi.createStatusPage("Acme")).rejects.toThrow(
      /can't be shown/,
    );
  });

  test("the run's page is read back, and a page that is gone reads as null", async () => {
    getItemSpy.mockResolvedValue(
      model(StatusPage, { _id: id(50).toString(), name: "Acme" }) as never,
    );
    expect(await StatusPageSetupApi.loadStatusPage(id(50).toString())).toEqual({
      id: id(50).toString(),
      name: "Acme",
    });

    getItemSpy.mockResolvedValue(null as never);
    expect(
      await StatusPageSetupApi.loadStatusPage(id(50).toString()),
    ).toBeNull();
  });

  /*
   * #7467: the preview names the page as its visitors read it - its Page
   * Title, else its name - so the run's page is read with its Page Title.
   */
  test("the run's page is read with its Page Title, the name its visitors read", async () => {
    getItemSpy.mockResolvedValue(
      model(StatusPage, {
        _id: id(50).toString(),
        name: "acme-prod",
        pageTitle: "  Acme Status  ",
      }) as never,
    );

    const page: StatusPageSetupRecord | null =
      await StatusPageSetupApi.loadStatusPage(id(50).toString());

    expect(page).toEqual({
      id: id(50).toString(),
      name: "acme-prod",
      pageTitle: "Acme Status",
    });
    expect(
      (getItemSpy.mock.calls[0]![0] as unknown as Record<string, unknown>)[
        "select"
      ],
    ).toEqual({ _id: true, name: true, pageTitle: true });

    // A blank Page Title is none: the page goes by its name.
    getItemSpy.mockResolvedValue(
      model(StatusPage, {
        _id: id(51).toString(),
        name: "Acme",
        pageTitle: "   ",
      }) as never,
    );

    const untitled: StatusPageSetupRecord | null =
      await StatusPageSetupApi.loadStatusPage(id(51).toString());

    expect(untitled?.pageTitle).toBeUndefined();
    expect(untitled?.name).toBe("Acme");
  });

  test("what it shows is its resources' names, in the page's order, with the server's count", async () => {
    getListSpy.mockResolvedValue({
      data: [
        model(StatusPageResource, { displayName: "API" }),
        model(StatusPageResource, { displayName: "" }),
        model(StatusPageResource, { displayName: "Website" }),
      ],
      count: 7,
      skip: 0,
      limit: 3,
    } as never);

    expect(
      await StatusPageSetupApi.loadShownMonitors(id(50).toString()),
    ).toEqual({
      count: 7,
      names: ["API", "Website"],
      monitorIds: [],
      monitorGroupIds: [],
    });

    const args: Record<string, unknown> = getListSpy.mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    expect(args["modelType"]).toBe(StatusPageResource);
    expect(args["sort"]).toEqual({ order: "ASC" });
  });
});

/*
 * THIS PERSON'S OWN PAGE WITH A NAME (#7252): what step 1 looks for before
 * it makes a page, so a run the browser lost - or a second tab - typing
 * the same name goes on with the page it made instead of making another.
 */
describe("this person's own status page with a name", () => {
  const USER: ObjectID = id(7252);

  const page: (
    n: number,
    name: string,
    extra?: Record<string, unknown>,
  ) => StatusPage = (
    n: number,
    name: string,
    extra?: Record<string, unknown>,
  ): StatusPage => {
    return model(StatusPage, { _id: id(n).toString(), name, ...extra });
  };

  test("reads the newest pages this person made in the project, with their names and whether they are archived", async () => {
    await StatusPageSetupApi.findOwnStatusPage({
      name: "Acme Status",
      userId: USER.toString(),
    });

    expect(getListSpy).toHaveBeenCalledTimes(1);
    const args: Record<string, unknown> = getListSpy.mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    expect(args["modelType"]).toBe(StatusPage);
    expect(args["query"]).toEqual({
      projectId: PROJECT_ID,
      createdByUserId: USER,
    });
    expect(args["select"]).toEqual({
      _id: true,
      name: true,
      pageTitle: true,
      isArchived: true,
    });
    expect(args["sort"]).toEqual({ createdAt: "DESC" });
    expect(args["limit"]).toBe(OWN_STATUS_PAGES_READ_LIMIT);
    expect(OWN_STATUS_PAGES_READ_LIMIT).toBe(100);
    expect(args["skip"]).toBe(0);
  });

  test("the newest page with the name typed, trimmed and in any case, is the one found, with the name it has", async () => {
    getListSpy.mockResolvedValue(
      list([
        page(3, "Acme Internal Status"),
        page(2, "ACME status"),
        page(1, "Acme Status"),
      ]) as never,
    );

    expect(
      await StatusPageSetupApi.findOwnStatusPage({
        name: "  acme   Status ",
        userId: USER.toString(),
      }),
    ).toEqual({ id: id(2).toString(), name: "ACME status" });
  });

  test("an archived page is offline: it is passed by, and an older one with the name is found", async () => {
    getListSpy.mockResolvedValue(
      list([
        page(2, "Acme Status", { isArchived: true }),
        page(1, "Acme Status", { isArchived: false }),
      ]) as never,
    );

    expect(
      await StatusPageSetupApi.findOwnStatusPage({
        name: "Acme Status",
        userId: USER.toString(),
      }),
    ).toEqual({ id: id(1).toString(), name: "Acme Status" });

    getListSpy.mockResolvedValue(
      list([page(2, "Acme Status", { isArchived: true })]) as never,
    );

    expect(
      await StatusPageSetupApi.findOwnStatusPage({
        name: "Acme Status",
        userId: USER.toString(),
      }),
    ).toBeNull();
  });

  test("no page with the name, or one with no id, is none", async () => {
    getListSpy.mockResolvedValue(
      list([
        page(2, "Acme Status Page"),
        model(StatusPage, { name: "Acme Status" }),
      ]) as never,
    );

    expect(
      await StatusPageSetupApi.findOwnStatusPage({
        name: "Acme Status",
        userId: USER.toString(),
      }),
    ).toBeNull();
  });

  test("with nobody signed in, or no name, nothing is read and none is found", async () => {
    expect(
      await StatusPageSetupApi.findOwnStatusPage({
        name: "Acme Status",
        userId: "",
      }),
    ).toBeNull();
    expect(
      await StatusPageSetupApi.findOwnStatusPage({
        name: "   ",
        userId: USER.toString(),
      }),
    ).toBeNull();
    expect(getListSpy).not.toHaveBeenCalled();
  });

  test("a read that fails throws: nothing is made on a guess", async () => {
    getListSpy.mockRejectedValue(new Error("Server unavailable") as never);

    await expect(
      StatusPageSetupApi.findOwnStatusPage({
        name: "Acme Status",
        userId: USER.toString(),
      }),
    ).rejects.toThrow("Server unavailable");
  });
});

describe("putting the monitors on it", () => {
  test("adds each one as Add Multiple Monitors does: named after it, with its status, uptime and history", async () => {
    await StatusPageSetupApi.addMonitors({
      statusPageId: id(50).toString(),
      monitors: [
        { id: id(1).toString(), name: "API" },
        { id: id(2).toString(), name: "Website" },
      ],
    });

    const resources: Array<StatusPageResource> =
      createdModels() as Array<StatusPageResource>;
    expect(resources).toHaveLength(2);
    expect(
      resources.map((resource: StatusPageResource) => {
        return [
          resource.displayName,
          resource.monitorId?.toString(),
          resource.statusPageId?.toString(),
          resource.projectId?.toString(),
          resource.showCurrentStatus,
          resource.showUptimePercent,
          resource.showStatusHistoryChart,
        ];
      }),
    ).toEqual([
      [
        "API",
        id(1).toString(),
        id(50).toString(),
        PROJECT_ID.toString(),
        true,
        true,
        true,
      ],
      [
        "Website",
        id(2).toString(),
        id(50).toString(),
        PROJECT_ID.toString(),
        true,
        true,
        true,
      ],
    ]);
  });

  test("a monitor the page shows already is left as it is, not added twice", async () => {
    getListSpy.mockResolvedValue(
      list([model(StatusPageResource, { monitorId: id(1) })]) as never,
    );

    const result: Awaited<ReturnType<typeof StatusPageSetupApi.addMonitors>> =
      await StatusPageSetupApi.addMonitors({
        statusPageId: id(50).toString(),
        monitors: [
          { id: id(1).toString(), name: "API" },
          { id: id(2).toString(), name: "Website" },
        ],
      });

    expect(result.skipped).toHaveLength(1);
    expect(createdModels()).toHaveLength(1);
    expect((createdModels()[0] as StatusPageResource).displayName).toBe(
      "Website",
    );
  });

  test("when none could be added, it throws the server's reason: the step is not done on an empty page", async () => {
    createSpy.mockRejectedValue(new Error("Plan limit reached") as never);

    await expect(
      StatusPageSetupApi.addMonitors({
        statusPageId: id(50).toString(),
        monitors: [{ id: id(1).toString(), name: "API" }],
      }),
    ).rejects.toThrow("Plan limit reached");
  });

  test("some added and some refused is not an error: the page shows something", async () => {
    createSpy
      .mockResolvedValueOnce({ data: {} } as never)
      .mockRejectedValueOnce(new Error("refused") as never);

    const result: Awaited<ReturnType<typeof StatusPageSetupApi.addMonitors>> =
      await StatusPageSetupApi.addMonitors({
        statusPageId: id(50).toString(),
        monitors: [
          { id: id(1).toString(), name: "API" },
          { id: id(2).toString(), name: "Website" },
        ],
      });

    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });
});

describe("the monitors' labels and the monitor groups (#7147)", () => {
  test("each monitor comes with the labels it carries, for the list to be narrowed by", async () => {
    getListSpy.mockResolvedValue(
      list([
        model(Monitor, {
          _id: id(1).toString(),
          name: "API",
          labels: [
            model(Label, {
              _id: id(91).toString(),
              name: "production",
              color: new Color("#ef4444"),
            }),
            model(Label, { name: "no id" }),
          ],
        }),
        model(Monitor, { _id: id(2).toString(), name: "Website", labels: [] }),
      ]) as never,
    );

    const monitors: Array<StatusPageSetupMonitor> =
      await StatusPageSetupApi.loadMonitors();

    expect(monitors[0]!.labels).toEqual([
      {
        id: id(91).toString(),
        name: "production",
        color: "#ef4444",
        sharedName: { kind: SharedNameKind.Label },
      },
    ]);
    // None carried: none listed.
    expect(monitors[1]!.labels).toBeUndefined();

    const args: Record<string, unknown> = getListSpy.mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    expect(args["select"]).toMatchObject({
      labels: { _id: true, name: true, color: true, createdAt: true },
    });
  });

  /*
   * Two labels of one name, named alike before names were held to one label
   * each, are told apart in the step's label filter (#10314): read through
   * each monitor's labels, which take no description, each says when it was
   * made, which the Dropdown marks the twins by.
   */
  test("each label says when it was made, which tells two of one name apart", async () => {
    const MARCH: Date = new Date("2024-03-05T09:30:00.000Z");
    const NOVEMBER: Date = new Date("2026-11-05T09:30:00.000Z");

    getListSpy.mockResolvedValue(
      list([
        model(Monitor, {
          _id: id(1).toString(),
          name: "API",
          labels: [
            model(Label, {
              _id: id(91).toString(),
              name: "production",
              createdAt: MARCH,
            }),
            model(Label, {
              _id: id(92).toString(),
              name: "Production",
              createdAt: NOVEMBER,
            }),
          ],
        }),
      ]) as never,
    );

    const monitors: Array<StatusPageSetupMonitor> =
      await StatusPageSetupApi.loadMonitors();

    expect(monitors[0]!.labels).toEqual([
      {
        id: id(91).toString(),
        name: "production",
        sharedName: { kind: SharedNameKind.Label, createdAt: MARCH },
      },
      {
        id: id(92).toString(),
        name: "Production",
        sharedName: { kind: SharedNameKind.Label, createdAt: NOVEMBER },
      },
    ]);
  });

  test("the project's monitor groups, by name, with their labels", async () => {
    getListSpy.mockResolvedValue(
      list([
        model(MonitorGroup, {
          _id: id(5).toString(),
          name: "Checkout",
          labels: [
            model(Label, { _id: id(91).toString(), name: "production" }),
          ],
        }),
        model(MonitorGroup, { name: "no id" }),
      ]) as never,
    );

    expect(await StatusPageSetupApi.loadMonitorGroups()).toEqual([
      {
        id: id(5).toString(),
        name: "Checkout",
        labels: [
          {
            id: id(91).toString(),
            name: "production",
            sharedName: { kind: SharedNameKind.Label },
          },
        ],
      },
    ]);

    const args: Record<string, unknown> = getListSpy.mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    expect(args["modelType"]).toBe(MonitorGroup);
    expect(args["query"]).toEqual({ projectId: PROJECT_ID });
    expect(args["select"]).toEqual({
      _id: true,
      name: true,
      labels: { _id: true, name: true, color: true, createdAt: true },
    });
    expect(args["sort"]).toEqual({ name: "ASC" });
  });

  test("a group is put on the page as Add Multiple Monitor Groups puts one, before the monitors, and one it shows already is skipped", async () => {
    getListSpy.mockResolvedValue(
      list([model(StatusPageResource, { monitorGroupId: id(6) })]) as never,
    );

    await StatusPageSetupApi.addMonitors({
      statusPageId: id(50).toString(),
      monitors: [{ id: id(1).toString(), name: "API" }],
      monitorGroups: [
        { id: id(5).toString(), name: "Checkout" },
        { id: id(6).toString(), name: "Search" },
      ],
    });

    const resources: Array<StatusPageResource> =
      createdModels() as Array<StatusPageResource>;
    expect(
      resources.map((resource: StatusPageResource) => {
        return [
          resource.displayName,
          resource.monitorGroupId?.toString(),
          resource.monitorId?.toString(),
          resource.showCurrentStatus,
        ];
      }),
    ).toEqual([
      ["Checkout", id(5).toString(), undefined, true],
      ["API", undefined, id(1).toString(), true],
    ]);
    // What the page lists is read once, groups and monitors alike.
    expect(getListSpy).toHaveBeenCalledTimes(1);
    expect(
      (getListSpy.mock.calls[0]![0] as unknown as Record<string, unknown>)[
        "select"
      ],
    ).toEqual({ _id: true, monitorId: true, monitorGroupId: true });
  });

  test("groups alone are something to show: no monitor is asked for", async () => {
    await StatusPageSetupApi.addMonitors({
      statusPageId: id(50).toString(),
      monitors: [],
      monitorGroups: [{ id: id(5).toString(), name: "Checkout" }],
    });

    expect(createdModels()).toHaveLength(1);
    expect(
      (createdModels()[0] as StatusPageResource).monitorGroupId?.toString(),
    ).toBe(id(5).toString());
  });

  test("a group refused, and no monitor: the server's reason, not an empty page", async () => {
    createSpy.mockRejectedValue(new Error("Plan limit reached") as never);

    await expect(
      StatusPageSetupApi.addMonitors({
        statusPageId: id(50).toString(),
        monitors: [],
        monitorGroups: [{ id: id(5).toString(), name: "Checkout" }],
      }),
    ).rejects.toThrow("Plan limit reached");
  });

  test("what a page shows says which monitors and groups they are", async () => {
    getListSpy.mockResolvedValue(
      list([
        model(StatusPageResource, { displayName: "API", monitorId: id(1) }),
        model(StatusPageResource, {
          displayName: "Checkout",
          monitorGroupId: id(5),
        }),
      ]) as never,
    );

    expect(
      await StatusPageSetupApi.loadShownMonitors(id(50).toString()),
    ).toEqual({
      count: 2,
      names: ["API", "Checkout"],
      monitorIds: [id(1).toString()],
      monitorGroupIds: [id(5).toString()],
    });
  });
});

/*
 * THE PROJECT'S PAGES THIS PERSON MAY CHANGE (#7517): what step 1 offers
 * before it makes a page. Read as the server weighs a change of a status
 * page: a grant with no labels reaches every page, one limited to labels
 * the pages carrying one, one limited to owned records the pages the
 * person or the row's team owns, and a block with labels takes away the
 * pages carrying one. Who may only read pages is offered none.
 */
describe("the project's status pages this person may change (#7517)", () => {
  const USER: ObjectID = id(7517);
  const TEAM: ObjectID = id(7600);
  const OTHER_TEAM: ObjectID = id(7601);
  const PUBLIC: string = id(9001).toString();
  const INTERNAL: string = id(9002).toString();

  // A permission row of the person's, as the snapshot carries it.
  const row: (
    permission: Permission,
    extra?: Partial<UserPermission>,
  ) => UserPermission = (
    permission: Permission,
    extra?: Partial<UserPermission>,
  ): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
      ...extra,
    } as UserPermission;
  };

  const holding: (rows: Array<UserPermission>) => void = (
    rows: Array<UserPermission>,
  ): void => {
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(
      rows
        .filter((candidate: UserPermission): boolean => {
          return !candidate.isBlockPermission;
        })
        .map((candidate: UserPermission): Permission => {
          return candidate.permission;
        }),
    );
    jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: rows,
    } as never);
    PermissionGate.clearPermissionPropsCache();
  };

  const page: (n: number, name: string, labelIds?: Array<string>) => unknown = (
    n: number,
    name: string,
    labelIds?: Array<string>,
  ): unknown => {
    return model(StatusPage, {
      _id: id(n).toString(),
      name: name,
      isArchived: false,
      labels: (labelIds || []).map((labelId: string): Label => {
        return model(Label, { _id: labelId });
      }),
    });
  };

  const listsOf: (data: {
    pages: Array<unknown>;
    ownedByUser?: Array<number>;
    ownedByTeam?: Array<number>;
  }) => void = (data: {
    pages: Array<unknown>;
    ownedByUser?: Array<number>;
    ownedByTeam?: Array<number>;
  }): void => {
    getListSpy.mockImplementation((async (options: {
      modelType: unknown;
    }): Promise<unknown> => {
      if (options.modelType === StatusPage) {
        return list(data.pages);
      }

      if (options.modelType === StatusPageOwnerUser) {
        return list(
          (data.ownedByUser || []).map((n: number): StatusPageOwnerUser => {
            return model(StatusPageOwnerUser, { statusPageId: id(n) });
          }),
        );
      }

      if (options.modelType === StatusPageOwnerTeam) {
        return list(
          (data.ownedByTeam || []).map((n: number): StatusPageOwnerTeam => {
            return model(StatusPageOwnerTeam, { statusPageId: id(n) });
          }),
        );
      }

      return list([]);
    }) as never);
  };

  const namesOf: (pages: Array<StatusPageSetupPage>) => Array<string> = (
    pages: Array<StatusPageSetupPage>,
  ): Array<string> => {
    return pages.map((candidate: StatusPageSetupPage): string => {
      return candidate.name;
    });
  };

  beforeEach(() => {
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
    jest.spyOn(UserUtil, "getUserId").mockReturnValue(USER);
  });

  afterEach(() => {
    PermissionGate.clearPermissionPropsCache();
  });

  test("a Project Owner or Member changes every page: the newest first, archived ones left out", async () => {
    holding([row(Permission.ProjectMember)]);
    listsOf({
      pages: [
        page(3, "Walk Co Status"),
        model(StatusPage, {
          _id: id(2).toString(),
          name: "Old Status",
          isArchived: true,
        }),
        page(1, "Walk Co Internal"),
      ],
    });

    expect(getStatusPageEditReach()).toEqual({
      isProjectWide: true,
      labelIds: [],
      reachesOwned: false,
      blockedLabelIds: [],
    });

    const pages: Array<StatusPageSetupPage> =
      await StatusPageSetupApi.loadEditableStatusPages();

    expect(pages).toEqual([
      { id: id(3).toString(), name: "Walk Co Status", labelIds: [] },
      { id: id(1).toString(), name: "Walk Co Internal", labelIds: [] },
    ]);

    const args: Record<string, unknown> = getListSpy.mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    expect(args["modelType"]).toBe(StatusPage);
    expect(args["query"]).toEqual({ projectId: PROJECT_ID });
    expect(args["select"]).toEqual({
      _id: true,
      name: true,
      pageTitle: true,
      isArchived: true,
      labels: { _id: true },
    });
    expect(args["sort"]).toEqual({ createdAt: "DESC" });
    expect(args["limit"]).toBe(PROJECT_STATUS_PAGES_READ_LIMIT);
    // Nobody's owners are read for a grant that reaches every page.
    expect(getListSpy).toHaveBeenCalledTimes(1);
  });

  test("someone who may only read status pages is offered none, and nothing is read", async () => {
    holding([row(Permission.Viewer)]);
    listsOf({ pages: [page(1, "Walk Co Status")] });

    expect(getStatusPageEditReach()).toEqual(NO_STATUS_PAGE_EDIT_REACH);
    expect(await StatusPageSetupApi.loadEditableStatusPages()).toEqual([]);
    expect(getListSpy).not.toHaveBeenCalled();
  });

  test("someone who may change a page but not put a monitor on it is offered none: nothing would be added", async () => {
    holding([
      row(Permission.ReadProjectStatusPage),
      row(Permission.EditProjectStatusPage),
    ]);
    listsOf({ pages: [page(1, "Walk Co Status")] });

    expect(await StatusPageSetupApi.loadEditableStatusPages()).toEqual([]);
  });

  test("a grant limited to labels reaches only the pages carrying one of them", async () => {
    holding([
      row(Permission.ReadProjectStatusPage),
      row(Permission.CreateStatusPageResource),
      row(Permission.EditProjectStatusPage, {
        labelIds: [new ObjectID(PUBLIC)],
        scope: PermissionScope.Labels,
      }),
    ]);
    listsOf({
      pages: [
        page(3, "Walk Co Status", [PUBLIC]),
        page(2, "Walk Co Internal", [INTERNAL]),
        page(1, "Walk Co Unlabelled"),
      ],
    });

    expect(getStatusPageEditReach()).toEqual({
      isProjectWide: false,
      labelIds: [PUBLIC],
      reachesOwned: false,
      blockedLabelIds: [],
    });
    expect(namesOf(await StatusPageSetupApi.loadEditableStatusPages())).toEqual(
      ["Walk Co Status"],
    );
  });

  test("a block with labels takes away the pages carrying one, whatever else grants them", async () => {
    holding([
      row(Permission.ProjectMember),
      row(Permission.ProjectMember, {
        isBlockPermission: true,
        labelIds: [new ObjectID(INTERNAL)],
      }),
    ]);
    listsOf({
      pages: [
        page(3, "Walk Co Status", [PUBLIC]),
        page(2, "Walk Co Internal", [INTERNAL, PUBLIC]),
      ],
    });

    expect(getStatusPageEditReach().blockedLabelIds).toEqual([INTERNAL]);
    expect(namesOf(await StatusPageSetupApi.loadEditableStatusPages())).toEqual(
      ["Walk Co Status"],
    );
  });

  test("a grant limited to owned pages reaches the pages the person, or the row's team, owns - never another team's", async () => {
    holding([
      row(Permission.ReadProjectStatusPage),
      row(Permission.CreateStatusPageResource),
      row(Permission.EditProjectStatusPage, {
        scope: PermissionScope.Owned,
        teamId: TEAM,
      } as Partial<UserPermission>),
      // Another team of theirs, with nothing to do with changing pages.
      row(Permission.ReadProjectStatusPage, {
        teamId: OTHER_TEAM,
      } as Partial<UserPermission>),
    ]);
    listsOf({
      pages: [
        page(3, "Walk Co Status"),
        page(2, "Walk Co Team Page"),
        page(1, "Somebody else's"),
      ],
      ownedByUser: [3],
      ownedByTeam: [2],
    });

    expect(getStatusPageEditReach().reachesOwned).toBe(true);
    expect(namesOf(await StatusPageSetupApi.loadEditableStatusPages())).toEqual(
      ["Walk Co Status", "Walk Co Team Page"],
    );

    const ownerUserArgs: Record<string, unknown> = getListSpy.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType === StatusPageOwnerUser
        );
      },
    )![0] as unknown as Record<string, unknown>;
    expect(
      (ownerUserArgs["query"] as Record<string, unknown>)["userId"],
    ).toEqual(USER);

    const ownerTeamArgs: Record<string, unknown> = getListSpy.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType === StatusPageOwnerTeam
        );
      },
    )![0] as unknown as Record<string, unknown>;
    const teams: Includes = (ownerTeamArgs["query"] as Record<string, unknown>)[
      "teamId"
    ] as Includes;
    expect(
      teams.values.map((teamId: unknown): string => {
        return String(teamId).toLowerCase();
      }),
    ).toEqual([TEAM.toString().toLowerCase()]);
  });

  test("a master admin changes every page", async () => {
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    holding([]);
    listsOf({ pages: [page(1, "Walk Co Status")] });

    expect(getStatusPageEditReach().isProjectWide).toBe(true);
    expect(namesOf(await StatusPageSetupApi.loadEditableStatusPages())).toEqual(
      ["Walk Co Status"],
    );
  });

  test("the rule, record by record", () => {
    const reach: StatusPageEditReach = {
      isProjectWide: false,
      labelIds: [PUBLIC.toUpperCase()],
      reachesOwned: true,
      blockedLabelIds: [INTERNAL],
    };

    // A label granted, in any case.
    expect(
      mayEditStatusPage({ reach, labelIds: [PUBLIC], isOwned: false }),
    ).toBe(true);
    // Owned, with no label.
    expect(mayEditStatusPage({ reach, labelIds: [], isOwned: true })).toBe(
      true,
    );
    // Owned, but a blocked label wins.
    expect(
      mayEditStatusPage({ reach, labelIds: [INTERNAL], isOwned: true }),
    ).toBe(false);
    // Neither.
    expect(mayEditStatusPage({ reach, labelIds: [], isOwned: false })).toBe(
      false,
    );
    expect(
      mayEditStatusPage({
        reach: NO_STATUS_PAGE_EDIT_REACH,
        labelIds: [PUBLIC],
        isOwned: true,
      }),
    ).toBe(false);
    expect(
      mayEditStatusPage({
        reach: { ...NO_STATUS_PAGE_EDIT_REACH, isProjectWide: true },
        labelIds: [],
        isOwned: false,
      }),
    ).toBe(true);
  });
});
