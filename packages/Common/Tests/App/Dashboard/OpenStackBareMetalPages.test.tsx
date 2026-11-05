import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import {
  OPENSTACK_BARE_METAL_IN_MAINTENANCE,
  OPENSTACK_BARE_METAL_IN_SERVICE,
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudBareMetalNodeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/BareMetalNodeDetail";
import OpenStackCloudBareMetalNodes from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/BareMetalNodes";
import OpenStackCloudServices from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Services";
import OpenStackCloudSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/SideMenu";
import { OpenStackRecording } from "../../Helpers/OpenStackRecordings";
import {
  CLOUD_ID,
  Row,
  attentionRowsOf,
  kindCalls,
  partPath,
  renderPage,
  resetServer,
  server,
  settle,
  tableRow,
} from "./OpenStackPartHarness";

/*
 * Bare metal, rendered for real over the real tables and part cards, with only the network
 * replaced. Where a row comes from says what it proves: `recorded()` is what a real DevStack's
 * exporter answered (Fixtures/OpenStack/services-ironic), through the real scan, as the agent's own
 * credential or, in a second argument, with system scope. Every other row is written by hand: an
 * instance on a node, which nothing recorded holds, and what only a probe reads from Ironic's API,
 * whose rows the probe's own tests hold to its recorded answers.
 */

configure({ asyncUtilTimeout: 30000 });

jest.setTimeout(300000);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

const CLEAN_FAILED_ID: string = "73a89c31-be10-40db-9f7f-c08fad8e6112";
const HALF_ID: string = "59d335d5-0fe7-452d-9f67-34e82ee6706a";
const MAINTENANCE_ID: string = "3cca2e8c-fd41-4eea-a4db-43aa5e780090";
const NODE_ID: string = "aaaaaaaa-3333-4333-8333-000000000001";
const INSTANCE_ID: string = "bbbbbbbb-3333-4333-8333-000000000001";

let nextId: number = 1;

function id(): string {
  return `6c1b2a3d-4e5f-4a6b-8c7d-${String(nextId++).padStart(12, "0")}`;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

const WITH_SYSTEM_SCOPE: string = "devstack-system-admin";

// A real cloud's scene, as the rows OneUptime would hold, seen just now.
function recorded(scene: string, asCloud?: string | undefined): Array<Row> {
  return new OpenStackRecording("services-ironic", scene, asCloud).rows.map(
    (row: OpenStackResource): Row => {
      return {
        ...row,
        _id: id(),
        stateChangedAt: minutesAgo(3),
        lastSeenAt: minutesAgo(1),
      } as Row;
    },
  );
}

function apiRow(fields: Row = {}): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.Api,
    externalId: "RegionOne/baremetal",
    name: OpenStackServiceType.BareMetal,
    regionName: "RegionOne",
    status: "up",
    lastSeenAt: minutesAgo(1),
    facts: {},
    ...fields,
  };
}

function nodeRow(fields: Row = {}): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.BareMetalNode,
    externalId: NODE_ID,
    name: "node-1",
    regionName: "RegionOne",
    status: "available",
    adminState: OPENSTACK_BARE_METAL_IN_SERVICE,
    stateChangedAt: minutesAgo(10),
    lastSeenAt: minutesAgo(1),
    facts: { powerState: "power off", resourceClass: "gold", isRetired: false },
    ...fields,
  };
}

function instanceRow(status: string): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.Instance,
    externalId: INSTANCE_ID,
    name: "metal-web-01",
    hypervisorName: NODE_ID,
    regionName: "RegionOne",
    status,
    stateChangedAt: minutesAgo(10),
    lastSeenAt: minutesAgo(1),
    facts: {},
  };
}

function probeCollected(): void {
  (server.cloud as OpenStackCloud).collectionMethod =
    OpenStackCollectionMethod.Probe;
}

const THE_AGENT_SAYS_NOTHING_OF_THESE: Array<string> = [
  "openstack-bare-metal-node-details-driver",
  "openstack-bare-metal-node-details-conductor",
  "openstack-bare-metal-node-details-fault",
  "openstack-bare-metal-node-last-error",
];

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the list, on what a real cloud said", () => {
  test("each node in Ironic's own word, and only what the exporter can say", async () => {
    server.rows = recorded("deploy-failed");

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    const failed: HTMLElement = (
      await screen.findByText("ou-node-clean-failed")
    ).closest("tr") as HTMLElement;

    expect(within(failed).getByText("clean failed")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(tableRow("ou-node-available")).toHaveTextContent("available");
    expect(tableRow("ou-node-half")).toHaveTextContent("enroll");
    expect(tableRow("ou-node-deploy-failed")).toHaveTextContent("power on");
    expect(tableRow("ou-node-maintenance")).toHaveTextContent(
      "OneUptime drill: a disk being swapped",
    );

    // Nothing here has a driver or an instance, so a column of blanks is left out.
    expect(screen.queryByText("Driver")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Instance" })).toBeNull();
  });

  test("reads one page of one kind, and never the whole cloud", async () => {
    server.rows = recorded("deploy-failed");

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");
    await screen.findByText("ou-node-half");

    const calls: ReturnType<typeof kindCalls> = kindCalls(
      OpenStackResourceKind.BareMetalNode,
    );

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.limit).toBeLessThanOrEqual(100);
    }
  });

  test("what there is of each class, and how much of it could take an instance", async () => {
    server.rows = recorded("deploy-failed");

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    const classes: Array<HTMLElement> = await screen.findAllByTestId(
      "openstack-bare-metal-class",
    );
    const baremetal: HTMLElement = classes.find((one: HTMLElement) => {
      return one.textContent?.includes("baremetal");
    }) as HTMLElement;
    const none: HTMLElement = classes.find((one: HTMLElement) => {
      return one.textContent?.includes("No resource class");
    }) as HTMLElement;

    /*
     * Nova reads none of these as schedulable, and neither does this: nothing here has a power state
     * but the failed one, and Placement recorded every one of them reserved.
     */
    expect(baremetal).toHaveTextContent("0 of 4 can take an instance");
    expect(baremetal).toHaveTextContent("Failed: 2");
    expect(baremetal).toHaveTextContent("In maintenance: 1");
    expect(none).toHaveTextContent("0 of 1 can take an instance");
  });

  test("the card has nothing to say where its read fails, and the list goes on", async () => {
    server.rows = recorded("deploy-failed");
    server.failPosts.add("bare-metal-classes");

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    expect(await screen.findByText("ou-node-half")).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-bare-metal-classes")).toBeNull();
  });

  test("says what the agent can't read, every time", async () => {
    server.rows = recorded("half-enrolled");

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    expect(
      await screen.findByTestId("openstack-bare-metal-collection"),
    ).toHaveTextContent(/exporter reports nodes and no conductors/);
  });
});

describe("what it can and can't see", () => {
  test("Ironic gone quiet says it can't tell why, and these rows are as they last read", async () => {
    server.rows = [
      apiRow({ lastSeenAt: minutesAgo(45) }),
      ...recorded("deploy-failed").filter((row: Row) => {
        return row.kind === OpenStackResourceKind.BareMetalNode;
      }),
    ];

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    const quiet: HTMLElement = await screen.findByTestId(
      "openstack-bare-metal-quiet",
    );

    expect(quiet).toHaveTextContent("45m");
    expect(quiet).toHaveTextContent(/can't say which/);
    expect(quiet).toHaveTextContent(/as they last read/);
    // The one thing it must not claim.
    expect(screen.queryByTestId("openstack-bare-metal-down")).toBeNull();
    expect(quiet).not.toHaveTextContent(/isn't answering/);
  });

  test("a few minutes without a read is not quiet: the job only runs every five", async () => {
    server.rows = [apiRow({ lastSeenAt: minutesAgo(12) }), nodeRow()];

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");
    await screen.findByText("node-1");

    expect(screen.queryByTestId("openstack-bare-metal-quiet")).toBeNull();
  });

  test("a probe says down when it is, and quiet means something else there", async () => {
    probeCollected();
    server.rows = [apiRow({ status: "down" }), nodeRow()];

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    expect(
      await screen.findByTestId("openstack-bare-metal-down"),
    ).toHaveTextContent(/isn't answering/);

    cleanup();
    server.rows = [apiRow({ lastSeenAt: minutesAgo(45) }), nodeRow()];

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    expect(
      await screen.findByTestId("openstack-bare-metal-quiet"),
    ).toHaveTextContent(/left this region's catalog/);
  });

  test("Placement holding more than Ironic shows says this list isn't the whole cloud's", async () => {
    // A project's admin owns one of the three: Ironic lists that, and Placement all three.
    server.rows = recorded("baseline");

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    expect(
      await screen.findByTestId("openstack-bare-metal-partial"),
    ).toHaveTextContent(
      /Placement holds 2 bare metal nodes Ironic doesn't show this credential/,
    );
    expect(screen.queryByText("ou-node-active")).toBeNull();
  });

  test("a half-enrolled node in Ironic's list can't hide one it left out, as a count beside a count would", async () => {
    // Five of the project's own against Placement's four, two of which it doesn't own.
    server.rows = recorded("wait-call-back");

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    expect(
      await screen.findByTestId("openstack-bare-metal-partial"),
    ).toHaveTextContent(
      /Placement holds 2 bare metal nodes Ironic doesn't show this credential/,
    );
  });

  test("the same moment with system scope lists all three, and has nothing to say", async () => {
    server.rows = recorded("baseline", WITH_SYSTEM_SCOPE);

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");
    await screen.findByText("ou-node-active");

    expect(screen.queryByTestId("openstack-bare-metal-partial")).toBeNull();
  });

  test("Placement trailing Ironic, as it did on the recording, says nothing", async () => {
    server.rows = recorded("wait-call-back", WITH_SYSTEM_SCOPE);

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");
    await screen.findByText("ou-node-half");

    expect(screen.queryByTestId("openstack-bare-metal-partial")).toBeNull();
  });

  test("Ironic answering with nothing says why a cloud with nodes can read like this", async () => {
    server.rows = [apiRow()];

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    expect(
      await screen.findByTestId("openstack-bare-metal-nothing-shown"),
    ).toHaveTextContent(/only the nodes that project owns/);
  });

  test("a probe's card says what it reads, and where a project is refused", async () => {
    probeCollected();
    server.rows = [apiRow(), nodeRow()];

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    expect(
      await screen.findByTestId("openstack-bare-metal-collection"),
    ).toHaveTextContent(
      /refuses a project's credential the list of conductors/,
    );
  });
});

describe("a node's page, on what a real cloud said", () => {
  test("clean failed: by name, and it says it doesn't know why", async () => {
    server.rows = recorded("clean-failed");

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", CLEAN_FAILED_ID),
    );

    expect(
      await screen.findByTestId("openstack-bare-metal-node-explanation"),
    ).toHaveTextContent(/stays failed until someone acts/);
    expect(attentionRowsOf("openstack-bare-metal-node-attention")).toEqual([
      "This node: In clean failed",
    ]);
    expect(
      screen.getByTestId("openstack-bare-metal-node-no-reason"),
    ).toHaveTextContent(/doesn't carry why a node failed/);

    for (const testId of THE_AGENT_SAYS_NOTHING_OF_THESE) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
  });

  test("Placement's numbers, which say Nova has it reserved", async () => {
    server.rows = recorded("clean-failed").map((row: Row): Row => {
      // The scene's Placement hadn't reached this node yet: what the next one recorded of it.
      return row.kind === OpenStackResourceKind.PlacementProvider
        ? { ...row, externalId: `RegionOne/${CLEAN_FAILED_ID}` }
        : row;
    });

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", CLEAN_FAILED_ID),
    );

    expect(
      await screen.findByTestId("openstack-bare-metal-node-placement"),
    ).toHaveTextContent("1 in all, 1 reserved, 0 in use");
    expect(
      screen.getByTestId(
        "openstack-bare-metal-node-details-can-take-an-instance",
      ),
    ).toHaveTextContent("No");
  });

  test("half-enrolled: no alarm, what it's waiting for, and nothing on Placement", async () => {
    server.rows = recorded("half-enrolled");

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", HALF_ID),
    );

    expect(
      await screen.findByTestId("openstack-bare-metal-node-enroll"),
    ).toHaveTextContent(/still in enroll/);
    expect(attentionRowsOf("openstack-bare-metal-node-attention")).toEqual([]);
    expect(
      screen.getByTestId("openstack-bare-metal-node-details-resource-class"),
    ).toHaveTextContent("None");
    expect(
      screen.getByTestId("openstack-bare-metal-node-details-power-state"),
    ).toHaveTextContent(/Not known/);
    expect(
      await screen.findByTestId("openstack-bare-metal-node-not-on-placement"),
    ).toBeInTheDocument();
  });

  test("maintenance: planned, in the operator's words, and it needs nobody", async () => {
    server.rows = recorded("maintenance");

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", MAINTENANCE_ID),
    );

    expect(
      await screen.findByTestId("openstack-bare-metal-node-maintenance"),
    ).toHaveTextContent("OneUptime drill: a disk being swapped");
    expect(attentionRowsOf("openstack-bare-metal-node-attention")).toEqual([]);
    expect(
      screen.getByTestId(
        "openstack-bare-metal-node-details-maintenance-reason",
      ),
    ).toHaveTextContent("OneUptime drill: a disk being swapped");
  });

  test("its alerts are the four that watch a node, on a cloud reporting Ironic", async () => {
    server.rows = recorded("clean-failed");

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", CLEAN_FAILED_ID),
    );

    const alerts: string = within(
      await screen.findByTestId("openstack-bare-metal-node-alerts"),
    )
      .getAllByTestId("openstack-bare-metal-node-alerts-item")
      .map((item: HTMLElement) => {
        return item.textContent;
      })
      .join(" ");

    for (const name of [
      "Bare Metal Node in Error",
      "Bare Metal Node Stuck Transitioning",
      "Bare Metal Node in Maintenance Too Long",
      "Bare Metal Power State Unexpected",
    ]) {
      expect(alerts).toContain(name);
    }
  });
});

describe("a node's page, with its power off, on what a real cloud said", () => {
  const NODE_POWERED_OFF: string = "0fa2c1b5-0a80-4b59-9f14-a98f8e919d1d";

  test("deployed with its power off needs someone, and it knows of no instance on it", async () => {
    server.rows = recorded("power-off-while-active", WITH_SYSTEM_SCOPE);

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", NODE_POWERED_OFF),
    );

    expect(
      await screen.findByTestId("openstack-bare-metal-node-explanation"),
    ).toHaveTextContent(/power off/);
    expect(attentionRowsOf("openstack-bare-metal-node-attention")).toEqual([
      "This node: Deployed, with its power off",
    ]);
    expect(
      screen.queryByTestId("openstack-bare-metal-node-details-instance"),
    ).toBeNull();
  });

  test("its power on again, it needs nobody", async () => {
    server.rows = recorded("recovered", WITH_SYSTEM_SCOPE);

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", NODE_POWERED_OFF),
    );

    await screen.findByTestId("openstack-bare-metal-node-hero");

    expect(
      screen.queryByTestId("openstack-bare-metal-node-explanation"),
    ).toBeNull();
    expect(attentionRowsOf("openstack-bare-metal-node-attention")).toEqual([]);
  });
});

describe("what no recording holds, on rows written by hand", () => {
  test("a probe's page: why it failed, what it runs on, and that Ironic has emptied it", async () => {
    probeCollected();
    server.rows = [
      apiRow(),
      nodeRow({
        status: "clean failed",
        facts: {
          powerState: "power off",
          resourceClass: "gold",
          driver: "ipmi",
          conductor: "conductor-1",
          conductorGroup: "rack-a",
          fault: "clean failure",
          lastError: "the BMC would not answer",
          lastErrorReadAt: minutesAgo(30).toISOString(),
        },
      }),
    ];

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", NODE_ID),
    );

    const lastError: HTMLElement = await screen.findByTestId(
      "openstack-bare-metal-node-last-error",
    );

    expect(lastError).toHaveTextContent("the BMC would not answer");
    expect(lastError).toHaveTextContent(/emptied last_error/);
    expect(
      screen.queryByTestId("openstack-bare-metal-node-no-reason"),
    ).toBeNull();
    expect(
      screen.getByTestId("openstack-bare-metal-node-details-driver"),
    ).toHaveTextContent("ipmi");
    expect(
      screen.getByTestId("openstack-bare-metal-node-details-conductor"),
    ).toHaveTextContent("conductor-1");
    expect(
      screen.getByTestId("openstack-bare-metal-node-details-fault"),
    ).toHaveTextContent("clean failure");
  });

  test("text from outside is drawn as text", async () => {
    server.rows = [
      apiRow(),
      nodeRow({
        status: "clean failed",
        adminState: OPENSTACK_BARE_METAL_IN_MAINTENANCE,
        disabledReason: "<img src=x onerror=alert(1)>",
        facts: {
          resourceClass: "gold",
          driver: "ipmi",
          lastError: "<script>alert(2)</script>",
          lastErrorReadAt: minutesAgo(3).toISOString(),
        },
      }),
    ];

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", NODE_ID),
    );

    expect(
      await screen.findByTestId("openstack-bare-metal-node-last-error"),
    ).toHaveTextContent("<script>alert(2)</script>");
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  test("deployed with its power off needs someone, with the instance on it named", async () => {
    server.rows = [
      apiRow(),
      nodeRow({
        status: "active",
        facts: { powerState: "power off", resourceClass: "gold" },
      }),
      instanceRow("ACTIVE"),
    ];

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", NODE_ID),
    );

    expect(
      await screen.findByTestId("openstack-bare-metal-node-explanation"),
    ).toHaveTextContent(/power off/);
    expect(attentionRowsOf("openstack-bare-metal-node-attention")).toEqual([
      "This node: Deployed, with its power off",
    ]);
    expect(
      await screen.findByTestId("openstack-bare-metal-node-details-instance"),
    ).toHaveTextContent("metal-web-01");
  });

  test("the same node under an instance someone stopped is planned, and says the alert can't tell", async () => {
    server.rows = [
      apiRow(),
      nodeRow({
        status: "active",
        facts: { powerState: "power off", resourceClass: "gold" },
      }),
      instanceRow("SHUTOFF"),
    ];

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", NODE_ID),
    );

    expect(
      await screen.findByTestId("openstack-bare-metal-node-stopped"),
    ).toHaveTextContent(/planned/);
    expect(attentionRowsOf("openstack-bare-metal-node-attention")).toEqual([]);
    expect(
      screen.queryByTestId("openstack-bare-metal-node-explanation"),
    ).toBeNull();
  });

  test("Ironic's own time moving means a long clean is no node stuck", async () => {
    server.rows = [
      apiRow(),
      nodeRow({
        status: "clean wait",
        stateChangedAt: minutesAgo(600),
        facts: {
          powerState: "power on",
          resourceClass: "gold",
          provisionUpdatedAt: minutesAgo(3).toISOString(),
        },
      }),
    ];

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    expect(
      within(
        await screen.findByText("clean wait").then((cell: HTMLElement) => {
          return cell.closest("tr") as HTMLElement;
        }),
      ).queryByText("Stuck"),
    ).toBeNull();
  });

  test("and it not moving means one is, however late anyone noticed", async () => {
    server.rows = [
      apiRow(),
      nodeRow({
        status: "deploying",
        stateChangedAt: minutesAgo(1),
        facts: {
          powerState: "power on",
          resourceClass: "gold",
          provisionUpdatedAt: minutesAgo(300).toISOString(),
        },
      }),
    ];

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    expect(await screen.findByText("Stuck")).toBeInTheDocument();
  });

  test("a machine running OneUptime's agent under a node's name links to its host", async () => {
    server.rows = [apiRow(), nodeRow()];
    server.records["Host"] = [
      {
        _id: "cccccccc-3333-4333-8333-000000000001",
        name: "node-1",
        hostIdentifier: "node-1",
      },
    ];

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", NODE_ID),
    );

    expect(
      await screen.findByTestId("openstack-bare-metal-node-details-host"),
    ).toHaveTextContent("node-1");
  });

  test("two hosts it could be link to neither, as nothing here guesses", async () => {
    server.rows = [apiRow(), nodeRow()];
    server.records["Host"] = [
      { _id: "cccccccc-3333-4333-8333-000000000001", name: "node-1" },
      { _id: "cccccccc-3333-4333-8333-000000000002", name: "node-1" },
    ];

    await renderPage(
      OpenStackCloudBareMetalNodeDetail,
      partPath("bare-metal", NODE_ID),
    );
    await screen.findByTestId("openstack-bare-metal-node-details");

    expect(
      screen.queryByTestId("openstack-bare-metal-node-details-host"),
    ).toBeNull();
  });

  test("a node can be nameless: it reads by its ID", async () => {
    server.rows = [apiRow(), nodeRow({ name: undefined })];

    await renderPage(OpenStackCloudBareMetalNodes, "/bare-metal");

    expect(await screen.findByText(NODE_ID)).toBeInTheDocument();
  });
});

describe("the Services page", () => {
  test("Ironic has a card where it reports, saying the agent can't list its conductors", async () => {
    server.rows = [apiRow()];

    await renderPage(OpenStackCloudServices, "/services");

    const card: HTMLElement = (
      await screen.findAllByTestId("openstack-service-group")
    ).find((one: HTMLElement) => {
      return one.getAttribute("data-service") === "baremetal";
    }) as HTMLElement;

    expect(card).toHaveTextContent("Bare Metal (Ironic)");
    expect(
      within(card).getByTestId("openstack-service-group-workers-not-listed"),
    ).toHaveTextContent(/no series for Ironic's conductors/);
  });

  test("a probe refused them says so, and that its nodes read without them", async () => {
    probeCollected();
    server.rows = [apiRow()];

    await renderPage(OpenStackCloudServices, "/services");

    expect(
      await screen.findByTestId("openstack-service-group-workers-not-listed"),
    ).toHaveTextContent(/baremetal:conductor:get/);
  });

  test("conductors a probe reads are workers like any other, and a dead one is down", async () => {
    probeCollected();
    server.rows = [
      apiRow(),
      {
        _id: id(),
        kind: OpenStackResourceKind.Service,
        externalId: "RegionOne/baremetal/conductor-1/ironic-conductor",
        name: "ironic-conductor",
        regionName: "RegionOne",
        status: "down",
        stateChangedAt: minutesAgo(10),
        lastSeenAt: minutesAgo(1),
        facts: { family: "baremetal", host: "conductor-1" },
      },
    ];

    await renderPage(OpenStackCloudServices, "/services");

    const card: HTMLElement = await screen.findByTestId(
      "openstack-service-group",
    );

    expect(card).toHaveTextContent("ironic-conductor");
    expect(card).toHaveTextContent("conductor-1");
    expect(card.getAttribute("data-health")).toBe("Unhealthy");
    expect(
      screen.queryByTestId("openstack-service-group-workers-not-listed"),
    ).toBeNull();
  });

  test("gone quiet reads Quiet, never up in green and never down", async () => {
    server.rows = [apiRow({ lastSeenAt: minutesAgo(45) })];

    await renderPage(OpenStackCloudServices, "/services");

    const api: HTMLElement = await screen.findByTestId("openstack-service-api");

    expect(api).toHaveTextContent("Quiet");
    expect(api).not.toHaveTextContent(/\bdown\b/);
  });

  test("a cloud without Ironic has no card for it, on a recording of one", async () => {
    server.rows = new OpenStackRecording("gazpacho-ovs", "healthy").rows.map(
      (row: OpenStackResource): Row => {
        return { ...row, _id: id() } as Row;
      },
    );

    await renderPage(OpenStackCloudServices, "/services");

    const cards: Array<HTMLElement> = await screen.findAllByTestId(
      "openstack-service-group",
    );

    expect(
      cards.filter((card: HTMLElement) => {
        return card.getAttribute("data-service") === "baremetal";
      }),
    ).toEqual([]);
  });
});

describe("a cloud without Ironic shows no trace of it", () => {
  function menu(
    optionalServices: Array<OpenStackServiceType> | undefined,
  ): void {
    render(
      <MemoryRouter>
        <OpenStackCloudSideMenu
          modelId={new ObjectID(CLOUD_ID)}
          resourceCounts={{
            hypervisors: 2,
            optionalServices,
            bareMetalNodes: optionalServices?.length ? 5 : 0,
          }}
        />
      </MemoryRouter>,
    );
  }

  test.each([[[]], [undefined], [[OpenStackServiceType.Orchestration]]])(
    "the menu has no section, with services %s",
    async (optionalServices: Array<OpenStackServiceType> | undefined) => {
      menu(optionalServices);
      await settle();

      expect(screen.queryByText("Bare Metal")).toBeNull();
    },
  );

  test("a cloud running it does, with its count", async () => {
    menu([OpenStackServiceType.BareMetal]);
    await settle();

    expect(await screen.findByText("Bare Metal")).toBeInTheDocument();
    expect(screen.getByText("Nodes")).toBeInTheDocument();
  });
});
