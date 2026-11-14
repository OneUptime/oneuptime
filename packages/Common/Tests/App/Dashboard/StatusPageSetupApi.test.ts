import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import StatusPageSetupApi, {
  OWN_STATUS_PAGES_READ_LIMIT,
  mayCreateStatusPage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetupApi";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

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
    ).toEqual({ count: 7, names: ["API", "Website"] });

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
    expect(args["select"]).toEqual({ _id: true, name: true, isArchived: true });
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
