import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import URL from "../../../Types/API/URL";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { CategoryCheckboxOptionsAndCategories } from "../../../UI/Components/CategoryCheckbox/Index";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import StatusPageUtil from "../../../UI/Utils/StatusPage";

/*
 * The public Status Page supplies its own ModelAPI subclass to the shared
 * resource-to-checkbox helper. Losing that injected class silently routes the
 * read back through the dashboard client, which is precisely the behavior that
 * caused the Subscribe page to clear an unrelated dashboard session.
 */

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "019acd20-1111-4111-8111-111111111111",
);
const GROUP_ONE_ID: string = "019acd20-2222-4222-8222-222222222222";
const GROUP_TWO_ID: string = "019acd20-3333-4333-8333-333333333333";
const RESOURCE_ONE_ID: string = "019acd20-4444-4444-8444-444444444444";
const RESOURCE_TWO_ID: string = "019acd20-5555-4555-8555-555555555555";
const RESOURCE_THREE_ID: string = "019acd20-6666-4666-8666-666666666666";

class InjectedModelAPI extends ModelAPI {}

interface StaticSpy {
  mockResolvedValue: (value: unknown) => StaticSpy;
  mockRejectedValue: (value: unknown) => StaticSpy;
  mock: { calls: Array<Array<unknown>> };
}

type GetListArguments = {
  modelType: typeof StatusPageResource;
  query: { statusPageId: ObjectID };
  limit: number;
  skip: number;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  requestOptions?: { overrideRequestUrl: URL } | undefined;
};

let injectedGetListSpy: StaticSpy;
let defaultGetListSpy: StaticSpy;

const makeGroup: (data: {
  id: string;
  name: string;
  order: number;
}) => StatusPageGroup = (data: {
  id: string;
  name: string;
  order: number;
}): StatusPageGroup => {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = data.id;
  group.name = data.name;
  group.order = data.order;
  return group;
};

const makeResource: (data: {
  id: string;
  name: string;
  order: number;
  group?: StatusPageGroup | undefined;
}) => StatusPageResource = (data: {
  id: string;
  name: string;
  order: number;
  group?: StatusPageGroup | undefined;
}): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = data.id;
  resource.statusPageId = STATUS_PAGE_ID;
  resource.displayName = data.name;
  resource.order = data.order;
  if (data.group) {
    resource.statusPageGroup = data.group;
  }
  return resource;
};

const mockInjectedResources: (resources: Array<StatusPageResource>) => void = (
  resources: Array<StatusPageResource>,
): void => {
  injectedGetListSpy.mockResolvedValue({
    data: resources,
    count: resources.length,
    skip: 0,
    limit: LIMIT_PER_PROJECT,
  });
};

const injectedGetListArguments: () => GetListArguments =
  (): GetListArguments => {
    return injectedGetListSpy.mock.calls[0]![0] as GetListArguments;
  };

beforeEach(() => {
  /*
   * Install the subclass spy first so it is an own static method and remains
   * independent from the guard spy subsequently installed on ModelAPI.
   */
  injectedGetListSpy = jest.spyOn(
    InjectedModelAPI,
    "getList",
  ) as unknown as StaticSpy;
  defaultGetListSpy = jest.spyOn(ModelAPI, "getList") as unknown as StaticSpy;

  defaultGetListSpy.mockRejectedValue(
    new Error("the default ModelAPI must not receive this request"),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPageUtil model API injection", () => {
  test("getResources delegates the complete public-resource query to the supplied model API", async () => {
    const resource: StatusPageResource = makeResource({
      id: RESOURCE_ONE_ID,
      name: "Checkout API",
      order: 1,
    });
    mockInjectedResources([resource]);

    const overrideRequestUrl: URL = URL.fromString(
      `https://status.example.com/api/status-page/resources/${STATUS_PAGE_ID.toString()}`,
    );

    const result: Array<StatusPageResource> = await StatusPageUtil.getResources(
      STATUS_PAGE_ID,
      overrideRequestUrl,
      InjectedModelAPI,
    );

    expect(injectedGetListSpy.mock.calls).toHaveLength(1);
    expect(defaultGetListSpy.mock.calls).toHaveLength(0);
    expect(result).toEqual([resource]);

    const request: GetListArguments = injectedGetListArguments();
    expect(request.modelType).toBe(StatusPageResource);
    expect(request.query.statusPageId).toBe(STATUS_PAGE_ID);
    expect(request.limit).toBe(LIMIT_PER_PROJECT);
    expect(request.skip).toBe(0);
    expect(request.sort).toEqual({});
    expect(request.select).toEqual({
      _id: true,
      displayName: true,
      order: true,
      statusPageGroup: {
        _id: true,
        name: true,
        order: true,
      },
    });
    expect(request.requestOptions?.overrideRequestUrl.toString()).toBe(
      overrideRequestUrl.toString(),
    );
  });

  test("the checkbox helper preserves the supplied model API while sorting and deduplicating resources", async () => {
    const laterGroup: StatusPageGroup = makeGroup({
      id: GROUP_ONE_ID,
      name: "Customer-facing",
      order: 2,
    });
    const earlierGroup: StatusPageGroup = makeGroup({
      id: GROUP_TWO_ID,
      name: "Core services",
      order: 1,
    });

    mockInjectedResources([
      makeResource({
        id: RESOURCE_ONE_ID,
        name: "Web application",
        order: 3,
        group: laterGroup,
      }),
      makeResource({
        id: RESOURCE_TWO_ID,
        name: "API",
        order: 1,
        group: earlierGroup,
      }),
      makeResource({
        id: RESOURCE_THREE_ID,
        name: "Worker",
        order: 2,
        group: laterGroup,
      }),
    ]);

    const overrideRequestUrl: URL = URL.fromString(
      `https://status.example.com/api/status-page/resources/${STATUS_PAGE_ID.toString()}`,
    );

    const result: CategoryCheckboxOptionsAndCategories =
      await StatusPageUtil.getCategoryCheckboxPropsBasedOnResources(
        STATUS_PAGE_ID,
        overrideRequestUrl,
        InjectedModelAPI,
      );

    expect(injectedGetListSpy.mock.calls).toHaveLength(1);
    expect(defaultGetListSpy.mock.calls).toHaveLength(0);
    expect(
      injectedGetListArguments().requestOptions?.overrideRequestUrl.toString(),
    ).toBe(overrideRequestUrl.toString());

    expect(result.categories).toEqual([
      { id: GROUP_TWO_ID, title: "Core services" },
      { id: GROUP_ONE_ID, title: "Customer-facing" },
    ]);
    expect(result.options).toEqual([
      {
        value: RESOURCE_TWO_ID,
        label: "API",
        categoryId: GROUP_TWO_ID,
      },
      {
        value: RESOURCE_THREE_ID,
        label: "Worker",
        categoryId: GROUP_ONE_ID,
      },
      {
        value: RESOURCE_ONE_ID,
        label: "Web application",
        categoryId: GROUP_ONE_ID,
      },
    ]);
  });
});
