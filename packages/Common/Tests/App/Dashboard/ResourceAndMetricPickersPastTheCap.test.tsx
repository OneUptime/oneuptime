import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import CappedListServer, { namesSortingFirst } from "./CappedListServer";
import useInfrastructureResources, {
  INFRASTRUCTURE_RESOURCE_SEARCH_LIMIT,
  InfrastructureResources,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/InfrastructureMonitorSetup/UseInfrastructureResources";
import MetricQuery from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQuery";
import MetricTypeSearch, {
  METRIC_TYPE_SEARCH_LIMIT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricTypeSearch";
import {
  readSloMetricType,
  SLO_METRIC_SEARCH_LIMIT,
  searchSloMetricTypes,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SloMetricQueryFields";
import Host from "../../../Models/DatabaseModels/Host";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Includes from "../../../Types/BaseDatabase/Includes";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import MetricQueryData from "../../../Types/Metrics/MetricQueryData";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/useServiceNames",
  () => {
    return {
      __esModule: true,
      default: (): Record<string, unknown> => {
        return { serviceNames: [], isLoading: false };
      },
    };
  },
);

/*
 * AN INFRASTRUCTURE MONITOR'S RESOURCE, A METRIC QUERY'S METRIC AND AN SLO'S
 * METRIC, PAST WHAT THEIR PICKERS READ (#10646).
 *
 * - An infrastructure monitor's Resource field offered the project's first
 *   10,000 hosts (clusters, vCenters ...) by name, archived ones among
 *   them: a host past them could not be picked, and one a step watched
 *   showed as nothing picked.
 * - A metric query's picker offered the project's first 10,000 metric
 *   names, an SLO's the first 500: one Kubernetes cluster sends more than
 *   that. A metric past the list could not be found, and one a query
 *   charted showed as no metric at all.
 *
 * Each asks the server for what is typed into it now, and reads what it
 * holds by its value. ModelAPI answers from a project faked whole
 * (CappedListServer).
 */

const LATE_HOST: string = "host-WB1500KSK02";
const ARCHIVED_HOST: string = "host-WB-retired";
const LATE_METRIC: string = "k8s.pod.WB.network.io";

const BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

let server: CappedListServer;

beforeEach(() => {
  server = new CappedListServer();

  server.add(
    Host,
    namesSortingFirst(BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          name: name,
          hostIdentifier: `host-${name}`,
          isArchived: false,
        };
      },
    ),
  );
  server.add(Host, [
    {
      _id: ObjectID.generate().toString(),
      name: "WB1500KSK02",
      hostIdentifier: LATE_HOST,
      isArchived: false,
      lastSeenAt: new Date("2026-11-22T00:00:00.000Z"),
    },
    {
      _id: ObjectID.generate().toString(),
      name: "WB-retired",
      hostIdentifier: ARCHIVED_HOST,
      isArchived: true,
    },
  ]);
  server.add(
    MetricType,
    namesSortingFirst(BEFORE_WB, "k8s.a").map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(MetricType, [
    { _id: ObjectID.generate().toString(), name: LATE_METRIC, unit: "By" },
  ]);
  server.install();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const renderHosts: (heldValue?: string | undefined) => {
  result: { current: InfrastructureResources<Host> };
} = (
  heldValue?: string | undefined,
): { result: { current: InfrastructureResources<Host> } } => {
  return renderHook(() => {
    return useInfrastructureResources<Host>({
      modelType: Host,
      select: { _id: true, name: true, hostIdentifier: true, lastSeenAt: true },
      toOption: (host: Host): DropdownOption => {
        return {
          label: host.name || host.hostIdentifier || "Unknown",
          value: host.hostIdentifier || "",
        };
      },
      getLastSeenAt: (host: Host): Date | undefined => {
        return host.lastSeenAt;
      },
      valueField: "hostIdentifier",
      searchFields: ["name", "hostIdentifier"],
      heldValue: heldValue,
    });
  });
};

function optionValues(resources: InfrastructureResources<Host>): Array<string> {
  return resources.options.map((option: DropdownOption): string => {
    return String(option.value);
  });
}

describe("an infrastructure monitor's Resource field", () => {
  test("offers no archived host, and the host a step watches past the 10,000th is named, read by its value", async () => {
    const hook: { result: { current: InfrastructureResources<Host> } } =
      renderHosts(LATE_HOST);

    await waitFor(() => {
      expect(optionValues(hook.result.current)).toContain(LATE_HOST);
    });

    // The list asked for live hosts only.
    expect(server.callsFor(Host)[0]!.query["isArchived"]).toBe(false);
    expect(optionValues(hook.result.current)).not.toContain(ARCHIVED_HOST);

    // The held one, read by its identifier, with when it last sent data.
    const heldRead: Record<string, unknown> = server.callsFor(Host)[1]!.query;

    expect(heldRead["hostIdentifier"]).toBeInstanceOf(Includes);
    expect(hook.result.current.lastSeenAtByValue[LATE_HOST]).toEqual(
      new Date("2026-11-22T00:00:00.000Z"),
    );
    expect(
      hook.result.current.valueOf({ value: LATE_HOST, resourceId: undefined }),
    ).toBe(LATE_HOST);
  });

  test("an archived host a step watches is named and marked, never offered for a new pick", async () => {
    const hook: { result: { current: InfrastructureResources<Host> } } =
      renderHosts(ARCHIVED_HOST);

    await waitFor(() => {
      expect(optionValues(hook.result.current)).toContain(ARCHIVED_HOST);
    });

    const option: DropdownOption | undefined = hook.result.current.options.find(
      (candidate: DropdownOption) => {
        return candidate.value === ARCHIVED_HOST;
      },
    );

    expect(option).toMatchObject({ isArchived: true, isDisabled: true });
  });

  test("what is typed is searched on the server, by name or identifier, never an archived host", async () => {
    const hook: { result: { current: InfrastructureResources<Host> } } =
      renderHosts(undefined);

    await waitFor(() => {
      expect(hook.result.current.isLoading).toBe(false);
    });
    expect(optionValues(hook.result.current)).not.toContain(LATE_HOST);

    act(() => {
      hook.result.current.onSearchTextChange("KSK02");
    });

    await waitFor(() => {
      expect(optionValues(hook.result.current)).toContain(LATE_HOST);
    });

    const search: { query: Record<string, unknown>; limit: number } = server
      .callsFor(Host)
      .find((call: { query: Record<string, unknown> }): boolean => {
        return Object.values(call.query).some((condition: unknown) => {
          return condition instanceof MultiSearch;
        });
      })!;

    expect(search.query["isArchived"]).toBe(false);
    expect(search.limit).toBe(INFRASTRUCTURE_RESOURCE_SEARCH_LIMIT);
  });

  test.each([
    "Ceph",
    "DockerSwarm",
    "Proxmox",
    "Host",
    "OpenStack",
    "Docker",
    "Kubernetes",
    "IoT",
    "Podman",
    "VMware",
    "StorageArray",
  ])(
    "the %s monitor's step reads what it watches and searches the server",
    (kind: string) => {
      const source: string = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor",
          `${kind}Monitor`,
          `${kind}MonitorStepForm.tsx`,
        ),
        "utf8",
      );

      expect(source).toMatch(/valueField: "\w+"/);
      expect(source).toContain("searchFields:");
      expect(source).toContain("heldValue:");
      expect(source).toContain(".onSearchTextChange}");
    },
  );
});

describe("a metric query's metric", () => {
  test("MetricTypeSearch: 50 by name, from the server, nothing for an empty box", async () => {
    expect(await MetricTypeSearch.search("  ")).toEqual([]);
    expect(server.callsFor(MetricType)).toHaveLength(0);

    const found: Array<MetricType> = await MetricTypeSearch.search(".WB.");

    expect(
      found.map((metric: MetricType): string => {
        return metric.name || "";
      }),
    ).toEqual([LATE_METRIC]);

    const call: { query: Record<string, unknown>; limit: number } =
      server.callsFor(MetricType)[0]!;

    expect(call.query["name"]).toBeInstanceOf(Search);
    expect(call.limit).toBe(METRIC_TYPE_SEARCH_LIMIT);
  });

  test("the metric a query charts past the 10,000th shows, and its unit is read", async () => {
    const data: MetricQueryData = {
      filterData: { metricName: LATE_METRIC },
    } as unknown as MetricQueryData;

    await act(async () => {
      render(
        <MetricQuery
          data={data}
          onDataChanged={() => {}}
          // What the page read: the first 10,000, without it.
          metricTypes={[]}
          telemetryAttributes={[]}
        />,
      );
    });

    // Named in the picker, not an empty box.
    expect(screen.getAllByText(LATE_METRIC).length).toBeGreaterThan(0);

    // Read by its name, once.
    await waitFor(() => {
      expect(
        server
          .callsFor(MetricType)
          .some((call: { query: Record<string, unknown> }): boolean => {
            return call.query["name"] === LATE_METRIC;
          }),
      ).toBe(true);
    });
  });
});

describe("an SLO's metric", () => {
  test("searchSloMetricTypes asks the server for what is typed, 50 by name", async () => {
    expect(await searchSloMetricTypes("")).toEqual([]);

    const found: Array<MetricType> = await searchSloMetricTypes("network.io");

    expect(
      found.map((metric: MetricType): string => {
        return metric.name || "";
      }),
    ).toEqual([LATE_METRIC]);
    expect(server.callsFor(MetricType)[0]!.limit).toBe(SLO_METRIC_SEARCH_LIMIT);
  });

  test("readSloMetricType reads a held metric by its name, with its unit; none for a name not sent yet", async () => {
    expect((await readSloMetricType(LATE_METRIC))?.unit).toBe("By");
    expect(await readSloMetricType("not.sent.yet")).toBeNull();
  });

  test("the picker searches the server as it is typed in", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SloMetricQueryFieldElements.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("onSearchTextChange={search.onSearchTextChange}");
    expect(source).toContain("useHeldSloMetricType");
  });
});

// What is typed into the metric picker is asked of the server, debounced.
describe("the metric picker", () => {
  test("is a search box", async () => {
    await act(async () => {
      render(
        <MetricQuery
          data={{ filterData: {} } as unknown as MetricQueryData}
          onDataChanged={() => {}}
          metricTypes={[]}
          telemetryAttributes={[]}
        />,
      );
    });

    const input: HTMLElement = screen.getAllByRole("combobox")[0]!;

    await act(async () => {
      fireEvent.change(input, { target: { value: ".WB." } });
    });

    await waitFor(
      () => {
        expect(
          server
            .callsFor(MetricType)
            .some((call: { query: Record<string, unknown> }): boolean => {
              return call.query["name"] instanceof Search;
            }),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
  });
});
