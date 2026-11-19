import {
  MONITOR_CHECKS_ADDRESS_ALREADY,
  MonitorCheckingAddress,
  PublishStatusPageTool,
  SetUpWebsiteMonitoringTool,
  findMonitorCheckingAddress,
  pickMonitorCheckingAddress,
} from "../../../../../Server/Utils/AI/Toolbox/SetupTools";
import {
  PreparedMutation,
  SetupActionRefusal,
  ToolContext,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  countMonitorsSetUpInPlan,
  readMonitorPlanRefusal,
} from "../../../../../Server/Utils/AI/Toolbox/SetupPlan";
import MonitorService from "../../../../../Server/Services/MonitorService";
import PayAsYouGoBillingService from "../../../../../Server/Services/PayAsYouGoBillingService";
import ActiveMonitorLimit from "../../../../../Server/Utils/Billing/ActiveMonitorLimit";
import ProjectService from "../../../../../Server/Services/ProjectService";
import StatusPageResourceService from "../../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../../Server/Services/StatusPageService";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../../Models/DatabaseModels/Project";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../../Models/DatabaseModels/StatusPageResource";
import { SET_UP_WEBSITE_MONITORING_TOOL_NAME } from "../../../../../Types/AI/AISetupActions";
import URL from "../../../../../Types/API/URL";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import {
  MONITORS_CHECKING_ADDRESS_READ_LIMIT,
  WebsiteAddress,
  getMonitorAddress,
  isMonitorCheckingAddress,
  parseWebsiteAddress,
} from "../../../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import { actionLineText } from "../../../../Helpers/AIActionText";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * NO SECOND MONITOR FOR AN ADDRESS A MONITOR ALREADY CHECKS (#7292).
 *
 * Asked "monitor example.com" twice, Ask AI proposed - and once approved
 * made - a second monitor of the same address, where the website guided
 * setup goes on with the one that checks it (#7059, #7254). Now
 * set_up_website_monitoring reads the project's Website and API monitors as
 * the person, by the guided setup's own rule (isMonitorCheckingAddress, in
 * Common for both): one that checks the address now - neither archived nor
 * turned off - means no card, and the model is told its name. A status
 * page in the same plan names that monitor instead of "(new)".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "72920000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("72920000-0000-4000-8000-000000000002");
const TEAMMATE_ID: ObjectID = new ObjectID(
  "72920000-0000-4000-8000-000000000003",
);
const MINE_ID: string = "72920000-0000-4000-8000-000000000010";
const TEAMMATES_ID: string = "72920000-0000-4000-8000-000000000011";
const ARCHIVED_ID: string = "72920000-0000-4000-8000-000000000012";

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: USER_ID, tenantId: PROJECT_ID },
};

type Spy = jest.SpyInstance;

afterEach(() => {
  jest.restoreAllMocks();
});

// A Website monitor checking `address`, as the database hands it back.
function websiteMonitor(data: {
  id: string;
  name: string;
  address: string;
  createdBy?: ObjectID | undefined;
  isArchived?: boolean | undefined;
  disableActiveMonitoring?: boolean | undefined;
  type?: MonitorType | undefined;
}): Monitor {
  const step: MonitorStep = new MonitorStep();
  step.setMonitorDestination(URL.fromString(data.address));

  const steps: MonitorSteps = new MonitorSteps();
  steps.data!.monitorStepsInstanceArray = [step];

  const monitor: Monitor = new Monitor();
  monitor._id = data.id;
  monitor.name = data.name;
  monitor.monitorType = data.type || MonitorType.Website;
  monitor.monitorSteps = steps;
  monitor.isArchived = Boolean(data.isArchived);
  monitor.disableActiveMonitoring = Boolean(data.disableActiveMonitoring);

  if (data.createdBy) {
    monitor.createdByUserId = data.createdBy;
  }

  return monitor;
}

function projectHasMonitors(monitors: Array<Monitor>): Spy {
  return jest
    .spyOn(MonitorService, "findBy")
    .mockResolvedValue(monitors as never);
}

const EXAMPLE: WebsiteAddress = parseWebsiteAddress("example.com")!;

describe("the rule both ways in share", () => {
  test("lives in Common: the address a monitor checks, and whether it checks one now", () => {
    const monitor: Monitor = websiteMonitor({
      id: MINE_ID,
      name: "Acme website",
      address: "https://example.com/",
    });

    expect(getMonitorAddress(monitor.monitorSteps)).toBe(
      "https://example.com/",
    );
    expect(getMonitorAddress(undefined)).toBe("");
    expect(isMonitorCheckingAddress({ monitor, address: EXAMPLE })).toBe(true);
    expect(
      isMonitorCheckingAddress({
        monitor: { ...monitor, isArchived: true } as Monitor,
        address: EXAMPLE,
      }),
    ).toBe(false);
    expect(
      isMonitorCheckingAddress({
        monitor: { ...monitor, disableActiveMonitoring: true } as Monitor,
        address: EXAMPLE,
      }),
    ).toBe(false);
  });

  test("picks the person's own first, then the newest anyone made, never one that no longer checks it", () => {
    const teammates: Monitor = websiteMonitor({
      id: TEAMMATES_ID,
      name: "Shop",
      address: "https://example.com",
      createdBy: TEAMMATE_ID,
    });
    const mine: Monitor = websiteMonitor({
      id: MINE_ID,
      name: "My shop",
      address: "example.com/",
      createdBy: USER_ID,
    });
    const archived: Monitor = websiteMonitor({
      id: ARCHIVED_ID,
      name: "Old shop",
      address: "https://example.com",
      createdBy: USER_ID,
      isArchived: true,
    });

    expect(
      pickMonitorCheckingAddress({
        monitors: [archived, teammates, mine],
        address: EXAMPLE,
        userId: USER_ID.toString(),
      }),
    ).toEqual({ id: MINE_ID, name: "My shop", isOwn: true });
    expect(
      pickMonitorCheckingAddress({
        monitors: [archived, teammates],
        address: EXAMPLE,
        userId: USER_ID.toString(),
      }),
    ).toEqual({ id: TEAMMATES_ID, name: "Shop", isOwn: false });
    expect(
      pickMonitorCheckingAddress({
        monitors: [archived],
        address: EXAMPLE,
        userId: USER_ID.toString(),
      }),
    ).toBeNull();
  });

  test.each([
    ["http://example.com", "another scheme"],
    ["https://www.example.com", "www or not"],
    ["https://example.com/health", "another path"],
    ["https://example.com/?a=1", "another query"],
    ["https://shop.example.com", "another host"],
  ])("a monitor of %s does not check example.com (%s)", (other: string) => {
    expect(
      pickMonitorCheckingAddress({
        monitors: [
          websiteMonitor({ id: MINE_ID, name: "Other", address: other }),
        ],
        address: EXAMPLE,
      }),
    ).toBeNull();
  });

  test("a nameless monitor is named by the address, never blank", () => {
    expect(
      pickMonitorCheckingAddress({
        monitors: [
          websiteMonitor({
            id: MINE_ID,
            name: "",
            address: "https://example.com",
          }),
        ],
        address: EXAMPLE,
      })?.name,
    ).toBe("example.com");
  });
});

describe("set_up_website_monitoring asks before its card", () => {
  test("an address a monitor checks already is not proposed: the model is told the monitor's name", async () => {
    const read: Spy = projectHasMonitors([
      websiteMonitor({
        id: TEAMMATES_ID,
        name: "Acme website",
        address: "https://example.com/",
        createdBy: TEAMMATE_ID,
      }),
    ]);

    const refused: SetupActionRefusal | null =
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
        { address: "EXAMPLE.com" },
        ctx,
      );

    expect(refused).toEqual({
      toldModel: MONITOR_CHECKS_ADDRESS_ALREADY({
        monitor: { id: TEAMMATES_ID, name: "Acme website", isOwn: false },
        address: parseWebsiteAddress("EXAMPLE.com")!,
      }),
    });
    expect(refused?.toldModel).toContain(
      'the monitor "Acme website" already checks https://EXAMPLE.com, so no second monitor is made',
    );
    // Neither a permission nor the plan: nothing the activity calls refused.
    expect(refused?.refusal).toBeUndefined();

    // Read as the person: their own permissions decide what they see.
    const args: {
      query: JSONObject;
      select: JSONObject;
      limit: number;
      props: unknown;
    } = read.mock.calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
      limit: number;
      props: unknown;
    };
    expect(args.props).toBe(ctx.props);
    expect(args.query["projectId"]).toBe(PROJECT_ID);
    expect(args.limit).toBe(MONITORS_CHECKING_ADDRESS_READ_LIMIT);
    expect(args.select).toEqual(
      expect.objectContaining({
        monitorSteps: true,
        isArchived: true,
        disableActiveMonitoring: true,
        createdByUserId: true,
      }),
    );
  });

  test("the person's own monitor is said to be theirs", async () => {
    projectHasMonitors([
      websiteMonitor({
        id: MINE_ID,
        name: "My shop",
        address: "https://example.com",
        createdBy: USER_ID,
      }),
    ]);

    const refused: SetupActionRefusal | null =
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
        { address: "example.com" },
        ctx,
      );

    expect(refused?.toldModel).toContain(
      `the person's own monitor "My shop" already checks https://example.com`,
    );
  });

  test("an archived or turned-off monitor of the address does not count: the card shows", async () => {
    for (const stopped of [
      { isArchived: true },
      { disableActiveMonitoring: true },
    ]) {
      projectHasMonitors([
        websiteMonitor({
          id: ARCHIVED_ID,
          name: "Old shop",
          address: "https://example.com",
          ...stopped,
        }),
      ]);

      const refused: SetupActionRefusal | null =
        await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
          { address: "example.com" },
          ctx,
        );

      // Past the address check: what stops it now is anything but a monitor.
      expect(refused?.toldModel || "").not.toContain("already checks");

      jest.restoreAllMocks();
    }
  });

  test("an API monitor of the address counts as well", async () => {
    projectHasMonitors([
      websiteMonitor({
        id: MINE_ID,
        name: "Health",
        address: "https://api.example.com/health",
        type: MonitorType.API,
      }),
    ]);

    expect(
      (
        await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
          { address: "https://api.example.com/health", isApi: true },
          ctx,
        )
      )?.toldModel,
    ).toContain('"Health" already checks');
  });

  test("monitors that cannot be read let the card show: running it reads them again", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockRejectedValue(new Error("down") as never);

    expect(
      (
        await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
          { address: "example.com" },
          ctx,
        )
      )?.toldModel || "",
    ).not.toContain("already checks");
  });
});

describe("set_up_website_monitoring, approved", () => {
  test("approved after a monitor of the address was made, it makes no second one", async () => {
    projectHasMonitors([
      websiteMonitor({
        id: TEAMMATES_ID,
        name: "Acme website",
        address: "https://example.com",
        createdBy: TEAMMATE_ID,
      }),
    ]);
    const create: Spy = jest.spyOn(MonitorService, "create");

    await expect(
      SetUpWebsiteMonitoringTool.execute({ address: "example.com" }, ctx),
    ).rejects.toThrow(
      new BadDataException(
        'The monitor "Acme website" already checks https://example.com, so no second monitor was made.',
      ),
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("findMonitorCheckingAddress reads as the person and answers null when none checks it", async () => {
    const read: Spy = projectHasMonitors([]);

    await expect(findMonitorCheckingAddress(ctx, EXAMPLE)).resolves.toBeNull();
    expect((read.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );
  });
});

describe("a status page in the same plan names the monitor that checks it", () => {
  // The project's monitors: by name for the status page, and by address.
  function serveMonitors(monitors: Array<Monitor>): Spy {
    return jest
      .spyOn(MonitorService, "findBy")
      .mockImplementation((async (args: {
        query: JSONObject;
      }): Promise<Array<Monitor>> => {
        // A read by name finds none: "example.com" is no monitor's name.
        if (args.query["name"]) {
          return [];
        }

        return monitors;
      }) as never);
  }

  test("its card shows the existing monitor, not a new one", async () => {
    serveMonitors([
      websiteMonitor({
        id: TEAMMATES_ID,
        name: "Acme website",
        address: "https://example.com",
        createdBy: TEAMMATE_ID,
      }),
    ]);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      Object.assign(new Project(), {
        _id: PROJECT_ID.toString(),
        name: "Acme",
      }) as never,
    );

    const prepared: PreparedMutation =
      await PublishStatusPageTool.prepareMutation!(
        { monitors: ["example.com"] },
        {
          ...ctx,
          plannedCalls: [
            {
              name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
              arguments: { address: "example.com" },
            },
          ],
        },
      );

    expect(actionLineText(prepared.description)).toBe(
      'It is public as soon as it is created: anyone with its link sees the status of the monitors it shows. It shows "Acme website".',
    );
  });

  test("approved, the page shows that monitor", async () => {
    serveMonitors([
      websiteMonitor({
        id: TEAMMATES_ID,
        name: "Acme website",
        address: "https://example.com",
      }),
    ]);
    jest.spyOn(StatusPageService, "create").mockImplementation((async (args: {
      data: StatusPage;
    }): Promise<StatusPage> => {
      args.data._id = "72920000-0000-4000-8000-000000000099";
      return args.data;
    }) as never);
    jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([] as never);
    const added: Spy = jest
      .spyOn(StatusPageResourceService, "create")
      .mockImplementation((async (args: {
        data: StatusPageResource;
      }): Promise<StatusPageResource> => {
        return args.data;
      }) as never);
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("" as never);

    await PublishStatusPageTool.execute(
      { name: "Acme Status", monitors: ["https://example.com"] },
      ctx,
    );

    expect(added).toHaveBeenCalledTimes(1);
    const resource: StatusPageResource = (
      added.mock.calls[0]![0] as { data: StatusPageResource }
    ).data;
    expect(resource.monitorId?.toString()).toBe(TEAMMATES_ID);
    expect(resource.displayName).toBe("Acme website");
  });

  test("an address no monitor checks is still the plan's new monitor", async () => {
    serveMonitors([
      websiteMonitor({
        id: ARCHIVED_ID,
        name: "Old shop",
        address: "https://example.com",
        isArchived: true,
      }),
    ]);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      Object.assign(new Project(), {
        _id: PROJECT_ID.toString(),
        name: "Acme",
      }) as never,
    );

    const prepared: PreparedMutation =
      await PublishStatusPageTool.prepareMutation!(
        { monitors: ["example.com"] },
        {
          ...ctx,
          plannedCalls: [
            {
              name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
              arguments: { address: "example.com" },
            },
          ],
        },
      );

    expect(actionLineText(prepared.description)).toContain(
      'It shows "example.com" (new).',
    );
  });
});

// The issue's own words, so the model's sentence names what watches it.
test("what the model is told names the monitor and what can be done instead", () => {
  const monitor: MonitorCheckingAddress = {
    id: MINE_ID,
    name: "Acme website",
    isOwn: false,
  };

  expect(
    MONITOR_CHECKS_ADDRESS_ALREADY({ monitor: monitor, address: EXAMPLE }),
  ).toBe(
    'Nothing proposed: the monitor "Acme website" already checks https://example.com, so no second monitor is made, as the website guided setup makes none. Say so in one sentence, naming it. who_is_told says who it reaches; to show it on a status page, name it in publish_status_page or add_monitors_to_status_page.',
  );
});

/*
 * The plan's room for monitors counts only the monitors it makes: an
 * address a monitor checks already gets none, so a plan near the project's
 * active monitor limit is not refused for it. The quick count is asked
 * first, and only a refusal reads the project's monitors - as the person -
 * to count again.
 */
describe("the plan's room counts no monitor for an address a monitor checks already", () => {
  const plannedCalls: ToolContext["plannedCalls"] = [
    {
      name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
      arguments: { address: "example.com" },
    },
    // The same address again: one monitor at most.
    {
      name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
      arguments: { address: "https://example.com" },
    },
    {
      name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
      arguments: { address: "api.example.com" },
    },
  ];

  function payAsYouGoIsSetUp(): void {
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true as never);
  }

  test("an address named twice is one monitor, and one checked already none", () => {
    expect(countMonitorsSetUpInPlan(plannedCalls)).toBe(2);
    expect(
      countMonitorsSetUpInPlan(
        plannedCalls,
        (address: WebsiteAddress): boolean => {
          return address.url === EXAMPLE.url;
        },
      ),
    ).toBe(1);
  });

  test("refused for two, the plan is counted again without the address checked already, and has room for one", async () => {
    payAsYouGoIsSetUp();
    const reads: Spy = projectHasMonitors([
      websiteMonitor({
        id: TEAMMATES_ID,
        name: "Acme website",
        address: "https://example.com",
        createdBy: TEAMMATE_ID,
      }),
    ]);
    const room: Spy = jest
      .spyOn(ActiveMonitorLimit, "getRefusal")
      .mockImplementation((data: { adding?: number | undefined }) => {
        return Promise.resolve(
          (data.adding || 0) > 1 ? "Your plan allows 5 active monitors." : null,
        );
      });

    expect(
      await readMonitorPlanRefusal({ ...ctx, plannedCalls: plannedCalls }),
    ).toBeNull();
    expect(
      room.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toEqual([
      { projectId: PROJECT_ID, adding: 2 },
      { projectId: PROJECT_ID, adding: 1 },
    ]);
    // Read as the person, as the website monitoring call reads them.
    expect(reads).toHaveBeenCalledWith(
      expect.objectContaining({ props: ctx.props }),
    );
  });

  test("with room for them all, the project's monitors are not read", async () => {
    payAsYouGoIsSetUp();
    const reads: Spy = projectHasMonitors([]);
    jest
      .spyOn(ActiveMonitorLimit, "getRefusal")
      .mockResolvedValue(null as never);

    expect(
      await readMonitorPlanRefusal({ ...ctx, plannedCalls: plannedCalls }),
    ).toBeNull();
    expect(reads).not.toHaveBeenCalled();
  });

  test("still no room once counted again: the plan's own words", async () => {
    payAsYouGoIsSetUp();
    projectHasMonitors([]);
    jest
      .spyOn(ActiveMonitorLimit, "getRefusal")
      .mockResolvedValue("Your plan allows 5 active monitors." as never);

    expect(
      await readMonitorPlanRefusal({ ...ctx, plannedCalls: plannedCalls }),
    ).toBe("Your plan allows 5 active monitors.");
  });
});
