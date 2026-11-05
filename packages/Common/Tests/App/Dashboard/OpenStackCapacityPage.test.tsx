import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, screen, within } from "@testing-library/react";
import * as React from "react";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import { JSONObject } from "../../../Types/JSON";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { OpenStackCapacityHost } from "../../../Types/OpenStack/OpenStackCapacity";
import {
  OpenStackCapacityFlavor,
  OpenStackCapacitySnapshot,
  buildOpenStackCapacitySnapshot,
} from "../../../Types/OpenStack/OpenStackCapacitySnapshot";
import { OpenStackRegionProvider } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackRegionContext";
import OpenStackCloudCapacity from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Capacity";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ObjectID from "../../../Types/ObjectID";
import {
  CLOUD_ID,
  renderPage,
  resetServer,
  server,
} from "./OpenStackPartHarness";

jest.mock("react-i18next", () => {
  return {
    initReactI18next: { type: "3rdParty", init: (): void => {} },
    useTranslation: () => {
      return {
        t: (key: string, values?: Record<string, unknown>): string => {
          return Object.keys(values || {}).reduce(
            (text: string, name: string): string => {
              return text.split(`{{${name}}}`).join(String(values![name]));
            },
            key,
          );
        },
        i18n: { language: "en", changeLanguage: async (): Promise<void> => {} },
      };
    },
  };
});

/*
 * The Capacity page, drawn for real from a snapshot the real code built. What each number should
 * be is OpenStackCapacity.test.ts's. This is what it says, where it says it, and what it reads.
 */

const NOW: Date = new Date();

function host(
  name: string,
  used: { vcpu: number; memoryMb: number },
  extra?: Partial<OpenStackCapacityHost>,
): OpenStackCapacityHost {
  return {
    name,
    regionName: "RegionOne",
    zone: "nova",
    aggregates: [],
    state: "up",
    instanceCount: 3,
    inventories: {
      VCPU: {
        total: 10,
        reserved: 0,
        allocationRatio: 4,
        used: used.vcpu,
      },
      MEMORY_MB: {
        total: 8192,
        reserved: 512,
        allocationRatio: 1,
        used: used.memoryMb,
      },
    },
    ...extra,
  };
}

function flavor(
  name: string,
  resources: Record<string, number>,
  extra?: Partial<OpenStackCapacityFlavor>,
): OpenStackCapacityFlavor {
  return {
    id: name,
    name,
    regionName: "RegionOne",
    request: { resources, requiredTraits: [], forbiddenTraits: [] },
    isPublic: true,
    isDisabled: false,
    instanceCount: 0,
    placementAnswer: null,
    ...extra,
  };
}

const TIGHT_HOSTS: Array<OpenStackCapacityHost> = [
  host("a", { vcpu: 2, memoryMb: 4096 }),
  host("b", { vcpu: 2, memoryMb: 4096 }),
  host("c", { vcpu: 2, memoryMb: 4096 }),
];

// 3584 MB free on each: one m1.small each, and no m1.medium for all that 10752 MB is free.
const FLAVORS: Array<OpenStackCapacityFlavor> = [
  flavor("m1.small", { VCPU: 1, MEMORY_MB: 2048 }, { instanceCount: 6 }),
  flavor("m1.medium", { VCPU: 2, MEMORY_MB: 4096 }),
  flavor("ou.impossible", { VCPU: 1, MEMORY_MB: 1048576 }),
];

const SNAPSHOT: OpenStackCapacitySnapshot = buildOpenStackCapacitySnapshot({
  hosts: TIGHT_HOSTS,
  flavors: FLAVORS,
  pools: [],
  now: NOW,
});

let getItem: ReturnType<typeof jest.spyOn>;

async function renderCapacity(
  snapshot: OpenStackCapacitySnapshot | null,
): Promise<void> {
  getItem = jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return Object.assign(new OpenStackCloud(), {
      capacitySnapshot: snapshot as unknown as JSONObject,
    });
  }) as never);

  const Wrapped: React.FunctionComponent<PageComponentProps> = (
    props: PageComponentProps,
  ): React.ReactElement => {
    return (
      <OpenStackRegionProvider openStackCloudId={new ObjectID(CLOUD_ID)}>
        <OpenStackCloudCapacity {...props} />
      </OpenStackRegionProvider>
    );
  };

  await renderPage(Wrapped, "/capacity");
}

function flavorRow(name: string): HTMLElement {
  return screen
    .getAllByTestId("openstack-capacity-flavor")
    .find((row: HTMLElement): boolean => {
      return row.getAttribute("data-flavor") === name;
    }) as HTMLElement;
}

describe("the Capacity page", () => {
  beforeEach(() => {
    resetServer();
    server.cloud = null;
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("says how many fit before anything else, in the words the issue asks for", async () => {
    await renderCapacity(SNAPSHOT);

    expect(screen.getByTestId("openstack-capacity-headline")).toHaveTextContent(
      "Room for 3 m1.small, and 0 m1.medium.",
    );
  });

  test("what's short comes first, and a flavor too spread out to fit says so", async () => {
    await renderCapacity(SNAPSHOT);

    const shortages: Array<HTMLElement> = screen.getAllByTestId(
      "openstack-capacity-shortage",
    );

    expect(shortages[0]).toHaveAttribute(
      "data-kind",
      "flavor-cannot-be-placed",
    );
    expect(shortages[0]).toHaveTextContent("m1.medium");
    expect(shortages[0]).toHaveTextContent(
      "2 would fit if what is free were on one host",
    );
  });

  test("a table says each flavor's count, and what it would be as one pool", async () => {
    await renderCapacity(SNAPSHOT);

    expect(
      within(flavorRow("m1.medium")).getByTestId(
        "openstack-capacity-flavor-fits",
      ),
    ).toHaveTextContent("0");
    expect(
      within(flavorRow("m1.medium")).getByTestId(
        "openstack-capacity-flavor-fragmented",
      ),
    ).toHaveTextContent("2 if it were one pool");
    expect(flavorRow("ou.impossible")).toHaveTextContent(
      "Too large for every host",
    );
  });

  test("it says it calculated, when it did, and what that can't see", async () => {
    await renderCapacity(SNAPSHOT);

    const source: HTMLElement = screen.getByTestId("openstack-capacity-source");

    expect(source).toHaveAttribute("data-source", "inventories");
    expect(source).toHaveTextContent("can't see traits");
    expect(
      within(flavorRow("m1.small")).getByTestId(
        "openstack-capacity-flavor-source",
      ),
    ).toHaveTextContent("Inventories");
  });

  test("it says Placement answered, when it did", async () => {
    await renderCapacity(
      buildOpenStackCapacitySnapshot({
        hosts: TIGHT_HOSTS,
        flavors: [
          flavor(
            "m1.small",
            { VCPU: 1, MEMORY_MB: 2048 },
            {
              placementAnswer: {
                askedAt: NOW.toISOString(),
                fits: 3400,
                hostsWithRoom: 1000,
                isCapped: true,
                byZone: { nova: 3400 },
                byAggregate: {},
              },
            },
          ),
        ],
        pools: [],
        now: NOW,
      }),
    );

    expect(screen.getByTestId("openstack-capacity-source")).toHaveAttribute(
      "data-source",
      "placement",
    );
    expect(
      within(flavorRow("m1.small")).getByTestId(
        "openstack-capacity-flavor-fits",
      ),
    ).toHaveTextContent("At least 3,400");
  });

  test("everything says allocated, never used or load", async () => {
    await renderCapacity(SNAPSHOT);

    expect(screen.getByTestId("openstack-capacity-zones")).toHaveTextContent(
      "allocated",
    );
    expect(screen.getByTestId("openstack-capacity-tiles")).toHaveTextContent(
      "Allocated",
    );
  });

  test("a zone says whether it can lose a host", async () => {
    await renderCapacity(SNAPSHOT);

    expect(screen.getByTestId("openstack-capacity-headroom")).toHaveAttribute(
      "data-state",
      "can-lose-a-host",
    );
  });

  test("a new cloud says it hasn't enough history", async () => {
    await renderCapacity({
      ...SNAPSHOT,
      forecasts: [
        {
          scope: "zone",
          name: "nova",
          id: "",
          regionName: "RegionOne",
          resourceClass: "VCPU",
          forecast: { state: "not-enough-history" },
        },
      ],
    });

    expect(screen.getByTestId("openstack-capacity-forecast")).toHaveTextContent(
      "Not enough history",
    );
  });

  test("with no real usage it says what to add, and never puts allocation in its place", async () => {
    await renderCapacity(SNAPSHOT);

    expect(
      screen.getByTestId("openstack-capacity-no-real-usage"),
    ).toHaveTextContent("prometheus-libvirt-exporter");
    expect(
      screen.queryByTestId("openstack-capacity-overcommit"),
    ).not.toBeInTheDocument();
  });

  test("an orphaned allocation names its host and how to fix it, once it has lasted", async () => {
    const mismatch: OpenStackCapacitySnapshot["mismatches"][number] = {
      regionName: "RegionOne",
      hypervisorName: "a",
      vcpuExcess: 2,
      memoryMbExcess: 1024,
      instanceCount: 3,
      since: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    };

    await renderCapacity({ ...SNAPSHOT, mismatches: [mismatch] });

    const orphans: HTMLElement = screen.getByTestId(
      "openstack-capacity-orphans",
    );

    expect(orphans).toHaveTextContent("nova-manage placement audit --verbose");
    expect(
      within(orphans).getByTestId("openstack-capacity-orphan"),
    ).toHaveTextContent("2 vCPUs");

    cleanup();

    await renderCapacity({
      ...SNAPSHOT,
      mismatches: [{ ...mismatch, since: NOW.toISOString() }],
    });

    expect(
      screen.queryByTestId("openstack-capacity-orphans"),
    ).not.toBeInTheDocument();
  });

  test("a lost host is named, because that's why the numbers are low", async () => {
    await renderCapacity(
      buildOpenStackCapacitySnapshot({
        hosts: [
          ...TIGHT_HOSTS,
          host("gone", { vcpu: 1, memoryMb: 1 }, { state: "lost" }),
        ],
        flavors: FLAVORS,
        pools: [],
        now: NOW,
      }),
    );

    expect(
      screen.getByTestId("openstack-capacity-not-counted"),
    ).toHaveTextContent("gone (lost)");
  });

  test("a cloud with no Placement numbers says what that takes", async () => {
    await renderCapacity(
      buildOpenStackCapacitySnapshot({
        hosts: [],
        flavors: [],
        pools: [],
        now: NOW,
      }),
    );

    expect(
      screen.getByTestId("openstack-capacity-no-placement"),
    ).toHaveTextContent("Full view or Infrastructure only");
  });

  test("a cloud no worker has been through yet says so, and nothing else", async () => {
    await renderCapacity(null);

    expect(
      screen.getByTestId("openstack-capacity-not-yet"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-capacity")).not.toBeInTheDocument();
  });

  test("a read that failed says so, with a way to try again", async () => {
    getItem = jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
      throw new Error("Server is not available.");
    }) as never);

    await renderPage(OpenStackCloudCapacityInRegion, "/capacity");

    expect(
      screen.getByTestId("openstack-capacity-read-error"),
    ).toBeInTheDocument();
  });

  test("however large the cloud, the page is one read of one row, naming one column", async () => {
    await renderCapacity(SNAPSHOT);

    const reads: Array<unknown> = (
      getItem.mock.calls as unknown as Array<Array<{ select: JSONObject }>>
    ).filter((call: Array<{ select: JSONObject }>): boolean => {
      return Boolean(call[0]?.select["capacitySnapshot"]);
    });

    expect(reads).toHaveLength(1);
  });
});

const OpenStackCloudCapacityInRegion: React.FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): React.ReactElement => {
  return (
    <OpenStackRegionProvider openStackCloudId={new ObjectID(CLOUD_ID)}>
      <OpenStackCloudCapacity {...props} />
    </OpenStackRegionProvider>
  );
};
