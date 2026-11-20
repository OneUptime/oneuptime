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
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { JSONObject } from "../../../Types/JSON";

/*
 * THE SITES PAGE'S HIERARCHY AT THE SIZE AN IMPORT OF A MERAKI ORGANIZATION
 * LEAVES (#10188): 700 sites, one a network, all at the top, beside a
 * small region with markets and stores.
 *
 * Drawn for real; only what it reads is stood in for - the sites, their
 * device counts and how many there are.
 *
 *   - folded under its title until it is shown, reading nothing but a
 *     count; nothing at all for a project with no site;
 *   - shown, the sites at the top, fifty at a time, with Show more;
 *   - a site's children only when it is opened;
 *   - a search narrows the tree to what it finds and opens the sites above;
 *   - Hide sites with no devices leaves out every empty subtree;
 *   - the reader's choice to keep it shown is remembered.
 */

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

let siteRows: Array<JSONObject> = [];
let deviceCounts: Record<string, number> = {};
let listCalls: number = 0;
let countCalls: number = 0;
let storage: Record<string, unknown> = {};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        countCalls++;
        return siteRows.length;
      },
      getList: async (): Promise<JSONObject> => {
        listCalls++;
        const NetworkSiteClass: any = (
          jest.requireActual(
            "../../../Models/DatabaseModels/NetworkSite",
          ) as any
        ).default;

        return {
          data: siteRows.map((row: JSONObject) => {
            const site: any = new NetworkSiteClass();
            Object.assign(site, row);
            return site;
          }),
          count: siteRows.length,
          skip: 0,
          limit: siteRows.length,
        };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Network/NetworkSummaryApi",
  () => {
    return {
      __esModule: true,
      fetchSiteDeviceCounts: async (): Promise<Record<string, number>> => {
        return deviceCounts;
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/LocalStorage", () => {
  return {
    __esModule: true,
    default: {
      getItem: (key: string): unknown => {
        return storage[key];
      },
      setItem: (key: string, value: unknown): void => {
        storage[key] = value;
      },
    },
  };
});

import SiteHierarchyTree from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteHierarchyTree";
import { HIERARCHY_OPEN_STORAGE_KEY } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteHierarchyWords";

function id(prefix: number, index: number): string {
  return `${prefix}0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const NORTH: string = id(1, 1);
const LEEDS: string = id(1, 2);
const YORK: string = id(1, 3);
const LEEDS_STORE: string = id(1, 4);
const YORK_STORE: string = id(1, 5);

// The region, and the 700 Meraki networks' sites.
function estate(): Array<JSONObject> {
  const rows: Array<JSONObject> = [
    { _id: NORTH, name: "North" },
    { _id: LEEDS, name: "Leeds", parentSiteId: NORTH },
    { _id: YORK, name: "York", parentSiteId: NORTH },
    { _id: LEEDS_STORE, name: "Store 0660", parentSiteId: LEEDS },
    { _id: YORK_STORE, name: "Store 0101", parentSiteId: YORK },
  ];

  for (let index: number = 1; index <= 700; index++) {
    rows.push({
      _id: id(2, index),
      name: `Meraki ${String(index).padStart(4, "0")}`,
    });
  }

  return rows;
}

function renderTree(): void {
  render(
    <MemoryRouter>
      <SiteHierarchyTree refreshToggle="" />
    </MemoryRouter>,
  );
}

async function show(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Show Hierarchy" }));
  });

  await waitFor(() => {
    expect(screen.getByTestId("site-hierarchy-body")).toBeInTheDocument();
  });
}

function rowNames(): Array<string> {
  return screen
    .queryAllByTestId("site-hierarchy-row")
    .map((row: HTMLElement): string => {
      return within(row).getByRole("link").textContent || "";
    });
}

function rowOf(name: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .queryAllByTestId("site-hierarchy-row")
    .find((each: HTMLElement): boolean => {
      return within(each).getByRole("link").textContent === name;
    });

  expect(row).toBeDefined();

  return row!;
}

async function type(text: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(screen.getByPlaceholderText("Search sites by name"), {
      target: { value: text },
    });
  });
}

beforeEach(() => {
  siteRows = estate();
  deviceCounts = { [LEEDS_STORE]: 3, [id(2, 7)]: 2 };
  listCalls = 0;
  countCalls = 0;
  storage = {};
});

afterEach(() => {
  cleanup();
});

describe("the Sites page's hierarchy, at 705 sites", () => {
  test("starts folded under its title, reading only how many sites there are", async () => {
    renderTree();

    await waitFor(() => {
      expect(countCalls).toBe(1);
    });

    expect(screen.getByText("Hierarchy")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show Hierarchy" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("site-hierarchy-body")).toBeNull();
    expect(screen.queryAllByTestId("site-hierarchy-row")).toEqual([]);
    // The rows are read only once it is shown.
    expect(listCalls).toBe(0);
  });

  test("a project with no site draws no hierarchy at all", async () => {
    siteRows = [];
    renderTree();

    await waitFor(() => {
      expect(countCalls).toBe(1);
    });
    await waitFor(() => {
      expect(screen.queryByText("Hierarchy")).toBeNull();
    });
  });

  test("shown: the sites at the top, fifty at a time, with how many there are", async () => {
    renderTree();
    await show();

    expect(listCalls).toBe(1);
    expect(screen.getByTestId("site-hierarchy-summary").textContent).toBe(
      "705 sites · 701 at the top level",
    );

    // By name: Meraki 0001 to 0050 first; North is far down the top level.
    expect(rowNames()).toHaveLength(50);
    expect(rowNames()[0]).toBe("Meraki 0001");
    expect(rowNames()[49]).toBe("Meraki 0050");
    expect(rowNames()).not.toContain("Leeds");

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("button", { name: "Show 50 more sites" }),
      );
    });

    expect(rowNames()).toHaveLength(100);
    expect(rowNames()[99]).toBe("Meraki 0100");
  });

  test("a site's children are drawn only once it is opened", async () => {
    renderTree();
    await show();
    await type("north");

    expect(rowNames()).toEqual(["North"]);

    const toggle: HTMLElement = within(rowOf("North")).getByRole("button", {
      name: "Expand",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await act(async (): Promise<void> => {
      fireEvent.click(toggle);
    });

    expect(rowNames()).toEqual(["North", "Leeds", "York"]);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(rowOf("North")).getByRole("button", { name: "Collapse" }),
      );
    });

    expect(rowNames()).toEqual(["North"]);
  });

  test("a search narrows the tree to what it finds, and opens the sites above it", async () => {
    renderTree();
    await show();
    await type("store 0660");

    expect(screen.getByTestId("site-hierarchy-summary").textContent).toBe(
      "1 site matches",
    );
    expect(rowNames()).toEqual(["North", "Leeds", "Store 0660"]);
    // The subtree's devices, counted all the way up.
    expect(rowOf("North").textContent).toContain("3 devices");

    // Closed by hand, a site the search opened stays closed.
    await act(async (): Promise<void> => {
      fireEvent.click(
        within(rowOf("Leeds")).getByRole("button", { name: "Collapse" }),
      );
    });
    expect(rowNames()).toEqual(["North", "Leeds"]);

    // Nothing found: said in words.
    await type("store 9999");
    expect(screen.getByTestId("site-hierarchy-nothing").textContent).toBe(
      "No site matches store 9999.",
    );

    // Cleared: the top level again, all closed.
    await type("");
    expect(rowNames()).toHaveLength(50);
    expect(rowNames()).not.toContain("Leeds");
  });

  test("Hide sites with no devices leaves out every subtree that holds none", async () => {
    renderTree();
    await show();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByText("Hide sites with no devices"));
    });

    expect(rowNames()).toEqual(["Meraki 0007", "North"]);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(rowOf("North")).getByRole("button", { name: "Expand" }),
      );
    });

    // York's store holds nothing: York goes too.
    expect(rowNames()).toEqual(["Meraki 0007", "North", "Leeds"]);
    expect(rowOf("Meraki 0007").textContent).toContain("2 devices");
  });

  test("hiding it again folds it; the reader's choice to show it is remembered", async () => {
    renderTree();
    await show();

    expect(storage[HIERARCHY_OPEN_STORAGE_KEY]).toBe(true);

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Hide Hierarchy" }));
    });

    expect(screen.queryByTestId("site-hierarchy-body")).toBeNull();
    expect(storage[HIERARCHY_OPEN_STORAGE_KEY]).toBe(false);

    // Shown on the next visit when it was left shown.
    storage[HIERARCHY_OPEN_STORAGE_KEY] = true;
    cleanup();
    renderTree();

    await waitFor(() => {
      expect(screen.getByTestId("site-hierarchy-body")).toBeInTheDocument();
    });
    expect(rowNames()).toHaveLength(50);
  });
});
