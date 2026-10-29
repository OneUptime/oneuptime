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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE ONE SEARCH ACROSS EVERY KIND (issue #5341), AS THE PICKER ASKS IT AND
 * SHOWS ITS ANSWER.
 *
 * A customer read the Affected Resources picker as "a lookup against Hosts":
 * a project with hosts and network devices found its hosts and nothing else,
 * and every kind it did search was asked twice a keystroke. The picker now
 * asks the server once per query, and every result says what kind it is:
 *
 *   - one request for every kind, the text and the page size in it;
 *   - results grouped under a header naming their kind, a device's address
 *     beside its name;
 *   - a kind filter with how many of each match, narrowing to a kind lists
 *     more of it and only counts the rest, and Show all on a kind's header;
 *   - the monitors a search also matches are said, and where they are
 *     picked - on a picker that does not offer them;
 *   - a failed search says so; a kind the server would not read is named.
 *
 * The route itself is stood in for (AffectedResourceSearchApi); the server's
 * half has its own suites.
 */

const searchMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourceSearchApi",
  () => {
    return {
      __esModule: true,
      searchAffectedResources: (query: unknown): unknown => {
        return searchMock(query);
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
    },
  };
});

import AffectedResourcesPicker, {
  AffectedResourcesPayload,
  AffectedResourceType,
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import {
  AFFECTED_RESOURCE_SEARCH_DEFAULT_LIMIT,
  AFFECTED_RESOURCE_SEARCH_MAX_LIMIT,
  AffectedResourceKind,
  AffectedResourceSearchResult,
} from "../../../Types/AffectedResources/AffectedResourceSearch";

interface SearchQuery {
  search: string;
  kinds: Array<AffectedResourceKind>;
  limitPerKind: number;
  countKinds: Array<AffectedResourceKind>;
}

const OTHER_TYPES: Array<AffectedResourceType> = [
  "Host",
  "NetworkDevice",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "ProxmoxCluster",
  "VMwareVCenter",
  "CephCluster",
  "StorageArray",
  "DockerSwarmCluster",
  "IoTFleet",
  "DatabaseServer",
  "CloudResource",
  "Service",
];

const id: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

const HOST_ID: string = id(1);
const ROUTER_ID: string = id(11);
const SWITCH_ID: string = id(12);

/*
 * The project the route answers from: per kind, the names and addresses it
 * holds. The fake answers like the server: each kind asked, its matches by
 * name (the page), how many match, the counted kinds' counts.
 */
interface FakeResource {
  _id: string;
  name: string;
  detail?: string;
}

let project: Partial<Record<AffectedResourceKind, Array<FakeResource>>>;
let unreadable: Array<AffectedResourceKind>;
let failing: boolean;

function matchesOf(
  kind: AffectedResourceKind,
  search: string,
): Array<FakeResource> {
  return (project[kind] || []).filter((resource: FakeResource): boolean => {
    const needle: string = search.toLowerCase();
    return (
      !needle ||
      resource.name.toLowerCase().includes(needle) ||
      (resource.detail || "").toLowerCase().includes(needle)
    );
  });
}

async function answer(
  query: SearchQuery,
): Promise<AffectedResourceSearchResult> {
  if (failing) {
    throw new Error("Server error");
  }

  return {
    kinds: query.kinds
      .filter((kind: AffectedResourceKind): boolean => {
        return !unreadable.includes(kind);
      })
      .map((kind: AffectedResourceKind) => {
        const all: Array<FakeResource> = matchesOf(kind, query.search);
        return {
          kind,
          count: all.length,
          matches: all.slice(0, query.limitPerKind).map((r: FakeResource) => {
            return r.detail
              ? { _id: r._id, name: r.name, detail: r.detail }
              : { _id: r._id, name: r.name };
          }),
        };
      }),
    counts: query.countKinds
      .filter((kind: AffectedResourceKind): boolean => {
        return !unreadable.includes(kind);
      })
      .map((kind: AffectedResourceKind) => {
        return { kind, count: matchesOf(kind, query.search).length };
      }),
    unreadableKinds: [...query.kinds, ...query.countKinds].filter(
      (kind: AffectedResourceKind): boolean => {
        return unreadable.includes(kind);
      },
    ),
  };
}

function queries(): Array<SearchQuery> {
  return searchMock.mock.calls.map((call: Array<unknown>): SearchQuery => {
    return call[0] as SearchQuery;
  });
}

function lastQuery(): SearchQuery {
  return queries()[queries().length - 1]!;
}

let changes: Array<AffectedResourcesPayload>;

function renderPicker(props: Partial<ComponentProps> = {}): RenderResult {
  return render(
    <AffectedResourcesPicker
      resourceTypes={OTHER_TYPES}
      onChange={(payload: AffectedResourcesPayload): void => {
        changes.push(payload);
      }}
      {...props}
    />,
  );
}

function input(): HTMLInputElement {
  return screen.getByRole("combobox") as HTMLInputElement;
}

async function open(): Promise<void> {
  await act(async () => {
    fireEvent.focus(input());
  });
  await waitFor(() => {
    expect(searchMock).toHaveBeenCalled();
  });
  await settle();
}

async function type(text: string): Promise<void> {
  const before: number = searchMock.mock.calls.length;

  await act(async () => {
    fireEvent.change(input(), { target: { value: text } });
  });
  await waitFor(() => {
    expect(searchMock.mock.calls.length).toBeGreaterThan(before);
  });
  await settle();
}

async function settle(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText("Searching...")).toBeNull();
  });
}

function group(kind: AffectedResourceType): HTMLElement {
  return screen.getByTestId(`affected-resources-group-${kind}`);
}

function rowNames(kind: AffectedResourceType): Array<string> {
  return within(group(kind))
    .getAllByRole("option")
    .map((row: HTMLElement): string => {
      return row.querySelector("span.truncate")?.textContent || "";
    });
}

beforeEach(() => {
  changes = [];
  unreadable = [];
  failing = false;
  project = {
    [AffectedResourceKind.Host]: [
      { _id: HOST_ID, name: "wan-proxy" },
      { _id: id(2), name: "app-server-01" },
    ],
    [AffectedResourceKind.NetworkDevice]: [
      { _id: ROUTER_ID, name: "WAN-RTR-01", detail: "10.0.0.1" },
      { _id: SWITCH_ID, name: "core-sw-01", detail: "10.0.4.1" },
    ],
    [AffectedResourceKind.Monitor]: [
      { _id: id(21), name: "WAN uplink ping" },
      { _id: id(22), name: "WAN latency" },
    ],
  };
  searchMock.mockReset();
  searchMock.mockImplementation((query: unknown) => {
    return answer(query as SearchQuery);
  });
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 10 });
});

afterEach(() => {
  cleanup();
});

describe("one request for every kind", () => {
  test("opening the list asks once, for every kind the picker offers, a page of each", async () => {
    renderPicker();

    await open();

    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toEqual({
      search: "",
      kinds: OTHER_TYPES,
      limitPerKind: AFFECTED_RESOURCE_SEARCH_DEFAULT_LIMIT,
      countKinds: [],
    });
  });

  test("typing asks once more, with the text - not twice per kind", async () => {
    renderPicker();
    await open();

    await type("wan");

    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(lastQuery().search).toBe("wan");
    expect(lastQuery().kinds).toEqual(OTHER_TYPES);
    // The picker reads nothing kind by kind any more.
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("an answer that arrives after a newer one never replaces it", async () => {
    let releaseFirst: () => void = (): void => {};

    renderPicker();
    await open();

    searchMock.mockImplementationOnce((query: unknown) => {
      return new Promise((resolve: (value: unknown) => void) => {
        releaseFirst = (): void => {
          resolve(answer({ ...(query as SearchQuery), search: "" }));
        };
      });
    });

    await act(async () => {
      fireEvent.change(input(), { target: { value: "w" } });
    });
    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledTimes(2);
    });

    await type("core");

    await act(async () => {
      releaseFirst();
    });

    expect(rowNames("NetworkDevice")).toEqual(["core-sw-01"]);
    expect(screen.queryByTestId("affected-resources-group-Host")).toBeNull();
  });
});

describe("every result says what kind it is", () => {
  test("results are grouped under a header naming their kind, in the picker's order", async () => {
    renderPicker();
    await open();
    await type("wan");

    const groups: Array<string> = screen
      .getAllByTestId(/^affected-resources-group-/)
      .map((element: HTMLElement): string => {
        return element.getAttribute("data-testid")!;
      });

    expect(groups).toEqual([
      "affected-resources-group-Host",
      "affected-resources-group-NetworkDevice",
    ]);
    expect(within(group("Host")).getByText("Hosts")).toBeInTheDocument();
    expect(
      within(group("NetworkDevice")).getByText("Network Devices"),
    ).toBeInTheDocument();
    expect(rowNames("Host")).toEqual(["wan-proxy"]);
    expect(rowNames("NetworkDevice")).toEqual(["WAN-RTR-01"]);
  });

  test("a device's address shows beside its name, read left to right in any language", async () => {
    renderPicker();
    await open();
    await type("10.0.4");

    const row: HTMLElement = within(group("NetworkDevice")).getByRole("option");
    const address: HTMLElement = within(row).getByText("10.0.4.1");

    expect(within(row).getByText("core-sw-01")).toBeInTheDocument();
    expect(address).toHaveAttribute("dir", "ltr");
    // Rows line up with the start of the line, in a right-to-left page too.
    expect(row.className).toContain("text-start");
    expect(row.className).not.toContain("text-left");
  });

  test("picking a device adds it to the network devices the field holds", async () => {
    renderPicker();
    await open();
    await type("rtr");

    await act(async () => {
      fireEvent.click(within(group("NetworkDevice")).getByRole("option"));
    });

    expect(changes[changes.length - 1]!.networkDevices).toEqual([ROUTER_ID]);
  });
});

describe("the kind filter", () => {
  test("All and each kind with a match, each with how many match", async () => {
    renderPicker();
    await open();
    await type("wan");

    const filter: HTMLElement = screen.getByTestId(
      "affected-resources-kind-filter",
    );

    expect(filter).toHaveAttribute("role", "group");
    expect(filter).toHaveAttribute("aria-label", "Resource type");
    expect(
      within(filter)
        .getAllByRole("button")
        .map((chip: HTMLElement): string => {
          return chip.textContent || "";
        }),
    ).toEqual(["All2", "Hosts1", "Network Devices1"]);
    expect(screen.getByTestId("affected-resources-kind-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("is not shown while the results hold one kind", async () => {
    renderPicker();
    await open();
    await type("core");

    expect(screen.queryByTestId("affected-resources-kind-filter")).toBeNull();
    expect(rowNames("NetworkDevice")).toEqual(["core-sw-01"]);
  });

  test("narrowing to a kind asks for more of it, counts the rest, and lists only it", async () => {
    renderPicker();
    await open();
    await type("wan");

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("affected-resources-kind-NetworkDevice"),
      );
    });
    await waitFor(() => {
      expect(lastQuery().kinds).toEqual(["NetworkDevice"]);
    });
    await settle();

    expect(lastQuery()).toEqual({
      search: "wan",
      kinds: ["NetworkDevice"],
      limitPerKind: AFFECTED_RESOURCE_SEARCH_MAX_LIMIT,
      countKinds: OTHER_TYPES.filter((kind: AffectedResourceType): boolean => {
        return kind !== "NetworkDevice";
      }),
    });
    expect(screen.queryByTestId("affected-resources-group-Host")).toBeNull();
    expect(
      screen.getByTestId("affected-resources-kind-NetworkDevice"),
    ).toHaveAttribute("aria-pressed", "true");
    // The other kinds keep their numbers, so the way back is in view.
    expect(
      screen.getByTestId("affected-resources-kind-Host"),
    ).toHaveTextContent("Hosts1");
  });

  test("All goes back to every kind", async () => {
    renderPicker();
    await open();
    await type("wan");

    await act(async () => {
      fireEvent.click(screen.getByTestId("affected-resources-kind-Host"));
    });
    await waitFor(() => {
      expect(lastQuery().kinds).toEqual(["Host"]);
    });
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByTestId("affected-resources-kind-all"));
    });
    await waitFor(() => {
      expect(lastQuery().kinds).toEqual(OTHER_TYPES);
    });
    await settle();

    expect(group("NetworkDevice")).toBeInTheDocument();
  });

  test("a list closed and opened again starts on every kind", async () => {
    renderPicker();
    await open();
    await type("wan");

    await act(async () => {
      fireEvent.click(screen.getByTestId("affected-resources-kind-Host"));
    });
    await waitFor(() => {
      expect(lastQuery().kinds).toEqual(["Host"]);
    });
    await settle();

    await act(async () => {
      fireEvent.keyDown(input(), { key: "Escape" });
    });
    await act(async () => {
      fireEvent.focus(input());
    });
    await waitFor(() => {
      expect(lastQuery().kinds).toEqual(OTHER_TYPES);
    });
  });
});

describe("Show all, and what a narrowed list leaves out", () => {
  beforeEach(() => {
    project[AffectedResourceKind.NetworkDevice] = Array.from(
      { length: 180 },
      (_value: unknown, index: number): FakeResource => {
        return {
          _id: id(1000 + index),
          name: `access-sw-${String(index).padStart(3, "0")}`,
          detail: `10.20.0.${index}`,
        };
      },
    );
  });

  test("a kind with more matches than its page offers Show all, with how many", async () => {
    renderPicker();
    await open();
    await type("sw");

    expect(rowNames("NetworkDevice")).toHaveLength(
      AFFECTED_RESOURCE_SEARCH_DEFAULT_LIMIT,
    );
    expect(
      screen.getByTestId("affected-resources-show-all-NetworkDevice"),
    ).toHaveTextContent("Show all 180");
  });

  test("Show all narrows to the kind, and the footer says how many of how many are shown", async () => {
    renderPicker();
    await open();
    await type("sw");

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("affected-resources-show-all-NetworkDevice"),
      );
    });
    await waitFor(() => {
      expect(lastQuery().kinds).toEqual(["NetworkDevice"]);
    });
    await settle();

    expect(rowNames("NetworkDevice")).toHaveLength(
      AFFECTED_RESOURCE_SEARCH_MAX_LIMIT,
    );
    expect(
      screen.getByTestId("affected-resources-narrowed-more"),
    ).toHaveTextContent("Showing 50 of 180. Type to narrow the list.");
    // Narrowed already: no Show all on its own header.
    expect(
      screen.queryByTestId("affected-resources-show-all-NetworkDevice"),
    ).toBeNull();
  });

  test("a kind whose matches all fit offers no Show all and no footer", async () => {
    renderPicker();
    await open();
    await type("wan-proxy");

    expect(screen.queryByTestId(/^affected-resources-show-all-/)).toBeNull();
    expect(screen.queryByTestId("affected-resources-narrowed-more")).toBeNull();
  });
});

describe("the monitors a search also matches", () => {
  test("are counted and said, with where they are picked", async () => {
    renderPicker({ monitorFieldTitle: "Monitors" });
    await open();
    await type("wan");

    expect(lastQuery().countKinds).toEqual(["Monitor"]);
    expect(lastQuery().kinds).not.toContain("Monitor");
    expect(
      screen.getByTestId("affected-resources-monitors-hint"),
    ).toHaveTextContent(
      "2 monitors match too. Monitors are picked under Monitors.",
    );
  });

  test("one monitor is said as one, and an alert's field by its own name", async () => {
    renderPicker({ monitorFieldTitle: "Monitor" });
    await open();
    await type("latency");

    expect(
      screen.getByTestId("affected-resources-monitors-hint"),
    ).toHaveTextContent(
      "1 monitor matches too. Monitors are picked under Monitor.",
    );
  });

  test("suggestions with no text count no monitors", async () => {
    renderPicker({ monitorFieldTitle: "Monitors" });
    await open();

    expect(lastQuery().countKinds).toEqual([]);
    expect(screen.queryByTestId("affected-resources-monitors-hint")).toBeNull();
  });

  test("a picker without a monitor field beside it counts none", async () => {
    renderPicker();
    await open();
    await type("wan");

    expect(lastQuery().countKinds).toEqual([]);
    expect(screen.queryByTestId("affected-resources-monitors-hint")).toBeNull();
  });

  test("a picker that offers monitors itself lists them, and says nothing more", async () => {
    renderPicker({
      resourceTypes: ["Monitor", ...OTHER_TYPES],
      monitorFieldTitle: "Monitors",
    });
    await open();
    await type("wan");

    expect(lastQuery().kinds).toContain("Monitor");
    expect(lastQuery().countKinds).toEqual([]);
    expect(rowNames("Monitor")).toEqual(["WAN uplink ping", "WAN latency"]);
    expect(screen.queryByTestId("affected-resources-monitors-hint")).toBeNull();
  });
});

describe("when the search cannot answer", () => {
  test("a failed search says so, rather than that nothing matched", async () => {
    failing = true;

    renderPicker();
    await open();
    await type("wan");

    expect(
      screen.getByTestId("affected-resources-search-failed"),
    ).toHaveTextContent("Could not search resources. Try again in a moment.");
    expect(screen.queryByText("No matching resources.")).toBeNull();
  });

  test("the next search that works clears it", async () => {
    failing = true;

    renderPicker();
    await open();
    await type("wan");

    failing = false;
    await type("wan-");

    expect(screen.queryByTestId("affected-resources-search-failed")).toBeNull();
    expect(rowNames("Host")).toEqual(["wan-proxy"]);
  });

  test("a kind the server would not read is named, and the rest still listed", async () => {
    unreadable = [AffectedResourceKind.DatabaseServer];

    renderPicker();
    await open();
    await type("wan");

    expect(
      screen.getByText("You don't have permission to read: Database."),
    ).toBeInTheDocument();
    expect(rowNames("Host")).toEqual(["wan-proxy"]);
  });

  test("nothing matched is said as such", async () => {
    renderPicker();
    await open();
    await type("zzz");

    expect(screen.getByText("No matching resources.")).toBeInTheDocument();
    expect(screen.queryByTestId("affected-resources-kind-filter")).toBeNull();
  });
});

describe("the placeholder", () => {
  test("fourteen kinds are named by the first three and 'and more'", () => {
    renderPicker();

    expect(input()).toHaveAttribute(
      "placeholder",
      "Search hosts, network devices, Kubernetes clusters and more...",
    );
  });

  test("three kinds or fewer are each named", () => {
    renderPicker({ resourceTypes: ["Host", "NetworkDevice"] });

    expect(input()).toHaveAttribute(
      "placeholder",
      "Search hosts, network devices...",
    );
  });

  test("a placeholder given is the one shown", () => {
    renderPicker({ placeholder: "Search monitors..." });

    expect(input()).toHaveAttribute("placeholder", "Search monitors...");
  });
});
