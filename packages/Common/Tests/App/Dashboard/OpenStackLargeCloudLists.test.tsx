import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, configure, fireEvent, screen } from "@testing-library/react";
import * as React from "react";
import Includes from "../../../Types/BaseDatabase/Includes";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import { JSONObject } from "../../../Types/JSON";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import OpenStackCloudInstances from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Instances";
import OpenStackCloudVolumes from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Volumes";
import { seededRandom } from "../../Helpers/SeededRandom";
import {
  ListCall,
  Row,
  kindCalls,
  renderPage,
  resetServer,
  server,
  settle,
} from "./OpenStackPartHarness";

/*
 * A cloud with 100,000 instances, because large clouds hold hundreds of thousands, and a
 * list that reads a kind whole into the browser works in every test until the day a real
 * operator opens it. The stand-in server holds all of them and answers each read the way
 * the real one does, so what these prove is what the page asks for: a page at a time, each
 * filter applied by the server, and names looked up only for the rows on screen.
 */

configure({ asyncUtilTimeout: 60000 });

jest.setTimeout(600000);

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

const INSTANCES: number = 100000;
const HYPERVISORS: number = 2000;
const PROJECTS: number = 500;
const FLAVORS: number = 20;
const ZONES: number = 4;
const STUCK: number = 37;
const FAILED: number = 412;

// The most rows any one read of a list may ask for: a list's largest page.
const PAGE_LIMIT: number = 100;

const STATUSES: Array<string> = ["ACTIVE", "ACTIVE", "ACTIVE", "SHUTOFF"];

function pad(value: number): string {
  return String(value).padStart(6, "0");
}

let estate: Array<Row> = [];

beforeAll(() => {
  const random: (limit: number) => number = seededRandom(5726) as (
    limit: number,
  ) => number;
  const rows: Array<Row> = [];

  for (let index: number = 0; index < INSTANCES; index++) {
    const status: string =
      index < STUCK
        ? "BUILD"
        : index < STUCK + FAILED
          ? "ERROR"
          : STATUSES[random(STATUSES.length)]!;
    rows.push({
      _id: `6c1b2a3d-4e5f-4a6b-8c7d-${String(index).padStart(12, "0")}`,
      kind: OpenStackResourceKind.Instance,
      name: `vm-${pad(index)}`,
      externalId: `instance-${pad(index)}`,
      regionName: index % 2 === 0 ? "RegionOne" : "RegionTwo",
      availabilityZone: `az${index % ZONES}`,
      hypervisorName: `compute-${pad(index % HYPERVISORS)}.example`,
      openStackProjectId: `project-${pad(index % PROJECTS)}`,
      status,
      stateChangedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      facts: { flavorId: `flavor-${index % FLAVORS}` },
    });
  }

  for (let index: number = 0; index < PROJECTS; index++) {
    rows.push({
      kind: OpenStackResourceKind.Project,
      name: `Project ${index}`,
      externalId: `project-${pad(index)}`,
    });
  }

  for (let index: number = 0; index < FLAVORS; index++) {
    for (const region of ["RegionOne", "RegionTwo"]) {
      rows.push({
        kind: OpenStackResourceKind.Flavor,
        name: `Size ${index}`,
        externalId: `${region}/flavor-${index}`,
        regionName: region,
      });
    }
  }

  estate = rows;
});

beforeEach(() => {
  resetServer();
  server.rows = estate;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function listCallsOfInstances(): Array<ListCall> {
  return kindCalls(OpenStackResourceKind.Instance);
}

function expectEveryReadToBeAPage(): void {
  for (const call of server.listCalls) {
    if (call.model !== "OpenStackResource") {
      continue;
    }
    if (call.kind === OpenStackResourceKind.Instance) {
      expect(call.limit).toBeLessThanOrEqual(PAGE_LIMIT);
    } else {
      // Names for the rows on screen, or a chip's few choices: never a whole kind.
      expect(call.limit).toBeLessThanOrEqual(500);
    }
  }
}

function withFacets(path: string, selections: Record<string, Array<string>>): string {
  const params: Record<string, string> = TableFilterUrlState.getLinkQueryParams(
    "openstack-instances-table",
    {
      facets: { facetSelections: selections } as unknown as JSONObject,
    },
  );
  return `${path}?${Object.keys(params)
    .map((key: string): string => {
      return `${key}=${params[key]}`;
    })
    .join("&")}`;
}

function paging(): string {
  return screen.getByTestId("pagination-summary").textContent || "";
}

describe("a cloud with 100,000 instances", () => {
  test("the Instances list reads one page, and says how many there are", async () => {
    await renderPage(OpenStackCloudInstances, "/instances");

    expect(await screen.findByText("vm-000000")).toBeInTheDocument();
    expect(paging()).toMatch(/100,?000/);
    expect(document.querySelectorAll("tbody tr").length).toBeLessThanOrEqual(
      PAGE_LIMIT,
    );
    expectEveryReadToBeAPage();
    expect(
      listCallsOfInstances().every((call: ListCall) => {
        return call.skip === 0;
      }),
    ).toBe(true);
  });

  test("names are looked up only for the rows on the page", async () => {
    await renderPage(OpenStackCloudInstances, "/instances");
    await screen.findByText("vm-000000");
    await settle();

    const page: number = listCallsOfInstances()[0]!.limit;
    const projects: Array<ListCall> = kindCalls(
      OpenStackResourceKind.Project,
    ).filter((call: ListCall) => {
      return call.query["externalId"] instanceof Includes;
    });
    expect(projects).toHaveLength(1);
    expect(
      (projects[0]!.query["externalId"] as Includes).values.length,
    ).toBeLessThanOrEqual(page);
    expect(projects[0]!.limit).toBeLessThanOrEqual(page);

    const flavors: Array<ListCall> = kindCalls(OpenStackResourceKind.Flavor);
    expect(flavors).toHaveLength(1);
    expect(flavors[0]!.limit).toBeLessThanOrEqual(page);
  });

  test("the next page is a read of the next page, never the whole kind", async () => {
    await renderPage(OpenStackCloudInstances, "/instances");
    await screen.findByText("vm-000000");
    const firstPage: number = listCallsOfInstances()[0]!.limit;

    fireEvent.click(screen.getByTestId("pagination-next-button"));
    await settle();

    expect(
      await screen.findByText(`vm-${pad(firstPage)}`),
    ).toBeInTheDocument();
    expect(screen.queryByText("vm-000000")).not.toBeInTheDocument();
    const last: ListCall = listCallsOfInstances().pop() as ListCall;
    expect(last.skip).toBe(firstPage);
    expect(last.limit).toBe(firstPage);
    expectEveryReadToBeAPage();
  });

  test.each<[string, Record<string, Array<string>>, string, (call: ListCall) => void, number]>([
    [
      "status",
      { status: ["ERROR"] },
      "ERROR",
      (call: ListCall): void => {
        expect(call.query["status"]).toBeInstanceOf(Includes);
      },
      FAILED,
    ],
    [
      "project",
      { openStackProjectId: ["project-000007"] },
      "project",
      (call: ListCall): void => {
        expect(
          (call.query["openStackProjectId"] as Includes).values,
        ).toEqual(["project-000007"]);
      },
      INSTANCES / PROJECTS,
    ],
    [
      "hypervisor",
      { hypervisorName: ["compute-000007.example"] },
      "hypervisor",
      (call: ListCall): void => {
        expect((call.query["hypervisorName"] as Includes).values).toEqual([
          "compute-000007.example",
        ]);
      },
      INSTANCES / HYPERVISORS,
    ],
    [
      "availability zone",
      { availabilityZone: ["az2"] },
      "zone",
      (call: ListCall): void => {
        expect((call.query["availabilityZone"] as Includes).values).toEqual([
          "az2",
        ]);
      },
      INSTANCES / ZONES,
    ],
    [
      "flavor",
      { flavor: ["flavor-3"] },
      "flavor",
      (call: ListCall): void => {
        expect((call.query["facts"] as JSONObject)["flavorId"]).toBe(
          "flavor-3",
        );
      },
      INSTANCES / FLAVORS,
    ],
  ])(
    "filtering by %s goes to the server, and pages what it answers",
    async (
      _name: string,
      selections: Record<string, Array<string>>,
      _word: string,
      check: (call: ListCall) => void,
      expected: number,
    ) => {
      await renderPage(
        OpenStackCloudInstances,
        withFacets("/instances", selections),
      );
      await settle();

      const calls: Array<ListCall> = listCallsOfInstances();
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        check(call);
      }
      expect(await screen.findByTestId("pagination-summary")).toHaveTextContent(
        new RegExp(expected.toLocaleString("en-US").replace(",", ",?")),
      );
      expectEveryReadToBeAPage();
    },
  );

  test("the region a cloud's pages are on goes to the server, and pages what it answers", async () => {
    await renderPage(OpenStackCloudInstances, "/instances?region=RegionTwo");
    await settle();

    const calls: Array<ListCall> = listCallsOfInstances();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.query["regionName"]).toBe("RegionTwo");
    }
    expect(await screen.findByTestId("pagination-summary")).toHaveTextContent(
      /50,?000/,
    );
    expectEveryReadToBeAPage();
  });

  test("a link opened on a project asks for that project from the first read, one read, and lights the chip", async () => {
    await renderPage(OpenStackCloudInstances, "/instances?project=project-000007");
    await settle();

    const calls: Array<ListCall> = listCallsOfInstances();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect((call.query["openStackProjectId"] as Includes).values).toEqual([
        "project-000007",
      ]);
    }
    expect(await screen.findByTestId("pagination-summary")).toHaveTextContent(
      new RegExp(String(INSTANCES / PROJECTS)),
    );
    expect(window.location.search).toContain("project=project-000007");
    // Named in the chip, so it can be seen and cleared there.
    expect(screen.getByText(/Project 7/)).toBeInTheDocument();
  });

  test("asking for stuck instances is the rules' words and line, answered by the server", async () => {
    await renderPage(
      OpenStackCloudInstances,
      withFacets("/instances", { state: ["stuck"] }),
    );
    await settle();

    const call: ListCall = listCallsOfInstances().pop() as ListCall;
    expect((call.query["status"] as Includes).values).toContain("BUILD");
    expect(call.query["stateChangedAt"]).toBeInstanceOf(LessThanOrEqual);
    expect(await screen.findByTestId("pagination-summary")).toHaveTextContent(
      String(STUCK),
    );
    expect(await screen.findAllByText("Stuck")).not.toHaveLength(0);
  });

  test("asking for those in error, with a status chip beside it, doesn't write the chip over", async () => {
    await renderPage(
      OpenStackCloudInstances,
      withFacets("/instances", { state: ["error"], status: ["SHUTOFF"] }),
    );
    await settle();

    const call: ListCall = listCallsOfInstances().pop() as ListCall;
    expect((call.query["status"] as Includes).values).toEqual(["SHUTOFF"]);
  });

  test("a search goes to the server too", async () => {
    await renderPage(OpenStackCloudInstances, "/instances");
    await screen.findByText("vm-000000");
    const before: number = listCallsOfInstances().length;

    fireEvent.change(screen.getByPlaceholderText("Search by name or ID"), {
      target: { value: "vm-099999" },
    });

    expect(await screen.findByText("vm-099999")).toBeInTheDocument();
    const after: Array<ListCall> = listCallsOfInstances().slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after[after.length - 1]!.query["_multiFieldSearch"]).toBeDefined();
    expectEveryReadToBeAPage();
  });

  test("sorting by how long in its state is the server's, on a real column", async () => {
    await renderPage(OpenStackCloudInstances, "/instances");
    await screen.findByText("vm-000000");

    fireEvent.click(await screen.findByText("In state for"));
    await settle();

    const call: ListCall = listCallsOfInstances().pop() as ListCall;
    expect(Object.keys(call.sort)).toEqual(["stateChangedAt"]);
    expect(call.limit).toBeLessThanOrEqual(PAGE_LIMIT);
  });

  test("the volume types over a list come from one count, with no volume read for them", async () => {
    server.rows = [
      ...estate,
      {
        _id: "6c1b2a3d-4e5f-4a6b-8c7d-999999999999",
        kind: OpenStackResourceKind.Volume,
        name: "one-volume",
        externalId: "v-1",
        status: "in-use",
        facts: { volumeType: "ceph" },
      },
    ];

    await renderPage(OpenStackCloudVolumes, "/volumes");
    await screen.findByText("one-volume");

    expect(
      server.postCalls.filter((call: { path: string }) => {
        return call.path.includes("/counts/");
      }).length,
    ).toBeGreaterThan(0);
    expect(listCallsOfInstances()).toEqual([]);
  });
});
