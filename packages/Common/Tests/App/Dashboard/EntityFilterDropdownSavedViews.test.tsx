import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import { Mock } from "jest-mock";
import ObjectID from "../../../Types/ObjectID";

/*
 * The Funnel and Retention widgets' settings (issue #6630): "Saved Funnel"
 * and "Saved Retention Table" pick one of the project's saved funnels or
 * retention tables, of that kind only, each named with its RUM application
 * under it - read apart, and best effort: a role that reads saved views but
 * not applications still picks them by name.
 */

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}

interface Row {
  _id: string;
  name: string;
  rumApplicationId?: string | undefined;
}

interface ListResultShape {
  data: Array<Row>;
  count: number;
  skip: number;
  limit: number;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "6a306666-0000-4000-8000-000000000001",
);

const getListMock: Mock<(args: ListArgs) => Promise<ListResultShape>> =
  jest.fn<(args: ListArgs) => Promise<ListResultShape>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (args: ListArgs): Promise<ListResultShape> => {
        return getListMock(args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

import EntityFilterDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/EntityFilterDropdown";
import { EntityFilterModelType } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import RumProductAnalyticsSavedView from "../../../Models/DatabaseModels/RumProductAnalyticsSavedView";

const SHOP_APP_ID: string = "6a306666-0000-4000-8000-000000000101";
const DOCS_APP_ID: string = "6a306666-0000-4000-8000-000000000102";

const CHECKOUT: Row = {
  _id: "6a306666-0000-4000-8000-000000000201",
  name: "Checkout",
  rumApplicationId: SHOP_APP_ID,
};

const PRICING: Row = {
  _id: "6a306666-0000-4000-8000-000000000202",
  name: "Pricing to purchase",
  rumApplicationId: SHOP_APP_ID,
};

const DOCS_SEARCH: Row = {
  _id: "6a306666-0000-4000-8000-000000000203",
  name: "Search to article",
  rumApplicationId: DOCS_APP_ID,
};

// Saved on the widget, but past the list's 1000-row cap.
const PAST_CAP: Row = {
  _id: "6a306666-0000-4000-8000-000000000204",
  name: "Zeta signups",
  rumApplicationId: DOCS_APP_ID,
};

const APPLICATIONS: Array<Row> = [
  { _id: DOCS_APP_ID, name: "Docs site" },
  { _id: SHOP_APP_ID, name: "Web shop" },
];

function listOf(rows: Array<Row>): Promise<ListResultShape> {
  return Promise.resolve({
    data: rows,
    count: rows.length,
    skip: 0,
    limit: 1000,
  });
}

function idsIn(filter: unknown): Array<string> {
  return ((filter as Includes).values as Array<ObjectID>).map(
    (id: ObjectID): string => {
      return id.toString();
    },
  );
}

/*
 * The server as the picker sees it: the saved views (PAST_CAP only by its
 * id), and the applications asked for by id.
 */
function serve(args: ListArgs): Promise<ListResultShape> {
  const idFilter: unknown = args.query["_id"];

  if (args.modelType === RumApplication) {
    const ids: Array<string> = idsIn(idFilter);

    return listOf(
      APPLICATIONS.filter((row: Row): boolean => {
        return ids.includes(row._id);
      }),
    );
  }

  if (idFilter instanceof Includes) {
    const ids: Array<string> = idsIn(idFilter);

    return listOf(
      [CHECKOUT, PRICING, DOCS_SEARCH, PAST_CAP].filter((row: Row): boolean => {
        return ids.includes(row._id);
      }),
    );
  }

  return listOf([CHECKOUT, PRICING, DOCS_SEARCH]);
}

function callsFor(modelType: unknown): Array<ListArgs> {
  return getListMock.mock.calls
    .map((call: [ListArgs]): ListArgs => {
      return call[0];
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === modelType;
    });
}

function renderPicker(options: {
  type: EntityFilterModelType;
  value?: string | undefined;
}): void {
  render(
    <EntityFilterDropdown
      entityFilterModelType={options.type}
      isMultiSelect={false}
      value={options.value}
      placeholder="Select a saved funnel"
      onChange={() => {
        return undefined;
      }}
    />,
  );
}

async function waitForOptions(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText("Loading options...")).not.toBeInTheDocument();
  });
}

// Each option as the menu shows it: its name, then what is said under it.
function openOptions(): Array<string> {
  fireEvent.keyDown(screen.getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });

  return screen.getAllByRole("option").map((option: HTMLElement): string => {
    const label: string =
      within(option).getByTestId("dropdown-option-label").textContent || "";
    const under: string = (option.textContent || "").slice(label.length);

    return under ? `${label} | ${under}` : label;
  });
}

beforeEach(() => {
  getListMock.mockReset().mockImplementation(serve);
});

afterEach(() => {
  cleanup();
});

describe("a saved funnel or retention table picked for a widget", () => {
  test.each([
    [EntityFilterModelType.ProductAnalyticsSavedFunnel, "funnel"],
    [EntityFilterModelType.ProductAnalyticsSavedRetention, "retention"],
  ])(
    "%s lists the project's saved ones of its kind only, by name, reading each one's application",
    async (type: EntityFilterModelType, viewType: string) => {
      renderPicker({ type: type });
      await waitForOptions();

      const lists: Array<ListArgs> = callsFor(RumProductAnalyticsSavedView);

      expect(lists).toHaveLength(1);
      expect(lists[0]!.query["viewType"]).toBe(viewType);
      expect((lists[0]!.query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(lists[0]!.select).toEqual({
        _id: true,
        name: true,
        rumApplicationId: true,
      });
      expect(lists[0]!.sort).toEqual({ name: SortOrder.Ascending });

      // The applications, once each, by their ids, in the project.
      const applications: Array<ListArgs> = callsFor(RumApplication);

      expect(applications).toHaveLength(1);
      expect(idsIn(applications[0]!.query["_id"]).sort()).toEqual(
        [SHOP_APP_ID, DOCS_APP_ID].sort(),
      );
      expect((applications[0]!.query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(applications[0]!.select).toEqual({ _id: true, name: true });
      expect(applications[0]!.limit).toBe(2);
    },
  );

  test("each option is its name, with its application under it", async () => {
    renderPicker({ type: EntityFilterModelType.ProductAnalyticsSavedFunnel });
    await waitForOptions();

    expect(openOptions()).toEqual([
      "Checkout | Web shop",
      "Pricing to purchase | Web shop",
      "Search to article | Docs site",
    ]);
  });

  test("applications this role may not read: the options keep their names, and no error", async () => {
    getListMock.mockImplementation((args: ListArgs) => {
      if (args.modelType === RumApplication) {
        return Promise.reject(new Error("You do not have permission."));
      }

      return serve(args);
    });

    renderPicker({ type: EntityFilterModelType.ProductAnalyticsSavedFunnel });
    await waitForOptions();

    expect(openOptions()).toEqual([
      "Checkout",
      "Pricing to purchase",
      "Search to article",
    ]);
    expect(
      screen.queryByText("You do not have permission."),
    ).not.toBeInTheDocument();
  });

  test("an application gone since: that option keeps its name alone", async () => {
    getListMock.mockImplementation((args: ListArgs) => {
      if (args.modelType === RumApplication) {
        return listOf([{ _id: SHOP_APP_ID, name: "Web shop" }]);
      }

      return serve(args);
    });

    renderPicker({ type: EntityFilterModelType.ProductAnalyticsSavedFunnel });
    await waitForOptions();

    expect(openOptions()).toEqual([
      "Checkout | Web shop",
      "Pricing to purchase | Web shop",
      "Search to article",
    ]);
  });

  test("a saved one past the list's cap is looked up, named, and its application read with the rest", async () => {
    renderPicker({
      type: EntityFilterModelType.ProductAnalyticsSavedFunnel,
      value: PAST_CAP._id,
    });

    expect(await screen.findByText("Zeta signups")).toBeInTheDocument();

    const lookups: Array<ListArgs> = callsFor(
      RumProductAnalyticsSavedView,
    ).filter((args: ListArgs): boolean => {
      return args.query["_id"] instanceof Includes;
    });

    expect(lookups).toHaveLength(1);
    expect(idsIn(lookups[0]!.query["_id"])).toEqual([PAST_CAP._id]);
    // Its application is among those read: it is described like the rest.
    expect(lookups[0]!.select["rumApplicationId"]).toBe(true);
    expect(callsFor(RumApplication)).toHaveLength(1);

    expect(openOptions()).toContain("Zeta signups | Docs site");
  });

  test("no saved ones yet: no application read", async () => {
    getListMock.mockImplementation((args: ListArgs) => {
      if (args.modelType === RumApplication) {
        return serve(args);
      }

      return listOf([]);
    });

    renderPicker({
      type: EntityFilterModelType.ProductAnalyticsSavedRetention,
    });
    await waitForOptions();

    expect(callsFor(RumApplication)).toHaveLength(0);
  });
});
