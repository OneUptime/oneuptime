import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * WHY A BI TOOL'S TABLES MATCHED IS WHAT IT IS (#9507).
 *
 * Tables Matched on the BI Tools list says the first reason under its count
 * and opens the Tables Matched dialog: what the last read found, the steps
 * that fix what keeps dashboards off their tables - Power BI's tenant
 * settings named as its admin portal names them - and where the data comes
 * from, a database OneUptime does not watch one Connect Database away. A
 * dashboard's Built On says its datasets and data sources. The database
 * form is a stand-in that shows what it was started from.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/ConnectDatabaseModal",
  () => {
    return {
      __esModule: true,
      default: (props: {
        suggestion?: {
          name: string;
          kind: string | null;
          connectionExample: string | null;
          origin: string;
        };
        onClose: () => void;
      }): ReactElement => {
        return React.createElement(
          "div",
          { "data-testid": "connect-database" },
          `${props.suggestion?.name} | ${props.suggestion?.kind} | ${props.suggestion?.connectionExample} | ${props.suggestion?.origin}`,
          React.createElement(
            "button",
            {
              "data-testid": "connect-database-cancel",
              onClick: props.onClose,
            },
            "Cancel",
          ),
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/OverviewAttention",
  () => {
    return {
      __esModule: true,
      getStoreAlertsRoute: (): string => {
        return "/stores/alerts";
      },
    };
  },
);

import {
  DataBiLineageProblem,
  DataBiLineageSource,
  DataBiLineageSummary,
  DataBiSource,
} from "../../../Types/DataObservability/DataBiLineage";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import BiLineageDialog, {
  getBiSourceSuggestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/BiLineageDialog";
import {
  BiBuiltOnCell,
  BiTablesMatchedCell,
  getBiBuiltOnText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/BiLineageCells";
import {
  BiSourceStanding,
  POWER_BI_DETAILED_METADATA_SETTING,
  POWER_BI_EXPRESSIONS_SETTING,
  getBiLineageFacts,
  getBiLineageReason,
  getBiLineageStep,
  getBiSourceStanding,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/BiLineageWords";

const FACILITIES: DataBiLineageSource = {
  type: "SQL Server",
  engine: "sqlserver",
  server: "sql01.corp.acme.com",
  database: "Facilities",
  location: null,
  readerCount: 12,
  tableCount: 0,
  matchedTableCount: 0,
  dataStoreId: null,
  connectKind: DataStoreKind.SqlServer,
  connectionExample:
    "mssql://USER:PASSWORD@sql01.corp.acme.com:1433/Facilities",
};
const SALES: DataBiLineageSource = {
  ...FACILITIES,
  database: "Sales",
  readerCount: 3,
  tableCount: 5,
  matchedTableCount: 4,
  dataStoreId: "store-sales",
  connectKind: null,
  connectionExample: null,
};
const CHECKLISTS: DataBiLineageSource = {
  type: "SharePoint",
  engine: null,
  server: null,
  database: null,
  location: "https://acme.sharepoint.com/sites/facilities",
  readerCount: 40,
  tableCount: 0,
  matchedTableCount: 0,
  dataStoreId: null,
  connectKind: null,
  connectionExample: null,
};

// The issue's tool: hundreds of reports, datasets Power BI described without their tables.
function summary(
  data: Partial<DataBiLineageSummary> = {},
): DataBiLineageSummary {
  return {
    dashboardCount: 783,
    dashboardsOnWatchedTables: 0,
    tableCount: 0,
    matchedTableCount: 0,
    datasets: {
      count: 59,
      withTables: 0,
      withQueries: 0,
      withSchemaError: 0,
      schemaError: null,
      readingDataflows: 0,
    },
    sources: [CHECKLISTS, FACILITIES],
    moreSourceCount: 0,
    unwatchedTables: [],
    problems: [
      DataBiLineageProblem.NoTablesFromTool,
      DataBiLineageProblem.DatabasesNotConnected,
      DataBiLineageProblem.NotDatabases,
    ],
    ...data,
  };
}

afterEach(() => {
  cleanup();
});

describe("the words of a tool's summary", () => {
  test("the first reason, in a few words, for each problem", () => {
    const translator: ReturnType<typeof getGlobalTranslator> =
      getGlobalTranslator();
    const reason: (
      problems: Array<DataBiLineageProblem>,
      more?: Partial<DataBiLineageSummary>,
    ) => string | null = (
      problems: Array<DataBiLineageProblem>,
      more: Partial<DataBiLineageSummary> = {},
    ): string | null => {
      return getBiLineageReason(translator, summary({ problems, ...more }));
    };

    expect(reason([DataBiLineageProblem.NoDatabases])).toBe(
      "No database connected yet",
    );
    expect(reason([DataBiLineageProblem.NoTablesFromTool])).toBe(
      "Power BI sent no tables",
    );
    expect(reason([DataBiLineageProblem.NoQueriesFromTool])).toBe(
      "Power BI sent no table queries",
    );
    expect(reason([DataBiLineageProblem.DatabasesNotConnected])).toBe(
      "1 database not connected",
    );
    expect(
      reason([DataBiLineageProblem.TablesNotWatched], {
        unwatchedTables: ["Sales.dbo.A", "Sales.dbo.B"],
      }),
    ).toBe("2 tables not watched");
    expect(reason([DataBiLineageProblem.Dataflows])).toBe(
      "Some data comes from dataflows",
    );
    expect(reason([DataBiLineageProblem.NotDatabases])).toBe(
      "Some data comes from files and web pages",
    );
    expect(reason([])).toBeNull();
  });

  test("each step says what to do: Power BI's settings named as its admin portal names them", () => {
    const translator: ReturnType<typeof getGlobalTranslator> =
      getGlobalTranslator();
    const tables: { title: string; text: string } = getBiLineageStep(
      translator,
      DataBiLineageProblem.NoTablesFromTool,
      summary(),
    );

    expect(tables.title).toBe("Let Power BI Describe Its Tables");
    expect(tables.text).toContain(
      "Power BI described 59 datasets without their tables.",
    );
    expect(tables.text).toContain(POWER_BI_DETAILED_METADATA_SETTING);
    expect(tables.text).toContain(POWER_BI_EXPRESSIONS_SETTING);
    expect(tables.text).toContain("Tenant settings > Admin API settings");

    expect(
      getBiLineageStep(
        translator,
        DataBiLineageProblem.NoQueriesFromTool,
        summary(),
      ).text,
    ).toContain(POWER_BI_EXPRESSIONS_SETTING);
    expect(
      getBiLineageStep(
        translator,
        DataBiLineageProblem.SchemaErrors,
        summary({
          datasets: {
            count: 2,
            withTables: 0,
            withQueries: 0,
            withSchemaError: 1,
            schemaError:
              "Unsupported request. RealTime dataset are not supported",
            readingDataflows: 0,
          },
        }),
      ).text,
    ).toContain(
      "Power BI could not describe 1 dataset, and said: Unsupported request. RealTime dataset are not supported",
    );
    expect(
      getBiLineageStep(
        translator,
        DataBiLineageProblem.TablesNotWatched,
        summary({ unwatchedTables: ["Sales.dbo.Orders"] }),
      ).text,
    ).toContain("Sales.dbo.Orders");
  });

  test("what the read found, in a line, and each source's standing", () => {
    const translator: ReturnType<typeof getGlobalTranslator> =
      getGlobalTranslator();

    expect(getBiLineageFacts(translator, summary())).toEqual([
      "783 dashboards read",
      "built on 59 datasets",
      "no database tables read",
    ]);
    expect(
      getBiLineageFacts(
        translator,
        summary({
          datasets: null,
          dashboardCount: 1,
          tableCount: 5,
          matchedTableCount: 4,
        }),
      ),
    ).toEqual(["1 dashboard read", "4 of 5 tables watched"]);
    expect(getBiSourceStanding(translator, SALES)).toEqual({
      standing: BiSourceStanding.Watched,
      text: "Watched",
    });
    expect(getBiSourceStanding(translator, FACILITIES)).toEqual({
      standing: BiSourceStanding.NotConnected,
      text: "Not connected",
    });
    expect(getBiSourceStanding(translator, CHECKLISTS).standing).toBe(
      BiSourceStanding.Elsewhere,
    );
  });

  test("a database to connect starts Connect Database from its kind and address", () => {
    expect(getBiSourceSuggestion(FACILITIES)).toEqual({
      id: "bi:sql01.corp.acme.com / Facilities",
      dataStoreId: null,
      name: "Facilities",
      kind: DataStoreKind.SqlServer,
      origin: "BI Tool",
      connectionExample:
        "mssql://USER:PASSWORD@sql01.corp.acme.com:1433/Facilities",
    });
  });
});

describe("Tables Matched on the BI Tools list", () => {
  test("the count, the first reason, and See Why", () => {
    const explain: Mock = jest.fn();

    render(
      <BiTablesMatchedCell
        matchedTableCount={0}
        summary={summary()}
        onExplain={explain}
      />,
    );

    expect(screen.getByTestId("bi-tables-matched")).toHaveTextContent("0");
    expect(screen.getByTestId("bi-tables-matched-reason")).toHaveTextContent(
      "Power BI sent no tables",
    );
    fireEvent.click(screen.getByTestId("bi-tables-matched-why"));
    expect(explain).toHaveBeenCalledTimes(1);
  });

  test("a tool with nothing in the way, or read before the summary was kept, shows only its count", () => {
    render(
      <BiTablesMatchedCell
        matchedTableCount={12}
        summary={summary({ problems: [] })}
        onExplain={(): void => {}}
      />,
    );

    expect(screen.getByTestId("bi-tables-matched")).toHaveTextContent("12");
    expect(screen.queryByTestId("bi-tables-matched-why")).toBeNull();

    cleanup();
    render(
      <BiTablesMatchedCell
        matchedTableCount={undefined}
        summary={null}
        onExplain={(): void => {}}
      />,
    );
    expect(screen.queryByTestId("bi-tables-matched-reason")).toBeNull();
  });
});

describe("the Tables Matched dialog", () => {
  test("what the read found, the steps in order, and where the data comes from", () => {
    render(
      <BiLineageDialog
        name="Oneuptime PBI Data Observability"
        summary={summary({
          sources: [CHECKLISTS, FACILITIES, SALES],
          moreSourceCount: 2,
        })}
        onClose={(): void => {}}
      />,
    );

    expect(screen.getByText("Tables Matched")).toBeInTheDocument();
    expect(
      screen.getByText("Oneuptime PBI Data Observability"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("bi-lineage-facts")).toHaveTextContent(
      "783 dashboards read · built on 59 datasets · no database tables read",
    );

    const steps: Array<HTMLElement> = within(
      screen.getByTestId("bi-lineage-steps"),
    ).getAllByRole("listitem");

    expect(
      steps.map((step: HTMLElement): string => {
        return step.querySelector("p")?.textContent || "";
      }),
    ).toEqual([
      "Let Power BI Describe Its Tables",
      "Connect the Databases Your Dashboards Read",
      "Data From Files and Web Pages",
    ]);

    const sources: Array<HTMLElement> =
      screen.getAllByTestId("bi-lineage-source");

    expect(sources[0]).toHaveTextContent(
      "https://acme.sharepoint.com/sites/facilities",
    );
    expect(sources[0]).toHaveTextContent("SharePoint · 40 datasets");
    expect(sources[0]).toHaveTextContent("Not a database OneUptime reads");
    expect(sources[1]).toHaveTextContent("sql01.corp.acme.com / Facilities");
    expect(sources[1]).toHaveTextContent("Not connected");
    expect(sources[2]).toHaveTextContent(
      "SQL Server · 3 datasets · 4 of 5 tables watched",
    );
    expect(within(sources[2]!).getByText("Watched")).toBeInTheDocument();
    // Only a database OneUptime can watch, and does not, is offered to connect.
    expect(screen.getAllByTestId("bi-lineage-connect")).toHaveLength(1);
    expect(screen.getByText("And 2 more data sources.")).toBeInTheDocument();
    expect(screen.getByTestId("bi-lineage-docs")).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/data-observability/lineage-and-pipelines#power-bi-lineage",
      ),
    );
  });

  test("Connect Database opens the database's form in place of the dialog, and Cancel comes back", () => {
    render(
      <BiLineageDialog
        name="Power BI"
        summary={summary()}
        onClose={(): void => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("bi-lineage-connect"));
    expect(screen.queryByTestId("bi-lineage-dialog")).toBeNull();
    expect(screen.getByTestId("connect-database")).toHaveTextContent(
      "Facilities | SQL Server | mssql://USER:PASSWORD@sql01.corp.acme.com:1433/Facilities | BI Tool",
    );

    fireEvent.click(screen.getByTestId("connect-database-cancel"));
    expect(screen.getByTestId("bi-lineage-dialog")).toBeInTheDocument();
  });

  test("nothing in the way: it says so", () => {
    render(
      <BiLineageDialog
        name="Metabase"
        summary={summary({
          problems: [],
          datasets: null,
          tableCount: 3,
          matchedTableCount: 3,
          sources: [SALES],
        })}
        onClose={(): void => {}}
      />,
    );

    expect(screen.queryByTestId("bi-lineage-steps")).toBeNull();
    expect(
      screen.getByText("Every table these dashboards read is watched."),
    ).toBeInTheDocument();
  });
});

describe("Built On on the BI Dashboards list", () => {
  const SHAREPOINT: DataBiSource = {
    type: "SharePoint",
    engine: null,
    server: null,
    database: null,
    location: "https://acme.sharepoint.com/sites/facilities",
  };
  const DB: DataBiSource = {
    type: "SQL Server",
    engine: "sqlserver",
    server: "sql01",
    database: "Facilities",
    location: null,
  };

  test("its datasets, then where their data comes from, the rest counted", () => {
    render(
      <BiBuiltOnCell
        upstream={{
          datasets: ["Checklist", "Gantt", "Units"].map((name: string) => {
            return {
              id: name,
              name,
              workspace: "New Unit Readiness",
              sources: [],
            };
          }),
          sources: [SHAREPOINT, DB, { ...DB, database: "Archive" }],
        }}
      />,
    );

    const cell: HTMLElement = screen.getByTestId("bi-built-on");

    expect(cell).toHaveTextContent("Checklist, Gantt +1 more");
    expect(cell).toHaveTextContent(
      "SharePoint · https://acme.sharepoint.com/sites/facilities",
    );
    expect(cell).toHaveTextContent("SQL Server · sql01 / Facilities");
    expect(cell).not.toHaveTextContent("Archive");
    expect(
      getBiBuiltOnText(getGlobalTranslator(), {
        datasets: [
          { id: "a", name: "Checklist", workspace: null, sources: [] },
        ],
        sources: [DB],
      }),
    ).toBe("Checklist; SQL Server · sql01 / Facilities");
  });

  test("nothing said, the quiet dash", () => {
    render(<BiBuiltOnCell upstream={null} />);
    expect(screen.queryByTestId("bi-built-on")).toBeNull();
    expect(getBiBuiltOnText(getGlobalTranslator(), null)).toBe("");
  });
});
