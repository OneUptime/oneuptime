import bulkAddStatusPageMonitors, {
  BulkAddStatusPageMonitorsResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitors";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import { describe, expect, jest, test } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194160001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194160002",
);
const GROUP_ID: ObjectID = new ObjectID("0198c8ec-2a1d-7f0c-9e75-384194160003");

const makeMonitor: (
  id: string | null,
  name?: string,
  description?: string,
) => Monitor = (
  id: string | null,
  name?: string,
  description?: string,
): Monitor => {
  const monitor: Monitor = new Monitor();

  if (id) {
    monitor._id = id;
  }

  if (name !== undefined) {
    monitor.name = name;
  }

  if (description !== undefined) {
    monitor.description = description;
  }
  return monitor;
};

describe("bulkAddStatusPageMonitors", () => {
  test("copies monitor identity and presentation fields into grouped resources", async () => {
    const first: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160010",
      "Checkout API",
      "Processes customer checkouts",
    );
    const second: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160011",
      "Billing Worker",
      "Runs recurring invoices",
    );
    const created: Array<StatusPageResource> = [];

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: [first, second],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        statusPageGroupId: GROUP_ID,
        createResource: async (resource: StatusPageResource): Promise<void> => {
          created.push(resource);
        },
      });

    expect(result.succeeded).toEqual([first, second]);
    expect(result.failed).toEqual([]);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPageGroupId: GROUP_ID,
      monitorId: first.id,
      displayName: "Checkout API",
      displayDescription: "Processes customer checkouts",
    });
    expect(created[1]).toMatchObject({
      monitorId: second.id,
      displayName: "Billing Worker",
      displayDescription: "Runs recurring invoices",
    });
  });

  test("leaves group and optional description unset for uncategorized resources", async () => {
    const monitor: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160020",
      "Public Website",
    );
    let created: StatusPageResource | null = null;

    await bulkAddStatusPageMonitors({
      monitors: [monitor],
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      createResource: async (resource: StatusPageResource): Promise<void> => {
        created = resource;
      },
    });

    expect(created).not.toBeNull();
    expect(created!.displayDescription).toBeUndefined();
    expect(created!.statusPageGroupId).toBeUndefined();
    expect(created!.rowAxisValue).toBeUndefined();
    expect(created!.columnAxisValue).toBeUndefined();
  });

  test("applies one grid placement to every selected monitor", async () => {
    const monitors: Array<Monitor> = [
      makeMonitor("0198c8ec-2a1d-7f0c-9e75-384194160030", "US API"),
      makeMonitor("0198c8ec-2a1d-7f0c-9e75-384194160031", "US Worker"),
    ];
    const created: Array<StatusPageResource> = [];

    await bulkAddStatusPageMonitors({
      monitors,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPageGroupId: GROUP_ID,
      rowAxisValue: "Production",
      columnAxisValue: "US East",
      createResource: async (resource: StatusPageResource): Promise<void> => {
        created.push(resource);
      },
    });

    expect(created).toHaveLength(2);
    expect(
      created.every((resource: StatusPageResource) => {
        return (
          resource.rowAxisValue === "Production" &&
          resource.columnAxisValue === "US East"
        );
      }),
    ).toBe(true);
  });

  test("applies the shared resource options to every selected monitor", async () => {
    const monitors: Array<Monitor> = [
      makeMonitor("0198c8ec-2a1d-7f0c-9e75-384194160035", "US API"),
      makeMonitor("0198c8ec-2a1d-7f0c-9e75-384194160036", "US Worker"),
    ];
    const created: Array<StatusPageResource> = [];

    await bulkAddStatusPageMonitors({
      monitors,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      resourceOptions: {
        displayTooltip: "Runs in US East",
        showCurrentStatus: false,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
        showStatusHistoryChart: false,
      },
      createResource: async (resource: StatusPageResource): Promise<void> => {
        created.push(resource);
      },
    });

    expect(created).toHaveLength(2);

    for (const resource of created) {
      expect(resource).toMatchObject({
        displayTooltip: "Runs in US East",
        showCurrentStatus: false,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
        showStatusHistoryChart: false,
      });
    }
  });

  test("leaves resource options unset when the form did not collect them", async () => {
    const monitor: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160037",
      "US API",
    );
    let created: StatusPageResource | null = null;

    await bulkAddStatusPageMonitors({
      monitors: [monitor],
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      createResource: async (resource: StatusPageResource): Promise<void> => {
        created = resource;
      },
    });

    expect(created!.displayTooltip).toBeUndefined();
    expect(created!.showCurrentStatus).toBeUndefined();
    expect(created!.showUptimePercent).toBeUndefined();
    expect(created!.uptimePercentPrecision).toBeUndefined();
    expect(created!.showStatusHistoryChart).toBeUndefined();
  });

  test("deduplicates repeated monitor selections while retaining first-selection order", async () => {
    const first: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160040",
      "First",
    );
    const duplicateFirst: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160040",
      "First Duplicate",
    );
    const second: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160041",
      "Second",
    );
    const createdNames: Array<string> = [];

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: [first, duplicateFirst, second],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        createResource: async (resource: StatusPageResource): Promise<void> => {
          createdNames.push(resource.displayName!);
        },
      });

    expect(createdNames).toEqual(["First", "Second"]);
    expect(result.succeeded).toEqual([first, second]);
    expect(result.failed).toEqual([]);
  });

  test("reports no skipped monitors when the status page is empty", async () => {
    const monitor: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160080",
      "First",
    );

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: [monitor],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        createResource: async (): Promise<void> => {},
      });

    expect(result.succeeded).toEqual([monitor]);
    expect(result.skipped).toEqual([]);
  });

  /*
   * Issue #3420. Selecting a label re-selects every monitor carrying it, so a
   * re-add after one new monitor joined the label arrives here as "the three
   * already on the page, plus the new one". Only the new one is a create.
   */
  test("adds only the monitors the status page does not already list", async () => {
    const alreadyAdded: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160090",
      "Checkout API",
    );
    const alsoAlreadyAdded: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160091",
      "Billing Worker",
    );
    const newlyLabelled: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160092",
      "Search API",
    );
    const created: Array<StatusPageResource> = [];

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: [alreadyAdded, alsoAlreadyAdded, newlyLabelled],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        statusPageGroupId: GROUP_ID,
        existingMonitorIds: [alreadyAdded.id!, alsoAlreadyAdded.id!],
        createResource: async (resource: StatusPageResource): Promise<void> => {
          created.push(resource);
        },
      });

    expect(created).toHaveLength(1);
    expect(created[0]!.monitorId?.toString()).toBe(newlyLabelled._id);
    expect(result.succeeded).toEqual([newlyLabelled]);
    expect(result.skipped).toEqual([alreadyAdded, alsoAlreadyAdded]);
    expect(result.failed).toEqual([]);
  });

  test("re-adding the same label a second time writes nothing at all", async () => {
    const monitors: Array<Monitor> = [
      makeMonitor("0198c8ec-2a1d-7f0c-9e75-384194160100", "First"),
      makeMonitor("0198c8ec-2a1d-7f0c-9e75-384194160101", "Second"),
    ];
    const createResource: (resource: StatusPageResource) => Promise<void> =
      jest.fn(async (_resource: StatusPageResource): Promise<void> => {});

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: monitors,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        existingMonitorIds: monitors.map((monitor: Monitor) => {
          return monitor.id!;
        }),
        createResource,
      });

    expect(createResource).not.toHaveBeenCalled();
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual(monitors);
  });

  test("accepts existing monitor ids as ObjectIDs or as strings", async () => {
    const byObjectId: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160110",
      "By Object ID",
    );
    const byString: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160111",
      "By String",
    );
    const created: Array<StatusPageResource> = [];

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: [byObjectId, byString],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        existingMonitorIds: [new ObjectID(byObjectId._id!), byString._id!],
        createResource: async (resource: StatusPageResource): Promise<void> => {
          created.push(resource);
        },
      });

    expect(created).toEqual([]);
    expect(result.skipped).toEqual([byObjectId, byString]);
  });

  test("ignores blank entries in the existing monitor ids", async () => {
    const monitor: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160120",
      "First",
    );
    const created: Array<StatusPageResource> = [];

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: [monitor],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        existingMonitorIds: ["", undefined as unknown as string],
        createResource: async (resource: StatusPageResource): Promise<void> => {
          created.push(resource);
        },
      });

    expect(created).toHaveLength(1);
    expect(result.succeeded).toEqual([monitor]);
    expect(result.skipped).toEqual([]);
  });

  test("keeps the display order of the monitors it does add", async () => {
    const first: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160130",
      "First",
    );
    const alreadyAdded: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160131",
      "Already Added",
    );
    const last: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160132",
      "Last",
    );
    const createdNames: Array<string> = [];

    await bulkAddStatusPageMonitors({
      monitors: [first, alreadyAdded, last],
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      existingMonitorIds: [alreadyAdded.id!],
      createResource: async (resource: StatusPageResource): Promise<void> => {
        createdNames.push(resource.displayName!);
      },
    });

    expect(createdNames).toEqual(["First", "Last"]);
  });

  test("reports a monitor that is both selected twice and already added once", async () => {
    const alreadyAdded: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160140",
      "Already Added",
    );
    const alreadyAddedAgain: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160140",
      "Already Added Duplicate",
    );
    const createResource: (resource: StatusPageResource) => Promise<void> =
      jest.fn(async (_resource: StatusPageResource): Promise<void> => {});

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: [alreadyAdded, alreadyAddedAgain],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        existingMonitorIds: [alreadyAdded.id!],
        createResource,
      });

    expect(createResource).not.toHaveBeenCalled();
    expect(result.skipped).toEqual([alreadyAdded]);
  });

  test("still reports invalid selections while skipping the already added ones", async () => {
    const missingId: Monitor = makeMonitor(null, "Missing ID");
    const alreadyAdded: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160150",
      "Already Added",
    );
    const valid: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160151",
      "Valid",
    );
    const created: Array<StatusPageResource> = [];

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: [missingId, alreadyAdded, valid],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        existingMonitorIds: [alreadyAdded.id!],
        createResource: async (resource: StatusPageResource): Promise<void> => {
          created.push(resource);
        },
      });

    expect(created).toHaveLength(1);
    expect(result.succeeded).toEqual([valid]);
    expect(result.skipped).toEqual([alreadyAdded]);
    expect(result.failed).toHaveLength(1);
    expect((result.failed[0]!.error as Error).message).toBe(
      "Monitor ID is required.",
    );
  });

  test("accepts plain monitor objects returned by the multi-select list", async () => {
    const selectedMonitor: Monitor = {
      _id: "0198c8ec-2a1d-7f0c-9e75-384194160045",
      name: "Plain Object Monitor",
      description: "Selected through ModelList",
    } as Monitor;
    let created: StatusPageResource | null = null;

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: [selectedMonitor],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        createResource: async (resource: StatusPageResource): Promise<void> => {
          created = resource;
        },
      });

    expect(result.failed).toEqual([]);
    expect(created!.monitorId?.toString()).toBe(selectedMonitor._id);
    expect(created!.displayName).toBe("Plain Object Monitor");
    expect(created!.displayDescription).toBe("Selected through ModelList");
  });

  test("reports invalid monitors and continues adding valid selections", async () => {
    const missingId: Monitor = makeMonitor(null, "Missing ID");
    const missingName: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160050",
    );
    const valid: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160051",
      "Valid",
    );
    const createResource: (resource: StatusPageResource) => Promise<void> =
      jest.fn(async (_resource: StatusPageResource): Promise<void> => {});

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: [missingId, missingName, valid],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        createResource,
      });

    expect(createResource).toHaveBeenCalledTimes(1);
    expect(result.succeeded).toEqual([valid]);
    expect(result.failed).toHaveLength(2);
    expect((result.failed[0]!.error as Error).message).toBe(
      "Monitor ID is required.",
    );
    expect((result.failed[1]!.error as Error).message).toBe(
      "Monitor name is required.",
    );
  });

  test("isolates create failures so later monitors still run", async () => {
    const first: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160060",
      "First",
    );
    const failing: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160061",
      "Failing",
    );
    const last: Monitor = makeMonitor(
      "0198c8ec-2a1d-7f0c-9e75-384194160062",
      "Last",
    );
    const attemptedNames: Array<string> = [];

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        monitors: [first, failing, last],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        createResource: async (resource: StatusPageResource): Promise<void> => {
          attemptedNames.push(resource.displayName!);
          if (resource.displayName === "Failing") {
            throw new Error("Create denied");
          }
        },
      });

    expect(attemptedNames).toEqual(["First", "Failing", "Last"]);
    expect(result.succeeded).toEqual([first, last]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.monitor).toBe(failing);
    expect((result.failed[0]!.error as Error).message).toBe("Create denied");
  });

  test("waits for each create before starting the next one", async () => {
    const monitors: Array<Monitor> = [
      makeMonitor("0198c8ec-2a1d-7f0c-9e75-384194160070", "First"),
      makeMonitor("0198c8ec-2a1d-7f0c-9e75-384194160071", "Second"),
      makeMonitor("0198c8ec-2a1d-7f0c-9e75-384194160072", "Third"),
    ];
    let activeCreates: number = 0;
    let maximumActiveCreates: number = 0;

    await bulkAddStatusPageMonitors({
      monitors,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      createResource: async (): Promise<void> => {
        activeCreates++;
        maximumActiveCreates = Math.max(maximumActiveCreates, activeCreates);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 1);
        });
        activeCreates--;
      },
    });

    expect(maximumActiveCreates).toBe(1);
  });
});
