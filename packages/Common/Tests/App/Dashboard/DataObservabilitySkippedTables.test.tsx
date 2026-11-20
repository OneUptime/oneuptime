import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  MemoryRouter,
  Outlet,
  Route as RouterRoute,
  Routes,
} from "react-router-dom";
import Route from "../../../Types/API/Route";
import {
  DataObservabilityCollector,
  DataObservabilitySkippedTable,
  DataObservabilityStoreSummary,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { SkippedTableRead } from "../../../Types/DataObservability/SkippedTables";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import SkippedTablesCard, {
  SKIPPED_TABLE_READ_LABELS,
  SKIPPED_TABLES_SHOWN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/SkippedTablesCard";
import StoreOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/View/Overview";
import { StoreViewOutletContext } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/View/StoreViewContext";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import enLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";

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

/*
 * THE TABLES A DATABASE KEEPS REFUSING, ON ITS PAGE (#9541).
 *
 * A collection skips a table Dataverse keeps refusing until its next try,
 * so the database's page says which tables are skipped, what is not read
 * of each, why in Dataverse's own words, and when each is asked again -
 * with Collect Now to ask them all again at once. A database that skips
 * none shows nothing of it.
 */

const STORE_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const REFUSED: string =
  "Dataverse refused the app (403, 0x80040220): Principal user is missing prvReadcr123_secret privilege.";

function skipped(
  fields: Partial<DataObservabilitySkippedTable> = {},
): DataObservabilitySkippedTable {
  return {
    table: "cr123_secret",
    read: SkippedTableRead.RowCount,
    reason: REFUSED,
    nextTryAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    ...fields,
  };
}

function store(
  fields: Partial<DataObservabilityStoreSummary> = {},
): DataObservabilityStoreSummary {
  return {
    dataStoreId: STORE_ID,
    name: "contoso",
    kind: "Microsoft Dataverse",
    isTableHealthEnabled: true,
    collector: DataObservabilityCollector.OneUptime,
    probeName: null,
    status: "Collected",
    message: null,
    collectedAt: NOW.toISOString(),
    attemptedAt: NOW.toISOString(),
    assetCount: 12,
    lateAssetCount: 0,
    alertMonitorCount: 1,
    ...fields,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the Skipped Tables card", () => {
  test("names each table, what is not read of it, why in the database's words, and when it is asked again", () => {
    render(
      <SkippedTablesCard
        skippedTables={[
          skipped(),
          skipped({
            table: "email",
            read: SkippedTableRead.Columns,
            reason:
              "Dataverse answered 500 (0x80040216): An unexpected error occurred.",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Skipped Tables")).toBeInTheDocument();
    expect(screen.getByText("cr123_secret")).toBeInTheDocument();
    expect(screen.getByText("Row Count")).toBeInTheDocument();
    expect(screen.getByText(REFUSED)).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("Columns")).toBeInTheDocument();
    expect(screen.getAllByText(/^Asked again in 2 hours$/)).toHaveLength(2);
    // Collect Now is the way to ask again at once.
    expect(
      screen.getByText(
        "The database refused these tables, so collections skip each one until its next try instead of asking every five minutes. Collect Now asks them all again at once.",
      ),
    ).toBeInTheDocument();
  });

  test("a table whose next try has passed is asked at the next collection", () => {
    render(
      <SkippedTablesCard
        skippedTables={[
          skipped({
            nextTryAt: new Date(NOW.getTime() - 60_000).toISOString(),
          }),
        ]}
      />,
    );

    expect(
      screen.getByText("Asked again at the next collection"),
    ).toBeInTheDocument();
  });

  test("a database that skips no table shows nothing of it", () => {
    const { container } = render(<SkippedTablesCard skippedTables={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  test("the first few show; Show all shows the rest, and says which way it is", () => {
    const tables: Array<DataObservabilitySkippedTable> = Array.from(
      { length: SKIPPED_TABLES_SHOWN + 3 },
      (_: unknown, index: number): DataObservabilitySkippedTable => {
        return skipped({ table: `cr123_t${index}` });
      },
    );

    render(<SkippedTablesCard skippedTables={tables} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(SKIPPED_TABLES_SHOWN);

    const showAll: HTMLElement = screen.getByRole("button", {
      name: `Show all ${tables.length}`,
    });

    expect(showAll).toHaveAttribute("aria-expanded", "false");

    act(() => {
      fireEvent.click(showAll);
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(tables.length);
    expect(screen.getByRole("button", { name: "Show fewer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("every word it draws is a key the Dashboard's locales hold", () => {
    const keys: Record<string, unknown> = enLocale as Record<string, unknown>;

    for (const label of Object.values(SKIPPED_TABLE_READ_LABELS)) {
      expect(keys[label]).toBe(label);
    }

    for (const key of [
      "Skipped Tables",
      "The database refused these tables, so collections skip each one until its next try instead of asking every five minutes. Collect Now asks them all again at once.",
      "Asked again {{time}}",
      "Asked again at the next collection",
      "Show all {{count}}",
      "Show fewer",
    ]) {
      expect(keys[key]).toBe(key);
    }
  });
});

describe("the database's page", () => {
  function StoreLayout(props: {
    current: DataObservabilityStoreSummary;
  }): React.ReactElement {
    const context: StoreViewOutletContext = {
      dataStoreId: new ObjectID(STORE_ID),
      store: props.current,
      refresh: (): void => {
        return;
      },
    };

    return <Outlet context={context} />;
  }

  const pageProps: PageComponentProps = {
    pageRoute: new Route(`/dashboard/${PROJECT_ID}/data-observability`),
    currentProject: null,
    hasPaymentMethod: true,
  };

  async function openStorePage(
    current: DataObservabilityStoreSummary,
  ): Promise<void> {
    goTo(`/dashboard/${PROJECT_ID}/data-observability`);
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
      new ObjectID(PROJECT_ID),
    );
    getJestSpyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest.spyOn(Navigation, "navigate").mockImplementation((): void => {
      return;
    });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/store"]}>
          <Routes>
            <RouterRoute
              path="/store"
              element={<StoreLayout current={current} />}
            >
              <RouterRoute
                index
                element={<StoreOverviewPage {...pageProps} />}
              />
            </RouterRoute>
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  test("lists the tables the database keeps refusing, after how its collection went", async () => {
    await openStorePage(store({ skippedTables: [skipped()] }));

    const heading: HTMLElement = screen.getByText("Skipped Tables");
    const card: HTMLElement = heading.closest("div.shadow")
      ? (heading.closest("div.shadow") as HTMLElement)
      : document.body;

    expect(within(card).getByText("cr123_secret")).toBeInTheDocument();
    expect(within(card).getByText(REFUSED)).toBeInTheDocument();
    // After the Collection card, before the alerts: what most people open the page for comes first.
    const text: string = document.body.textContent || "";

    expect(text.indexOf("Collection")).toBeLessThan(
      text.indexOf("Skipped Tables"),
    );
    expect(text.indexOf("Skipped Tables")).toBeLessThan(text.indexOf("Alerts"));
  });

  test("a database that skips none, or a server that does not say, shows no such card", async () => {
    await openStorePage(store({ skippedTables: [] }));
    expect(screen.queryByText("Skipped Tables")).not.toBeInTheDocument();
    cleanup();

    await openStorePage(store());
    expect(screen.queryByText("Skipped Tables")).not.toBeInTheDocument();
  });
});
