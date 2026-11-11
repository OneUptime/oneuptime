import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import AlertElement from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/Alert";
import AlertEpisodeElement from "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/AlertEpisode";
import DashboardElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardElement";
import IncidentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/Incident";
import IncidentEpisodeElement from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisode";
import MonitorElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Monitor";
import StatusPageElement from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageElement";
import WorkflowElement from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowElement";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import TableBody from "../../../UI/Components/Table/TableBody";
import Column from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import { LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import {
  RECORD_NAME_ELEMENTS,
  scanTableNameColumns,
  TableNameColumn,
} from "../../Helpers/TableNameColumnScan";

/*
 * THE RECORD LINKS A LIST HANDS ITS ROW TO DRAW ITS NAME AND NOTHING ELSE.
 *
 * The incident, alert, episode, monitor, dashboard, status page and
 * workflow lists draw a row's title or name as a link to it
 * (`<IncidentElement incident={item} />`), and say nothing of its words:
 * a column on a record's name or title reads that field (ColumnLineText).
 * That is right only while each link draws the name and nothing else - an
 * icon or a badge beside it would be turned round with it. The guard
 * (TableNameColumnScan's RECORD_NAME_ELEMENTS) lets a column hand its row
 * to these links alone; each is drawn here, in a table's cell on an Arabic
 * and a Persian page, with an English name: the cell reads left to right
 * and is cut at the name's own end, and draws the name, as a link to the
 * record, and nothing else.
 */

// A list's row as its table reads it: a record with a name or a title.
interface NamedRow {
  _id?: unknown;
  name?: unknown;
  title?: unknown;
  priority?: unknown;
}

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);
const RECORD_ID: string = "6c0a5b3e-2f7d-4c1e-9a8b-0d4e2f1a3b5c";

interface RecordLink {
  element: string;
  field: "name" | "title";
  englishName: string;
  makeRow: (value: string) => NamedRow;
  draw: (row: NamedRow) => ReactElement;
  // A list that draws it so: where the column on this link is.
  listFile: string;
}

const RECORD_LINKS: Array<RecordLink> = [
  {
    element: "AlertElement",
    field: "title",
    englishName: "Disk usage above 90% on db-primary-eu-west-1",
    makeRow: (value: string): NamedRow => {
      const alert: Alert = new Alert();
      alert._id = RECORD_ID;
      alert.title = value;
      return alert as unknown as NamedRow;
    },
    draw: (row: NamedRow): ReactElement => {
      return <AlertElement alert={row as unknown as Alert} />;
    },
    listFile:
      "packages/App/FeatureSet/Dashboard/src/Components/Alert/AlertsTable.tsx",
  },
  {
    element: "AlertEpisodeElement",
    field: "title",
    englishName: "Checkout errors (12 alerts) since the 14:05 deploy",
    makeRow: (value: string): NamedRow => {
      const episode: AlertEpisode = new AlertEpisode();
      episode._id = RECORD_ID;
      episode.title = value;
      return episode as unknown as NamedRow;
    },
    draw: (row: NamedRow): ReactElement => {
      return (
        <AlertEpisodeElement alertEpisode={row as unknown as AlertEpisode} />
      );
    },
    listFile:
      "packages/App/FeatureSet/Dashboard/src/Components/AlertEpisode/AlertEpisodesTable.tsx",
  },
  {
    element: "DashboardElement",
    field: "name",
    englishName: "Payments - API latency (p95) by region",
    makeRow: (value: string): NamedRow => {
      const dashboard: Dashboard = new Dashboard();
      dashboard._id = RECORD_ID;
      dashboard.name = value;
      return dashboard as unknown as NamedRow;
    },
    draw: (row: NamedRow): ReactElement => {
      return <DashboardElement dashboard={row as unknown as Dashboard} />;
    },
    listFile:
      "packages/App/FeatureSet/Dashboard/src/Pages/Dashboards/Dashboards.tsx",
  },
  {
    element: "IncidentElement",
    field: "title",
    englishName: "Checkout API latency above 2s for EU customers",
    makeRow: (value: string): NamedRow => {
      const incident: Incident = new Incident();
      incident._id = RECORD_ID;
      incident.title = value;
      return incident as unknown as NamedRow;
    },
    draw: (row: NamedRow): ReactElement => {
      return <IncidentElement incident={row as unknown as Incident} />;
    },
    listFile:
      "packages/App/FeatureSet/Dashboard/src/Components/Incident/IncidentsTable.tsx",
  },
  {
    element: "IncidentEpisodeElement",
    field: "title",
    englishName: "Payments outage (3 incidents), EU and US",
    makeRow: (value: string): NamedRow => {
      const episode: IncidentEpisode = new IncidentEpisode();
      episode._id = RECORD_ID;
      episode.title = value;
      return episode as unknown as NamedRow;
    },
    draw: (row: NamedRow): ReactElement => {
      return (
        <IncidentEpisodeElement
          incidentEpisode={row as unknown as IncidentEpisode}
        />
      );
    },
    listFile:
      "packages/App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodesTable.tsx",
  },
  {
    element: "MonitorElement",
    field: "name",
    englishName: "checkout-api.acme.com (HTTPS, every 30s)",
    makeRow: (value: string): NamedRow => {
      const monitor: Monitor = new Monitor();
      monitor._id = RECORD_ID;
      monitor.name = value;
      return monitor as unknown as NamedRow;
    },
    draw: (row: NamedRow): ReactElement => {
      return <MonitorElement monitor={row as unknown as Monitor} />;
    },
    listFile:
      "packages/App/FeatureSet/Dashboard/src/Pages/Slo/View/Monitors.tsx",
  },
  {
    element: "StatusPageElement",
    field: "name",
    englishName: "Acme Cloud status (public)",
    makeRow: (value: string): NamedRow => {
      const statusPage: StatusPage = new StatusPage();
      statusPage._id = RECORD_ID;
      statusPage.name = value;
      return statusPage as unknown as NamedRow;
    },
    draw: (row: NamedRow): ReactElement => {
      return <StatusPageElement statusPage={row as unknown as StatusPage} />;
    },
    listFile:
      "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages.tsx",
  },
  {
    element: "WorkflowElement",
    field: "name",
    englishName: "Page the on-call DBA when replication lags",
    makeRow: (value: string): NamedRow => {
      const workflow: Workflow = new Workflow();
      workflow._id = RECORD_ID;
      workflow.name = value;
      return workflow as unknown as NamedRow;
    },
    draw: (row: NamedRow): ReactElement => {
      return <WorkflowElement workflow={row as unknown as Workflow} />;
    },
    listFile:
      "packages/App/FeatureSet/Dashboard/src/Pages/Workflow/Workflows.tsx",
  },
];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "ar", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        ar: { translation: {} },
        fa: { translation: {} },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

// The record's link in a table's first cell, as its list draws it.
const drawInACell: (
  link: RecordLink,
  language: string,
  value: string,
) => HTMLElement = (
  link: RecordLink,
  language: string,
  value: string,
): HTMLElement => {
  const column: Column<NamedRow> = {
    title: link.field === "title" ? "Title" : "Name",
    type: FieldType.Element,
    key: link.field,
    getElement: link.draw,
  };

  render(
    <MemoryRouter>
      <I18nextProvider i18n={instances[language]!}>
        <table>
          <TableBody<NamedRow>
            id="record-name-body"
            data={[link.makeRow(value)]}
            columns={[
              column,
              { title: "Priority", type: FieldType.Number, key: "priority" },
            ]}
            selectedItems={[]}
            matchBulkSelectedItemByField={undefined}
            isMobile={false}
          />
        </table>
      </I18nextProvider>
    </MemoryRouter>,
  );

  return document.querySelector("tbody td") as HTMLElement;
};

test("every record link the guard lets a column hand its row to is drawn here", () => {
  expect(
    RECORD_LINKS.map((link: RecordLink): string => {
      return link.element;
    }),
  ).toEqual([...RECORD_NAME_ELEMENTS]);
});

describe.each(
  RECORD_LINKS.map((link: RecordLink): [string, RecordLink] => {
    return [link.element, link];
  }),
)("<%s> in a table's cell", (_element: string, link: RecordLink) => {
  test.each(["ar", "fa"])(
    "on a %s page an English name reads left to right, cut at its own end",
    (language: string) => {
      const cell: HTMLElement = drawInACell(link, language, link.englishName);
      const box: HTMLElement = cell.firstElementChild as HTMLElement;

      expect(box).toHaveAttribute("dir", "ltr");
      expect(box).toHaveClass(
        ...LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
      );
      expect(box).toHaveClass("overflow-x-clip", "text-ellipsis");

      // The name and nothing else: no words, no mark, no badge of its own.
      expect(cell.textContent?.trim()).toBe(link.englishName);
      expect(cell.querySelector("svg, img, [data-testid=pill]")).toBeNull();

      // Still the link to the record.
      const anchor: HTMLAnchorElement = screen.getByRole("link", {
        name: link.englishName,
      });

      expect(anchor.getAttribute("href")).toContain(RECORD_ID);
    },
  );

  test("on an Arabic page an Arabic name is drawn as it always was", () => {
    const cell: HTMLElement = drawInACell(
      link,
      "ar",
      "ارتفاع زمن الاستجابة في واجهة الدفع",
    );

    expect(cell.firstElementChild).not.toHaveAttribute("dir");
  });

  test("on an English page an English name is drawn as it always was", () => {
    const cell: HTMLElement = drawInACell(link, "en", link.englishName);

    expect(cell.firstElementChild).not.toHaveAttribute("dir");
    expect(cell.firstElementChild).not.toHaveClass("[text-align-last:end]");
  });

  test("its list hands it the row alone, on the record's own field, with no words of its own (the default)", () => {
    const file: string = path.join(REPOSITORY_ROOT, link.listFile);
    const columns: Array<TableNameColumn> = scanTableNameColumns(
      fs.readFileSync(file, "utf8"),
      link.listFile,
    ).filter((column: TableNameColumn): boolean => {
      return column.field === link.field && column.isNameOnly;
    });

    expect(columns.length).toBeGreaterThan(0);
    expect(fs.readFileSync(file, "utf8").includes(`<${link.element} `)).toBe(
      true,
    );
    // The default draws its line: the column names no words over it.
    expect(
      columns.some((column: TableNameColumn): boolean => {
        return !column.hasLineText;
      }),
    ).toBe(true);
  });
});
