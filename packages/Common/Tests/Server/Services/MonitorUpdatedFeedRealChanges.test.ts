import LabelService from "../../../Server/Services/LabelService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorService from "../../../Server/Services/MonitorService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import StatusPageMonitorRuleEngineService from "../../../Server/Services/StatusPageMonitorRuleEngineService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A MONITOR'S "UPDATED" FEED ITEM RECORDS WHAT AN EDIT REALLY CHANGED.
 *
 * The monitor's Details card sends its name, its description and its labels
 * with every save, and an API client, Terraform or a workflow may write the
 * whole monitor back. The feed lines used to follow whether an update
 * carried a field, not whether it changed it: every such save added a
 * "Monitor was updated" item repeating what it carried - posted to the
 * project's Slack and Microsoft Teams channels as well. Now MonitorService
 * reads what each monitor holds before the write - one read, of the columns
 * the update writes - and writes a line for each one that really changed.
 *
 * These tests run the real onBeforeUpdate and hand what it carries forward
 * to the real onUpdateSuccess; only the database and the side effects' own
 * services are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-0e0e-4aaa-8bbb-000000000002");
const MONITOR_ID: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a1";
const SECOND_MONITOR_ID: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a2";

const CHECKOUT: string = "0193c0de-0e0e-4aaa-8bbb-0000000000c1";
const PAYMENTS: string = "0193c0de-0e0e-4aaa-8bbb-0000000000c2";
const EU_WEST: string = "0193c0de-0e0e-4aaa-8bbb-0000000000c3";

const LABEL_NAMES: Record<string, string> = {
  [CHECKOUT]: "checkout",
  [PAYMENTS]: "payments",
  [EU_WEST]: "eu-west",
};

const STORED_NAME: string = "Checkout API";
const STORED_DESCRIPTION: string =
  "Checks the checkout API every minute.\nPages the payments team.";

const MONITOR_LINK: string = "https://oneuptime.example/dashboard/monitor";

// A monitor as the database holds it.
interface StoredMonitor {
  id: string;
  name: string | null;
  description: string | null;
  labelIds: Array<string>;
}

function storedMonitor(overrides: Partial<StoredMonitor> = {}): StoredMonitor {
  return {
    id: MONITOR_ID,
    name: STORED_NAME,
    description: STORED_DESCRIPTION,
    labelIds: [CHECKOUT, PAYMENTS],
    ...overrides,
  };
}

function label(id: string): Label {
  const row: Label = new Label();
  row._id = id;
  return row;
}

/*
 * A stored monitor as findBy and findOneById answer it: the columns the read
 * asks for, and no others.
 */
function rowOf(record: StoredMonitor, select: Dictionary<unknown>): Monitor {
  const row: Monitor = new Monitor();

  row._id = record.id;
  row.projectId = PROJECT_ID;

  if (select["name"]) {
    row.name = record.name as string;
  }

  if (select["description"]) {
    (row as unknown as Record<string, unknown>)["description"] =
      record.description;
  }

  if (select["labels"]) {
    row.labels = record.labelIds.map(label);
  }

  return row;
}

// The stored monitors a read matches: by its _id, or every one.
function matching(
  records: Array<StoredMonitor>,
  query: Dictionary<unknown>,
): Array<StoredMonitor> {
  const id: unknown = query["_id"];

  if (typeof id !== "string" && !(id instanceof ObjectID)) {
    return records;
  }

  return records.filter((record: StoredMonitor): boolean => {
    return record.id === id.toString().toLowerCase();
  });
}

// The ids a QueryHelper.any() asks for: an IN over its Raw's parameters.
function idsAskedFor(value: unknown): Array<string> {
  const operator: { objectLiteralParameters?: Dictionary<unknown> } = (value ||
    {}) as { objectLiteralParameters?: Dictionary<unknown> };

  return (
    Object.values(operator.objectLiteralParameters || {}) as Array<
      Array<unknown>
    >
  )
    .flat()
    .map((id: unknown): string => {
      return String(id).toLowerCase();
    });
}

// Someone who may edit monitors, as the API sees them.
function editor(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };
}

type OnBeforeUpdate = (
  updateBy: UpdateBy<Monitor>,
) => Promise<OnUpdate<Monitor>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<Monitor>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<Monitor>>;

const hooks: { onBeforeUpdate: OnBeforeUpdate; onUpdateSuccess: OnUpdateSuccess } =
  MonitorService as unknown as {
    onBeforeUpdate: OnBeforeUpdate;
    onUpdateSuccess: OnUpdateSuccess;
  };

const NAME_HEADING: string = "**Name**";
const DESCRIPTION_HEADING: string = "**Monitor Description**";
const LABELS_HEADING: string = "**🏷️ Labels**";

// What the database holds before the write, and after it.
let storedMonitors: Array<StoredMonitor> = [];
let monitorsAfterWrite: Array<StoredMonitor> = [];

let reads: MockFunction;
let feed: MockFunction;
let labelReads: MockFunction;

beforeEach(() => {
  storedMonitors = [storedMonitor()];
  monitorsAfterWrite = [];

  // Every label named here is the project's own.
  stubProjectDirectory({});

  reads = getJestMockFunction();
  reads.mockImplementation(
    async (findBy: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
    }): Promise<Array<Monitor>> => {
      return matching(storedMonitors, findBy.query).map(
        (record: StoredMonitor): Monitor => {
          return rowOf(record, findBy.select);
        },
      );
    },
  );
  jest.spyOn(MonitorService, "findBy").mockImplementation(reads as never);

  // The monitor as it reads after the write.
  jest.spyOn(MonitorService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
    select: Dictionary<unknown>;
  }): Promise<Monitor | null> => {
    const record: StoredMonitor | undefined = (
      monitorsAfterWrite.length > 0 ? monitorsAfterWrite : storedMonitors
    ).find((monitor: StoredMonitor): boolean => {
      return monitor.id === data.id.toString();
    });

    return record ? rowOf(record, { ...data.select, name: true }) : null;
  }) as never);

  jest
    .spyOn(MonitorService, "getMonitorLinkInDashboard")
    .mockResolvedValue(URL.fromString(MONITOR_LINK) as never);

  feed = getJestMockFunction();
  feed.mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockImplementation(feed as never);

  labelReads = getJestMockFunction();
  labelReads.mockImplementation(
    async (findBy: { query: Dictionary<unknown> }): Promise<Array<Label>> => {
      return idsAskedFor(findBy.query["_id"])
        .filter((id: string): boolean => {
          return Boolean(LABEL_NAMES[id]);
        })
        .map((id: string): Label => {
          const row: Label = label(id);
          row.name = LABEL_NAMES[id]!;
          return row;
        });
    },
  );
  jest.spyOn(LabelService, "findBy").mockImplementation(labelReads as never);

  // The rule engines that follow a name, description or labels write.
  jest
    .spyOn(ServiceLevelObjectiveMonitorRuleEngineService, "syncSlosForMonitor")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(StatusPageMonitorRuleEngineService, "syncRulesForMonitor")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function runBeforeUpdate(
  data: Dictionary<unknown>,
  options: {
    query?: Dictionary<unknown>;
    props?: DatabaseCommonInteractionProps;
  } = {},
): Promise<OnUpdate<Monitor>> {
  return await hooks.onBeforeUpdate({
    query: (options.query || {
      _id: MONITOR_ID,
    }) as UpdateBy<Monitor>["query"],
    data: data as UpdateBy<Monitor>["data"],
    props: options.props || editor(),
    limit: 1,
    skip: 0,
  });
}

// The whole update as DatabaseService runs it, around the write.
async function runUpdate(
  data: Dictionary<unknown>,
  options: {
    query?: Dictionary<unknown>;
    props?: DatabaseCommonInteractionProps;
    updatedIds?: Array<string>;
    // Monitors the write reaches that the read before it did not see.
    alsoWritten?: Array<StoredMonitor>;
  } = {},
): Promise<void> {
  const onUpdate: OnUpdate<Monitor> = await runBeforeUpdate(data, options);

  monitorsAfterWrite = [...storedMonitors, ...(options.alsoWritten || [])].map(
    (record: StoredMonitor): StoredMonitor => {
      return {
        ...record,
        name: typeof data["name"] === "string" ? data["name"] : record.name,
      };
    },
  );

  await hooks.onUpdateSuccess(
    onUpdate,
    (options.updatedIds || [MONITOR_ID]).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );

  monitorsAfterWrite = [];
}

function feedMarkdown(): Array<string> {
  return feed.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
  });
}

// The one feed item the update wrote.
function onlyFeedItem(): string {
  expect(feed).toHaveBeenCalledTimes(1);
  return feedMarkdown()[0]!;
}

// What the monitor's Details card sends with every save.
function detailsCardSave(
  overrides: Dictionary<unknown> = {},
): Dictionary<unknown> {
  return {
    name: STORED_NAME,
    description: STORED_DESCRIPTION,
    labels: [label(CHECKOUT), label(PAYMENTS)],
    ...overrides,
  };
}

// A client writing the monitor back as it is: the API, a workflow, Terraform.
function wholeMonitorWriteBack(
  overrides: Dictionary<unknown> = {},
): Dictionary<unknown> {
  return {
    name: STORED_NAME,
    description: STORED_DESCRIPTION.replace(/\n/g, "\r\n"),
    labels: [PAYMENTS, CHECKOUT],
    ...overrides,
  };
}

describe("an update that writes back what the monitor holds adds nothing", () => {
  test.each([
    [
      "the Details card saved unchanged",
      (): Dictionary<unknown> => {
        return detailsCardSave();
      },
    ],
    [
      "the monitor written back by an API client, a workflow or Terraform",
      (): Dictionary<unknown> => {
        return wholeMonitorWriteBack();
      },
    ],
    [
      "the name alone, padded",
      (): Dictionary<unknown> => {
        return { name: `  ${STORED_NAME} ` };
      },
    ],
  ] as Array<[string, () => Dictionary<unknown>]>)(
    "%s: no feed item, so nothing is posted to Slack or Teams",
    async (_label: string, payload: () => Dictionary<unknown>) => {
      await runUpdate(payload());

      expect(feed).not.toHaveBeenCalled();
    },
  );

  test("a workflow writing the monitor back as OneUptime (root, in its project) adds nothing either", async () => {
    await runUpdate(wholeMonitorWriteBack(), {
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    expect(feed).not.toHaveBeenCalled();
  });

  test("the labels sent in another order, repeated, in another case or as bare ids are the labels it has", async () => {
    for (const labels of [
      [label(PAYMENTS), label(CHECKOUT)],
      [CHECKOUT, PAYMENTS, CHECKOUT],
      [label(CHECKOUT.toUpperCase()), new ObjectID(PAYMENTS)],
      [{ _id: CHECKOUT }, { _id: PAYMENTS }],
    ]) {
      await runUpdate({ labels: labels });
    }

    expect(feed).not.toHaveBeenCalled();
  });

  test("no labels or description written over none is no change", async () => {
    storedMonitors = [storedMonitor({ labelIds: [], description: null })];

    await runUpdate({ labels: [], description: "" });
    await runUpdate({ labels: null, description: null });

    expect(feed).not.toHaveBeenCalled();
  });
});

describe("each real change adds its own line, once", () => {
  test("a new name, saved from the Details card with the rest unchanged, records the name alone", async () => {
    await runUpdate(detailsCardSave({ name: "Checkout API (EU)" }));

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain(`${NAME_HEADING}: \nCheckout API (EU)\n`);
    expect(markdown).not.toContain(DESCRIPTION_HEADING);
    expect(markdown).not.toContain(LABELS_HEADING);
  });

  test("a new description records the description alone, its lines kept", async () => {
    await runUpdate(
      detailsCardSave({
        description: "Checks the checkout API.\nPages the platform team.",
      }),
    );

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain(
      `${DESCRIPTION_HEADING}: \nChecks the checkout API.\nPages the platform team.\n`,
    );
    expect(markdown).not.toContain(NAME_HEADING);
  });

  test("a description cleared is recorded as removed", async () => {
    for (const cleared of ["", null]) {
      feed.mockClear();

      await runUpdate({ description: cleared });

      expect(onlyFeedItem()).toContain(
        `${DESCRIPTION_HEADING}: \nNo description provided.\n`,
      );
    }
  });

  test("a label added records the labels the monitor now has", async () => {
    await runUpdate(
      detailsCardSave({
        labels: [label(CHECKOUT), label(PAYMENTS), label(EU_WEST)],
      }),
    );

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain(
      `${LABELS_HEADING}:\n\n- checkout\n- eu-west\n- payments\n`,
    );
    expect(markdown).not.toContain(NAME_HEADING);
  });

  test("every label taken off says so", async () => {
    for (const cleared of [[], null]) {
      feed.mockClear();

      await runUpdate({ labels: cleared });

      expect(onlyFeedItem()).toContain(
        `${LABELS_HEADING}: \nAll labels removed.\n`,
      );
    }
  });

  test("several changes in one update make one feed item, with one line each", async () => {
    await runUpdate(
      detailsCardSave({
        name: "Checkout API (EU)",
        labels: [label(EU_WEST)],
      }),
    );

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain("Checkout API (EU)");
    expect(markdown).toContain("- eu-west");
    expect(markdown).not.toContain(DESCRIPTION_HEADING);
  });

  test("a real change is still posted to the project's Slack and Teams channels, by the person who made it", async () => {
    await runUpdate({ name: "Checkout API (EU)" });

    const item: Record<string, unknown> = feed.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(item["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
    });
    expect(String(item["userId"])).toBe(USER_ID.toString());
    expect(String(item["projectId"])).toBe(PROJECT_ID.toString());
  });
});

describe("the read before the write", () => {
  // The reads that ask for a compared column.
  function storedReads(): Array<{
    query: Dictionary<unknown>;
    select: Dictionary<unknown>;
    props: DatabaseCommonInteractionProps;
  }> {
    return reads.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          query: Dictionary<unknown>;
          select: Dictionary<unknown>;
          props: DatabaseCommonInteractionProps;
        };
      })
      .filter((read: { select: Dictionary<unknown> }): boolean => {
        return ["name", "description"].some((column: string): boolean => {
          return read.select[column] !== undefined;
        });
      });
  }

  test("is one read, of the columns the update writes and no others", async () => {
    await runBeforeUpdate(detailsCardSave());

    expect(storedReads()).toHaveLength(1);
    expect(storedReads()[0]!.select).toEqual({
      _id: true,
      name: true,
      description: true,
      labels: { _id: true },
    });

    reads.mockClear();

    await runBeforeUpdate({ description: "x" });

    expect(storedReads()).toHaveLength(1);
    expect(storedReads()[0]!.select).toEqual({
      _id: true,
      description: true,
    });
  });

  test("is made as root, within the update's query and the caller's project", async () => {
    await runBeforeUpdate({ name: "x" });

    const read: {
      query: Dictionary<unknown>;
      props: DatabaseCommonInteractionProps;
    } = storedReads()[0]!;

    expect(read.props).toEqual({ isRoot: true, ignoreHooks: true });
    expect(read.query["_id"]).toBe(MONITOR_ID);
    expect(read.query["projectId"]).toBe(PROJECT_ID);
  });

  test("is not made for an update that writes none of those columns", async () => {
    const onUpdate: OnUpdate<Monitor> = await runBeforeUpdate({
      isOwnerNotified: true,
    });

    expect(storedReads()).toHaveLength(0);
    expect(onUpdate.carryForward).toBeNull();
  });

  test("a monitor the read did not see counts as changed, so a real change is never missed", async () => {
    await runUpdate(
      { name: STORED_NAME },
      {
        updatedIds: [MONITOR_ID, SECOND_MONITOR_ID],
        alsoWritten: [storedMonitor({ id: SECOND_MONITOR_ID })],
      },
    );

    expect(feed).toHaveBeenCalledTimes(1);
    expect(
      String((feed.mock.calls[0]![0] as Record<string, unknown>)["monitorId"]),
    ).toBe(SECOND_MONITOR_ID);
  });

  test("one update over two monitors records the change only where it is one", async () => {
    storedMonitors = [
      storedMonitor(),
      storedMonitor({ id: SECOND_MONITOR_ID, labelIds: [EU_WEST] }),
    ];

    await runUpdate(
      { labels: [label(CHECKOUT), label(PAYMENTS)] },
      {
        query: { projectId: PROJECT_ID },
        updatedIds: [MONITOR_ID, SECOND_MONITOR_ID],
      },
    );

    expect(feed).toHaveBeenCalledTimes(1);
    expect(
      String((feed.mock.calls[0]![0] as Record<string, unknown>)["monitorId"]),
    ).toBe(SECOND_MONITOR_ID);
  });
});

describe("the feed lines themselves", () => {
  test("quote the name inertly, in the item's link and in its line", async () => {
    await runUpdate({ name: "[Reset](https://evil.example) <b>api</b>" });

    const markdown: string = onlyFeedItem();

    // Inside the link's own text every Markdown character is escaped.
    expect(markdown).toContain(
      `Monitor **[\\[Reset\\]\\(https://evil.example\\) \\<b\\>api\\</b\\>](${MONITOR_LINK}) was updated.**`,
    );
    // In the line, as a value: it reads as typed and links nowhere.
    expect(markdown).toContain(
      `${NAME_HEADING}: \n\\[Reset\\](https://evil.example) \\<b>api\\</b>\n`,
    );
  });

  test("quote the description inertly: it is plain text, as the dashboard shows it", async () => {
    await runUpdate({
      description: "![pixel](https://tracker.example/p.png)\n<img src=x>",
    });

    const markdown: string = onlyFeedItem();

    expect(markdown).not.toContain("![pixel](");
    expect(markdown).toContain("!\\[pixel\\](https://tracker.example/p.png)");
    expect(markdown).toContain("\\<img src=x>");
  });

  test("name the labels by reading them within the monitor's project, and quote their names", async () => {
    LABEL_NAMES[EU_WEST] = "[eu](https://evil.example)";

    try {
      await runUpdate({ labels: [label(EU_WEST)] });

      expect(onlyFeedItem()).toContain("- \\[eu\\](https://evil.example)");

      const read: {
        query: Dictionary<unknown>;
        props: DatabaseCommonInteractionProps;
      } = labelReads.mock.calls[0]![0] as {
        query: Dictionary<unknown>;
        props: DatabaseCommonInteractionProps;
      };

      expect(read.query["projectId"]).toEqual(PROJECT_ID);
      expect(read.props).toEqual({ isRoot: true });
    } finally {
      LABEL_NAMES[EU_WEST] = "eu-west";
    }
  });

  test("write each line plainly, with no indentation that Markdown would read as code", async () => {
    await runUpdate({
      name: "Checkout API (EU)",
      description: "New description.",
      labels: [label(EU_WEST)],
    });

    const markdown: string = onlyFeedItem();

    for (const line of markdown.split("\n")) {
      expect(line).not.toMatch(/^ {4}/);
    }
  });
});
