import bulkAddStatusPageMonitorGroups, {
  BulkAddStatusPageMonitorGroupsResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitorGroups";
import bulkAddStatusPageResources, {
  BulkAddStatusPageResourcesResult,
  CreateStatusPageResourceFunction,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageResources";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import { describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * Status Page > Resources > Add Multiple Monitor Groups (issue #6544): the
 * runner behind the dialog. Several monitor groups become resources in one
 * action, as Add Multiple Monitors does for monitors: each named and
 * described as its monitor group is, one already on the status page skipped,
 * every create waited for before the next.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
    },
  };
});

import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

type SetTargetFunction = (
  resource: StatusPageResource,
  targetId: ObjectID,
) => void;

const PROJECT_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194165001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194165002",
);
const GROUP_ID: ObjectID = new ObjectID("0198c8ec-2a1d-7f0c-9e75-384194165003");

const PAYMENTS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165010";
const SEARCH_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165011";
const EMAIL_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165012";

type MakeMonitorGroupFunction = (
  id: string | null,
  name?: string,
  description?: string,
) => MonitorGroup;

const makeMonitorGroup: MakeMonitorGroupFunction = (
  id: string | null,
  name?: string,
  description?: string,
): MonitorGroup => {
  const monitorGroup: MonitorGroup = new MonitorGroup();

  if (id) {
    monitorGroup._id = id;
  }

  if (name !== undefined) {
    monitorGroup.name = name;
  }

  if (description !== undefined) {
    monitorGroup.description = description;
  }

  return monitorGroup;
};

type CollectFunction = () => {
  created: Array<StatusPageResource>;
  createResource: (resource: StatusPageResource) => Promise<void>;
};

const collect: CollectFunction = (): {
  created: Array<StatusPageResource>;
  createResource: (resource: StatusPageResource) => Promise<void>;
} => {
  const created: Array<StatusPageResource> = [];

  return {
    created,
    createResource: async (resource: StatusPageResource): Promise<void> => {
      created.push(resource);
    },
  };
};

describe("bulkAddStatusPageMonitorGroups", () => {
  test("adds every picked monitor group, named and described as its group, in the order picked", async () => {
    const payments: MonitorGroup = makeMonitorGroup(
      PAYMENTS_ID,
      "Payments Stack",
      "Checkout, billing and refunds",
    );
    const search: MonitorGroup = makeMonitorGroup(
      SEARCH_ID,
      "Search Stack",
      "Indexing and queries",
    );
    const { created, createResource } = collect();

    const result: BulkAddStatusPageMonitorGroupsResult =
      await bulkAddStatusPageMonitorGroups({
        monitorGroups: [search, payments],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        statusPageGroupId: GROUP_ID,
        createResource,
      });

    expect(result).toEqual({
      succeeded: [search, payments],
      failed: [],
      skipped: [],
    });
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPageGroupId: GROUP_ID,
      monitorGroupId: new ObjectID(SEARCH_ID),
      displayName: "Search Stack",
      displayDescription: "Indexing and queries",
    });
    expect(created[1]).toMatchObject({
      monitorGroupId: new ObjectID(PAYMENTS_ID),
      displayName: "Payments Stack",
      displayDescription: "Checkout, billing and refunds",
    });
  });

  /*
   * A resource shows a monitor or a monitor group, never both: the server
   * refuses one that names both (BOTH_TARGETS_MESSAGE).
   */
  test("points each resource at its monitor group and never at a monitor", async () => {
    const { created, createResource } = collect();

    await bulkAddStatusPageMonitorGroups({
      monitorGroups: [makeMonitorGroup(PAYMENTS_ID, "Payments Stack")],
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      createResource,
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.monitorGroupId?.toString()).toBe(PAYMENTS_ID);
    expect(created[0]!.monitorId).toBeUndefined();
    expect(created[0]!.monitor).toBeUndefined();
  });

  test("leaves the group, the cell and a missing description unset at the top of the page", async () => {
    const { created, createResource } = collect();

    await bulkAddStatusPageMonitorGroups({
      monitorGroups: [makeMonitorGroup(PAYMENTS_ID, "Payments Stack")],
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      createResource,
    });

    expect(created[0]!.statusPageGroupId).toBeUndefined();
    expect(created[0]!.rowAxisValue).toBeUndefined();
    expect(created[0]!.columnAxisValue).toBeUndefined();
    expect(created[0]!.displayDescription).toBeUndefined();
  });

  test("puts every monitor group in the one grid cell picked", async () => {
    const { created, createResource } = collect();

    await bulkAddStatusPageMonitorGroups({
      monitorGroups: [
        makeMonitorGroup(PAYMENTS_ID, "Payments Stack"),
        makeMonitorGroup(SEARCH_ID, "Search Stack"),
      ],
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPageGroupId: GROUP_ID,
      rowAxisValue: "Core",
      columnAxisValue: "EU",
      createResource,
    });

    for (const resource of created) {
      expect(resource.rowAxisValue).toBe("Core");
      expect(resource.columnAxisValue).toBe("EU");
      expect(resource.statusPageGroupId).toEqual(GROUP_ID);
    }
  });

  test("gives every resource the display options picked once", async () => {
    const { created, createResource } = collect();

    await bulkAddStatusPageMonitorGroups({
      monitorGroups: [
        makeMonitorGroup(PAYMENTS_ID, "Payments Stack"),
        makeMonitorGroup(SEARCH_ID, "Search Stack"),
      ],
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      resourceOptions: {
        displayTooltip: "EU customers",
        showCurrentStatus: false,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
        showStatusHistoryChart: false,
      },
      createResource,
    });

    expect(created).toHaveLength(2);

    for (const resource of created) {
      expect(resource).toMatchObject({
        displayTooltip: "EU customers",
        showCurrentStatus: false,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
        showStatusHistoryChart: false,
      });
    }
  });

  test("leaves the display options to the resource's defaults when none were collected", async () => {
    const { created, createResource } = collect();

    await bulkAddStatusPageMonitorGroups({
      monitorGroups: [makeMonitorGroup(PAYMENTS_ID, "Payments Stack")],
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      createResource,
    });

    expect(created[0]!.displayTooltip).toBeUndefined();
    expect(created[0]!.showCurrentStatus).toBeUndefined();
    expect(created[0]!.showUptimePercent).toBeUndefined();
    expect(created[0]!.uptimePercentPrecision).toBeUndefined();
    expect(created[0]!.showStatusHistoryChart).toBeUndefined();
  });

  // The reported ask: "Skip a group that is already on the status page."
  test("skips the monitor groups the status page already lists, and adds the rest", async () => {
    const payments: MonitorGroup = makeMonitorGroup(
      PAYMENTS_ID,
      "Payments Stack",
    );
    const search: MonitorGroup = makeMonitorGroup(SEARCH_ID, "Search Stack");
    const email: MonitorGroup = makeMonitorGroup(EMAIL_ID, "Email Stack");
    const { created, createResource } = collect();

    const result: BulkAddStatusPageMonitorGroupsResult =
      await bulkAddStatusPageMonitorGroups({
        monitorGroups: [payments, search, email],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        existingMonitorGroupIds: [SEARCH_ID],
        createResource,
      });

    expect(result.succeeded).toEqual([payments, email]);
    expect(result.skipped).toEqual([search]);
    expect(result.failed).toEqual([]);
    expect(
      created.map((resource: StatusPageResource): string => {
        return resource.displayName || "";
      }),
    ).toEqual(["Payments Stack", "Email Stack"]);
  });

  test("writes nothing when every picked monitor group is already on the page", async () => {
    const createResource: Mock<CreateStatusPageResourceFunction> =
      jest.fn<CreateStatusPageResourceFunction>(async (): Promise<void> => {
        // Never called.
      });

    const result: BulkAddStatusPageMonitorGroupsResult =
      await bulkAddStatusPageMonitorGroups({
        monitorGroups: [
          makeMonitorGroup(PAYMENTS_ID, "Payments Stack"),
          makeMonitorGroup(SEARCH_ID, "Search Stack"),
        ],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        existingMonitorGroupIds: [PAYMENTS_ID, SEARCH_ID],
        createResource,
      });

    expect(createResource).not.toHaveBeenCalled();
    expect(result.succeeded).toEqual([]);
    expect(result.skipped).toHaveLength(2);
  });

  test("reads the monitor groups already listed as ObjectIDs or strings, and ignores blanks", async () => {
    const { created, createResource } = collect();

    const result: BulkAddStatusPageMonitorGroupsResult =
      await bulkAddStatusPageMonitorGroups({
        monitorGroups: [
          makeMonitorGroup(PAYMENTS_ID, "Payments Stack"),
          makeMonitorGroup(SEARCH_ID, "Search Stack"),
          makeMonitorGroup(EMAIL_ID, "Email Stack"),
        ],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        existingMonitorGroupIds: [new ObjectID(PAYMENTS_ID), SEARCH_ID, ""],
        createResource,
      });

    expect(
      result.skipped.map((monitorGroup: MonitorGroup): string => {
        return monitorGroup.name || "";
      }),
    ).toEqual(["Payments Stack", "Search Stack"]);
    expect(created).toHaveLength(1);
    expect(created[0]!.displayName).toBe("Email Stack");
  });

  /*
   * A monitor already on the page is a different resource: its id says
   * nothing about the monitor groups, so it never skips one.
   */
  test("never skips a monitor group because a monitor with another id is listed", async () => {
    const { created, createResource } = collect();

    const result: BulkAddStatusPageMonitorGroupsResult =
      await bulkAddStatusPageMonitorGroups({
        monitorGroups: [makeMonitorGroup(PAYMENTS_ID, "Payments Stack")],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        existingMonitorGroupIds: ["0198c8ec-2a1d-7f0c-9e75-384194165099"],
        createResource,
      });

    expect(result.skipped).toEqual([]);
    expect(created).toHaveLength(1);
  });

  test("adds a monitor group picked twice once, where it was first picked", async () => {
    const payments: MonitorGroup = makeMonitorGroup(
      PAYMENTS_ID,
      "Payments Stack",
    );
    const search: MonitorGroup = makeMonitorGroup(SEARCH_ID, "Search Stack");
    const { created, createResource } = collect();

    const result: BulkAddStatusPageMonitorGroupsResult =
      await bulkAddStatusPageMonitorGroups({
        monitorGroups: [
          payments,
          search,
          makeMonitorGroup(PAYMENTS_ID, "Payments Stack"),
        ],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        createResource,
      });

    expect(result.succeeded).toEqual([payments, search]);
    expect(created).toHaveLength(2);
  });

  test("reports a monitor group without an id or a name and goes on with the rest", async () => {
    const nameless: MonitorGroup = makeMonitorGroup(SEARCH_ID);
    const idless: MonitorGroup = makeMonitorGroup(null, "No Id Stack");
    const payments: MonitorGroup = makeMonitorGroup(
      PAYMENTS_ID,
      "Payments Stack",
    );
    const { created, createResource } = collect();

    const result: BulkAddStatusPageMonitorGroupsResult =
      await bulkAddStatusPageMonitorGroups({
        monitorGroups: [nameless, idless, payments],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        createResource,
      });

    expect(result.succeeded).toEqual([payments]);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]!.monitorGroup).toBe(nameless);
    expect((result.failed[0]!.error as Error).message).toBe(
      "Monitor group name is required.",
    );
    expect(result.failed[1]!.monitorGroup).toBe(idless);
    expect((result.failed[1]!.error as Error).message).toBe(
      "Monitor group ID is required.",
    );
    expect(created).toHaveLength(1);
  });

  test("reports a create the server refused and still adds the monitor groups after it", async () => {
    const refusal: Error = new Error(
      "This monitor group is already added to this status page.",
    );
    const created: Array<string> = [];

    const result: BulkAddStatusPageMonitorGroupsResult =
      await bulkAddStatusPageMonitorGroups({
        monitorGroups: [
          makeMonitorGroup(PAYMENTS_ID, "Payments Stack"),
          makeMonitorGroup(SEARCH_ID, "Search Stack"),
          makeMonitorGroup(EMAIL_ID, "Email Stack"),
        ],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        createResource: async (resource: StatusPageResource): Promise<void> => {
          if (resource.displayName === "Search Stack") {
            throw refusal;
          }

          created.push(resource.displayName || "");
        },
      });

    expect(created).toEqual(["Payments Stack", "Email Stack"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.monitorGroup.name).toBe("Search Stack");
    expect(result.failed[0]!.error).toBe(refusal);
    expect(
      result.succeeded.map((monitorGroup: MonitorGroup): string => {
        return monitorGroup.name || "";
      }),
    ).toEqual(["Payments Stack", "Email Stack"]);
  });

  /*
   * The server gives each new resource the next display order as it is
   * created, so two creates in flight at once could get the same one.
   */
  test("waits for each create before starting the next", async () => {
    let inFlight: number = 0;
    let mostInFlight: number = 0;
    const order: Array<string> = [];

    await bulkAddStatusPageMonitorGroups({
      monitorGroups: [
        makeMonitorGroup(PAYMENTS_ID, "Payments Stack"),
        makeMonitorGroup(SEARCH_ID, "Search Stack"),
        makeMonitorGroup(EMAIL_ID, "Email Stack"),
      ],
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      createResource: async (resource: StatusPageResource): Promise<void> => {
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 5);
        });
        order.push(resource.displayName || "");
        inFlight--;
      },
    });

    expect(mostInFlight).toBe(1);
    expect(order).toEqual(["Payments Stack", "Search Stack", "Email Stack"]);
  });

  test("creates through the API when no create is handed in", async () => {
    const mockCreate: jest.MockedFunction<typeof ModelAPI.create> =
      ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>;
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(undefined as never);

    const result: BulkAddStatusPageMonitorGroupsResult =
      await bulkAddStatusPageMonitorGroups({
        monitorGroups: [makeMonitorGroup(PAYMENTS_ID, "Payments Stack")],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
      });

    expect(result.succeeded).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const request: { model: StatusPageResource; modelType: unknown } =
      mockCreate.mock.calls[0]![0] as unknown as {
        model: StatusPageResource;
        modelType: unknown;
      };

    expect(request.modelType).toBe(StatusPageResource);
    expect(request.model.monitorGroupId?.toString()).toBe(PAYMENTS_ID);
    expect(request.model.displayName).toBe("Payments Stack");
  });
});

/*
 * The runner both bulk adds share: Add Multiple Monitors and Add Multiple
 * Monitor Groups differ only in what a resource points at and what a target
 * is called when it cannot be added.
 */
describe("bulkAddStatusPageResources", () => {
  test("points each resource at its target the way it is told, and names the target in its errors", async () => {
    const targets: Array<{ _id?: string; name?: string }> = [
      { _id: PAYMENTS_ID, name: "Payments Stack" },
      { name: "No Id" },
    ];
    const pointedAt: Array<string> = [];
    const created: Array<StatusPageResource> = [];

    const result: BulkAddStatusPageResourcesResult<{
      _id?: string;
      name?: string;
    }> = await bulkAddStatusPageResources({
      targets: targets,
      targetName: "Widget",
      setTarget: (resource: StatusPageResource, targetId: ObjectID): void => {
        pointedAt.push(targetId.toString());
        resource.monitorGroupId = targetId;
      },
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      createResource: async (resource: StatusPageResource): Promise<void> => {
        created.push(resource);
      },
    });

    expect(pointedAt).toEqual([PAYMENTS_ID]);
    expect(created).toHaveLength(1);
    expect(result.succeeded).toEqual([targets[0]]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.target).toBe(targets[1]);
    expect((result.failed[0]!.error as Error).message).toBe(
      "Widget ID is required.",
    );
  });

  test("never points a skipped target at anything", async () => {
    const setTarget: Mock<SetTargetFunction> = jest.fn<SetTargetFunction>();

    const result: BulkAddStatusPageResourcesResult<{
      _id?: string;
      name?: string;
    }> = await bulkAddStatusPageResources({
      targets: [{ _id: PAYMENTS_ID, name: "Payments Stack" }],
      targetName: "Widget",
      setTarget,
      existingTargetIds: [PAYMENTS_ID],
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      createResource: async (): Promise<void> => {
        // Never called.
      },
    });

    expect(setTarget).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
  });
});
