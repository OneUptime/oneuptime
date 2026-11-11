import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * A NAME IN A CELL THAT LAYS OUT MORE, IN AN ARABIC OR PERSIAN LIST (#6657,
 * its UI review).
 *
 * A name cell with a logo beside the name, or a line of the page's words
 * under it, keeps the page's way (drawsItsOwnLines). Drawn inline there
 * (IsolatedText), an English name read its own way but its box was the
 * page's, so a name too long for its column was clipped where the page's
 * lines end - at its start, with no "..." ("gateway-eu-west-1 (primary)"
 * on an Arabic page). Each of these draws its name on a line of its own
 * (IsolatedLine): read the way it is written and cut short at its own end.
 * These take the real columns the lists hand their table, and the real
 * cells, and draw them as a table does.
 */

type CapturedColumn = {
  title: string;
  field?: Record<string, unknown> | undefined;
  getLineText?: ((item: unknown) => string | undefined) | undefined;
  getElement?: ((item: unknown) => ReactElement) | undefined;
};

let capturedColumns: Array<CapturedColumn> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { columns?: Array<CapturedColumn> | undefined }) => {
      capturedColumns = props.columns || [];
      return null;
    },
  };
});

import SecurityEventDestinationsTable from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDestinationsTable";
import NetworkDeviceNamingRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/NamingRules";
import DataSecurityResidency from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/Residency";
import AppPlatformsArchivedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Archived";
import CloudArchivedPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Archived";
import { CloudRuleName } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudRuleKind";
import { PlaylistNameCell } from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Playlists/Playlists";
import CodeRepositoriesTable from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoriesTable";
import { CodeRepositoryListItem } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import ServiceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Service/ServiceElement";
import SecurityEventDestination from "../../../Models/DatabaseModels/SecurityEventDestination";
import NetworkDeviceNamingRule from "../../../Models/DatabaseModels/NetworkDeviceNamingRule";
import DataSecurityResidencyRule from "../../../Models/DatabaseModels/DataSecurityResidencyRule";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudResourceOwnerRule from "../../../Models/DatabaseModels/CloudResourceOwnerRule";
import Service from "../../../Models/DatabaseModels/Service";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import SecurityEventDestinationProvider from "../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import TableBody from "../../../UI/Components/Table/TableBody";
import Column from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import {
  TableCellContext,
  TableFoldedColumnsContext,
} from "../../../UI/Components/Table/TableCellContext";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";

// A list's row as its table reads it: a record with a name.
interface NamedRow {
  _id?: unknown;
  name?: unknown;
  priority?: unknown;
}

const RECORD_ID: string = "7d1e2c3b-4a5f-4e6d-8c7b-9a0b1c2d3e4f";
const ENGLISH_NAME: string = "payments-gateway-eu-west-1 (primary)";
const ENGLISH_DESCRIPTION: string =
  "Every card payment of the EU storefront, kept in Frankfurt.";
const ARABIC_NAME: string = "بوابة الدفع الرئيسية";

const PAGE_PROPS: {
  pageRoute: Route;
  currentProject: null;
  hasPaymentMethod: boolean;
} = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: true,
};

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

// The column on the record's name a list hands its table (ModelTable).
const nameColumnOf: (list: ReactElement) => Column<NamedRow> = (
  list: ReactElement,
): Column<NamedRow> => {
  capturedColumns = [];
  render(<MemoryRouter>{list}</MemoryRouter>);
  cleanup();

  const column: CapturedColumn | undefined = capturedColumns.find(
    (each: CapturedColumn): boolean => {
      return Boolean(each.field && "name" in each.field);
    },
  );

  expect(column).toBeDefined();
  // It lays out more than the name: the cell keeps the page's way.
  expect(column!.getLineText).toBeDefined();

  return { ...(column as unknown as Column<NamedRow>), key: "name" };
};

// The row drawn in a table's body; its name's cell.
const drawRow: (data: {
  language: string;
  column: Column<NamedRow>;
  row: NamedRow;
}) => HTMLElement = (data: {
  language: string;
  column: Column<NamedRow>;
  row: NamedRow;
}): HTMLElement => {
  render(
    <MemoryRouter>
      <I18nextProvider i18n={instances[data.language]!}>
        <table>
          <TableBody<NamedRow>
            id="mixed-name-cells"
            data={[data.row]}
            columns={[
              data.column,
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

const drawOn: (language: string, element: ReactElement) => HTMLElement = (
  language: string,
  element: ReactElement,
): HTMLElement => {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>
    </MemoryRouter>,
  ).container;
};

// The box that draws exactly these words.
const lineOf: (text: string) => HTMLElement = (text: string): HTMLElement => {
  return screen.getByText(text);
};

// A line of its own, read left to right and cut short at its own end.
const expectOwnLine: (
  line: HTMLElement,
  ...classNames: Array<string>
) => void = (line: HTMLElement, ...classNames: Array<string>): void => {
  expect(line).toHaveAttribute("dir", "ltr");
  expect(line).toHaveClass(
    "truncate",
    LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
    ...classNames,
  );
};

const destination: (name: string) => NamedRow = (name: string): NamedRow => {
  const value: SecurityEventDestination = new SecurityEventDestination();
  value._id = RECORD_ID;
  value.name = name;
  value.provider = SecurityEventDestinationProvider.GoogleSecOps;

  return value as unknown as NamedRow;
};

const namingRule: () => NamedRow = (): NamedRow => {
  const rule: NetworkDeviceNamingRule = new NetworkDeviceNamingRule();
  rule._id = RECORD_ID;
  rule.name = ENGLISH_NAME;
  rule.description = ENGLISH_DESCRIPTION;

  return rule as unknown as NamedRow;
};

const residencyRule: () => NamedRow = (): NamedRow => {
  const rule: DataSecurityResidencyRule = new DataSecurityResidencyRule();
  rule._id = RECORD_ID;
  rule.name = ENGLISH_NAME;
  rule.description = ENGLISH_DESCRIPTION;

  return rule as unknown as NamedRow;
};

const archivedResource: () => NamedRow = (): NamedRow => {
  const resource: CloudResource = new CloudResource();
  resource._id = RECORD_ID;
  resource.name = ENGLISH_NAME;

  return resource as unknown as NamedRow;
};

const REPOSITORY: CodeRepositoryListItem = {
  id: RECORD_ID,
  name: "payments-gateway-service-for-the-eu-storefront",
  description: ENGLISH_DESCRIPTION,
  organizationName: "acme-commerce",
  repositoryName: "payments-gateway-service-for-the-eu-storefront",
  isConnected: true,
  provider: "GitHub",
  stats: { working: 0, waitingForYou: 0, openPullRequests: 0, taskCount: 0 },
} as CodeRepositoryListItem;

describe.each([
  ["an Arabic page", "ar"],
  ["a Persian page", "fa"],
])("on %s", (_page: string, language: string) => {
  test("a SIEM destination: its logo at the line's start, its English name cut at its own end", () => {
    const cell: HTMLElement = drawRow({
      language,
      column: nameColumnOf(<SecurityEventDestinationsTable />),
      row: destination(ENGLISH_NAME),
    });

    expect(cell.firstElementChild).not.toHaveAttribute("dir");
    expectOwnLine(lineOf(ENGLISH_NAME));
    // What it is, under it, is the page's line.
    expect(
      within(cell).getByTestId("security-event-destination-detail"),
    ).not.toHaveAttribute("dir");
  });

  test("a naming rule: its English name and its description each cut at their own end", () => {
    const cell: HTMLElement = drawRow({
      language,
      column: nameColumnOf(<NetworkDeviceNamingRulesPage {...PAGE_PROPS} />),
      row: namingRule(),
    });

    expect(cell.firstElementChild).not.toHaveAttribute("dir");
    expectOwnLine(lineOf(ENGLISH_NAME), "block");
    expectOwnLine(lineOf(ENGLISH_DESCRIPTION), "block");
  });

  test("a residency rule: its English name and its description each cut at their own end", () => {
    drawRow({
      language,
      column: nameColumnOf(<DataSecurityResidency {...PAGE_PROPS} />),
      row: residencyRule(),
    });

    expectOwnLine(lineOf(ENGLISH_NAME));
    expectOwnLine(lineOf(ENGLISH_DESCRIPTION));
  });

  test.each([
    ["App Platforms", <AppPlatformsArchivedPage key="app" {...PAGE_PROPS} />],
    ["Cloud", <CloudArchivedPage key="cloud" {...PAGE_PROPS} />],
  ])(
    "an archived %s resource: its line reads its way, its link inside it",
    (_product: string, page: ReactElement) => {
      drawRow({
        language,
        column: nameColumnOf(page),
        row: archivedResource(),
      });

      const link: HTMLElement = screen.getByRole("link", {
        name: ENGLISH_NAME,
      });
      const line: HTMLElement = link.parentElement as HTMLElement;

      expectOwnLine(line);
      expect(link).not.toHaveAttribute("dir");
    },
  );

  test("a cloud rule's English name is cut at its own end, its pill the page's", () => {
    const rule: CloudResourceOwnerRule = new CloudResourceOwnerRule();
    rule.name = ENGLISH_NAME;

    drawOn(
      language,
      <CloudRuleName rule={rule} kind={CloudResourceKind.Resource} />,
    );

    const name: HTMLElement = lineOf(ENGLISH_NAME);

    expect(name.tagName).toBe("SPAN");
    expectOwnLine(name, "min-w-0");
    expect(name.parentElement).not.toHaveAttribute("dir");
  });

  test("a playlist with nothing under its name: its English name is a line of its own", () => {
    drawOn(
      language,
      <TableCellContext.Provider value={true}>
        <TableFoldedColumnsContext.Provider value={false}>
          <PlaylistNameCell
            name={ENGLISH_NAME}
            summary="3 dashboards, 1 minute each"
            hasDashboards={true}
          />
        </TableFoldedColumnsContext.Provider>
      </TableCellContext.Provider>,
    );

    expectOwnLine(lineOf(ENGLISH_NAME));
  });

  test("a repository: its name, its organization/name and its description each cut at their own end", () => {
    drawOn(
      language,
      <CodeRepositoriesTable id="repositories" repositories={[REPOSITORY]} />,
    );

    const name: HTMLElement = screen.getByTestId("code-repository-name");

    // The name is a link whose own line reads its way.
    expect(name.tagName).toBe("A");
    expectOwnLine(name);
    expectOwnLine(screen.getByTestId("code-repository-full-name"));
    expectOwnLine(screen.getByTestId("code-repository-row-description"));
  });

  test("a service: its colour and its English name keep their gap on either side", () => {
    const service: Service = new Service();
    service._id = RECORD_ID;
    service.name = ENGLISH_NAME;
    service.serviceColor = new Color("#0ea5e9");

    drawOn(language, <ServiceElement service={service} />);

    const row: HTMLElement = lineOf(ENGLISH_NAME).closest(
      ".flex",
    ) as HTMLElement;

    /*
     * A gap, not space-x: space-x's margin is at the start of the name, and
     * an English name's start is at its far side - it touched the colour.
     */
    expect(row).toHaveClass("gap-2");
    expect(row.className).not.toMatch(/space-x-/);
  });

  test("a name in the page's script is drawn as it always was", () => {
    drawRow({
      language,
      column: nameColumnOf(<SecurityEventDestinationsTable />),
      row: destination(ARABIC_NAME),
    });

    const name: HTMLElement = lineOf(ARABIC_NAME);

    expect(name).not.toHaveAttribute("dir");
    expect(name).toHaveClass("truncate");
    expect(name).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });
});

describe("on an English page", () => {
  test("an English name's line is drawn as the box it replaced: no way of its own", () => {
    drawRow({
      language: "en",
      column: nameColumnOf(<NetworkDeviceNamingRulesPage {...PAGE_PROPS} />),
      row: namingRule(),
    });

    for (const text of [ENGLISH_NAME, ENGLISH_DESCRIPTION]) {
      const line: HTMLElement = lineOf(text);

      expect(line).not.toHaveAttribute("dir");
      expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
      expect(line).toHaveClass("block", "truncate");
    }
  });

  test("a repository's name is a link with no way of its own", () => {
    drawOn(
      "en",
      <CodeRepositoriesTable id="repositories" repositories={[REPOSITORY]} />,
    );

    const name: HTMLElement = screen.getByTestId("code-repository-name");

    expect(name).not.toHaveAttribute("dir");
    expect(name).toHaveClass("truncate");
    expect(name).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });
});
