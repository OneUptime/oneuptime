import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import GenericObject from "../../../Types/GenericObject";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import TableRow from "../../../UI/Components/Table/TableRow";
import TableColumn from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";

/*
 * The Threat Intel and Detection Rules tables, as a person reads them.
 *
 * Issue #5157: every poll and every check of every feed failed, and the
 * feeds table said Enabled in green - the message sat in a column past the
 * edge of the card, under rows made tall by a summary nobody could see. The
 * Status now says whether a feed or a rule works, the row's one button is
 * View Error when there is something to read, and the dialog shows each
 * message in full. The Indicators table, which the fix fills for the first
 * time, names types and unscored confidence as the guide does.
 *
 * Only the tables' data boundary is replaced: the real TableRow draws each
 * row - its cells, its one button and its menu - with the columns a viewer
 * sees before customizing them, and the dialog is the page's own.
 */

// A feed, a rule or an indicator: each row is found by its name or value.
type AnyRow = GenericObject & {
  _id?: string | undefined;
  name?: string | undefined;
  indicatorValue?: string | undefined;
};

type CapturedColumn = {
  title: string;
  type: string;
  field: Record<string, boolean>;
  getElement?: ((item: AnyRow) => ReactElement) | undefined;
  getExportValue?: ((item: AnyRow) => string) | undefined;
  noValueMessage?: string | undefined;
  isHiddenByDefault?: boolean | undefined;
  wrapContent?: boolean | undefined;
};

type CapturedFilter = {
  title: string;
  type: string;
  field: Record<string, boolean>;
  filterDropdownOptions?: Array<{ label: string; value: string }> | undefined;
};

type CapturedTable = {
  columns: Array<CapturedColumn>;
  filters?: Array<CapturedFilter> | undefined;
  actionButtons?: Array<ActionButtonSchema<AnyRow>> | undefined;
  cardProps?: { title?: unknown } | undefined;
};

const mockRows: Map<string, Array<AnyRow>> = new Map();
const mockTables: Map<string, CapturedTable> = new Map();

function mockTable(name: string, props: CapturedTable): ReactElement {
  mockTables.set(name, props);

  // What a viewer sees before customizing the columns.
  const columns: Array<TableColumn<AnyRow>> = [
    ...props.columns
      .filter((column: CapturedColumn): boolean => {
        return !column.isHiddenByDefault;
      })
      .map((column: CapturedColumn): TableColumn<AnyRow> => {
        return {
          title: column.title,
          type: column.type as FieldType,
          key: Object.keys(column.field)[0] as keyof AnyRow,
          getElement: column.getElement,
          noValueMessage: column.noValueMessage,
        };
      }),
    { title: "Actions", type: FieldType.Actions },
  ];

  return (
    <table aria-label={String(props.cardProps?.title || name)}>
      <thead>
        <tr>
          {columns.map((column: TableColumn<AnyRow>): ReactElement => {
            return <th key={column.title}>{column.title}</th>;
          })}
        </tr>
      </thead>
      {(mockRows.get(name) || []).map(
        (row: AnyRow, index: number): ReactElement => {
          return (
            <tbody
              key={row._id || String(index)}
              data-testid={row.name || row.indicatorValue}
            >
              <TableRow<AnyRow>
                item={row}
                columns={columns}
                actionButtons={props.actionButtons}
                isMobile={false}
              />
            </tbody>
          );
        },
      )}
    </table>
  );
}

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable & { modelType: { new (): unknown } }) => {
      const name: string =
        (new props.modelType() as { tableName?: string }).tableName || "";
      return mockTable(name, props);
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable) => {
      return mockTable("ThreatIntelIndicator", props);
    },
  };
});

/*
 * Free Lists, above the feeds, reads the project's feeds on its own: it has
 * a suite of its own (ThreatIntelSourcesUi), and stands aside here.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ThreatIntelRecommendedLists",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import ThreatIntelPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/ThreatIntel";
import DetectionRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/DetectionRules";
import {
  getIndicatorTypeLabel,
  isIndicatorUnscored,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ThreatIntelIndicatorCells";
import { INDICATOR_TYPE_DOCS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide";
import { describeDetectionOverflow } from "../../../Utils/SecurityEvent/DetectionOverflow";
import { ThreatIntelIndicatorType } from "../../../Types/SecurityEvent/ThreatIntelConstants";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ThreatIntelIndicator from "../../../Models/AnalyticsModels/ThreatIntelIndicator";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Project from "../../../Models/DatabaseModels/Project";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const POLLED_AT: Date = new Date("2026-10-14T11:48:00.000Z");

// What 14.0.81 stored on every feed (issue #5157).
const POLL_FAILURE: string =
  "Code: 184. DB::Exception: Aggregate function max(version) AS version is found inside another aggregate function in query. (ILLEGAL_AGGREGATION) (version 25.3.14.14 (official build))";
const MATCH_FAILURE: string =
  "Code: 184. DB::Exception: Aggregate function max(confidence) AS confidence is found inside another aggregate function in query. (ILLEGAL_AGGREGATION) (version 25.3.14.14 (official build))";

const FEED_OVERFLOW: string = describeDetectionOverflow({
  kind: "feed",
  matched: 1240,
  moreThanRead: false,
  opened: 100,
  findingsWritten: true,
});

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

let idCounter: number = 0;

function nextId(): string {
  idCounter++;
  return `22222222-2222-4222-8222-${String(idCounter).padStart(12, "0")}`;
}

function feed(values: Partial<ThreatIntelFeed>): AnyRow {
  const model: ThreatIntelFeed = new ThreatIntelFeed();
  model._id = nextId();
  Object.assign(model, { isEnabled: true, ...values });
  return model as unknown as AnyRow;
}

function rule(values: Partial<DetectionRule>): AnyRow {
  const model: DetectionRule = new DetectionRule();
  model._id = nextId();
  Object.assign(model, { isEnabled: true, ...values });
  return model as unknown as AnyRow;
}

function indicator(values: Record<string, unknown>): AnyRow {
  return AnalyticsBaseModel.fromJSON(
    {
      _id: nextId(),
      projectId: PROJECT_ID.toString(),
      feedName: "Corporate MISP",
      revoked: false,
      validFrom: "2026-10-14T05:00:00.000Z",
      validUntil: "2027-01-12T12:00:00.000Z",
      ...values,
    },
    ThreatIntelIndicator,
  ) as unknown as AnyRow;
}

function renderPage(page: "threat-intel" | "detection-rules"): void {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      {page === "threat-intel" ? (
        <ThreatIntelPage
          pageRoute={new Route("/dashboard/security-events/threat-intel")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      ) : (
        <DetectionRulesPage
          pageRoute={new Route("/dashboard/security-events/detection-rules")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      )}
    </MemoryRouter>,
  );
}

function rowOf(name: string): HTMLElement {
  return screen.getByTestId(name);
}

function statusOf(name: string): string {
  return within(rowOf(name)).getByTestId("pill").textContent || "";
}

// The buttons the page's own actions put on a row, beside its ⋯ menu.
function rowButtonsOf(name: string): Array<string> {
  const actions: HTMLElement = within(rowOf(name)).getByTestId("row-actions");

  return within(actions)
    .queryAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return button.getAttribute("data-testid") !== "row-actions-more-button";
    })
    .map((button: HTMLElement): string => {
      return button.textContent || "";
    });
}

// The row's one button, beside its ⋯ menu.
function rowButtonOf(name: string): string {
  const buttons: Array<string> = rowButtonsOf(name);

  expect(buttons).toHaveLength(1);

  return buttons[0]!;
}

// What the row's ⋯ menu holds, opened.
function rowMenuOf(name: string): Array<string> {
  fireEvent.click(within(rowOf(name)).getByTestId("row-actions-more-button"));

  return screen.getAllByRole("menuitem").map((item: HTMLElement): string => {
    return (item.textContent || "").trim();
  });
}

function table(name: string): CapturedTable {
  const captured: CapturedTable | undefined = mockTables.get(name);
  expect(captured).toBeDefined();
  return captured!;
}

function columnTitles(name: string, which: "shown" | "hidden"): Array<string> {
  return table(name)
    .columns.filter((column: CapturedColumn): boolean => {
      return which === "hidden"
        ? Boolean(column.isHiddenByDefault)
        : !column.isHiddenByDefault;
    })
    .map((column: CapturedColumn): string => {
      return column.title;
    });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  mockRows.clear();
  mockTables.clear();
  window.localStorage.clear();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("the threat intel feeds table says whether each feed works", () => {
  beforeEach(() => {
    mockRows.set("ThreatIntelFeed", [
      feed({
        name: "Corporate MISP",
        lastPolledAt: POLLED_AT,
        lastError: POLL_FAILURE,
        lastMatchError: MATCH_FAILURE,
      }),
      feed({
        name: "OpenCTI ransomware C2",
        lastPolledAt: POLLED_AT,
        lastMatchError: FEED_OVERFLOW,
      }),
      feed({
        name: "Sinkhole partners",
        lastPolledAt: POLLED_AT,
        lastMatchError: "Code: 241. DB::Exception: Memory limit exceeded.",
      }),
      feed({ name: "Partner ISAC", lastPolledAt: POLLED_AT }),
      feed({ name: "Botnet C2 list" }),
      feed({
        name: "Commercial feed (trial)",
        isEnabled: false,
        lastError: POLL_FAILURE,
      }),
    ]);
  });

  test("each feed's Status is how it is doing, not only whether it is on", () => {
    renderPage("threat-intel");

    expect(statusOf("Corporate MISP")).toBe("Poll failed");
    expect(statusOf("Sinkhole partners")).toBe("Matching failed");
    expect(statusOf("OpenCTI ransomware C2")).toBe("Needs attention");
    expect(statusOf("Botnet C2 list")).toBe("Waiting for first poll");
    expect(statusOf("Partner ISAC")).toBe("Enabled");
    expect(statusOf("Commercial feed (trial)")).toBe("Disabled");
  });

  test("a feed with something to read leads its row with View Error; Create Monitor waits in every row's menu", () => {
    renderPage("threat-intel");

    for (const name of [
      "Corporate MISP",
      "OpenCTI ransomware C2",
      "Sinkhole partners",
      // Switched off, but its last poll's failure is still there to read.
      "Commercial feed (trial)",
    ]) {
      expect(rowButtonOf(name)).toBe("View Error");
    }

    for (const name of ["Partner ISAC", "Botnet C2 list"]) {
      /*
       * Nothing of the page's own leads the row: the table's Edit does (it
       * stands aside in this suite, as the table does).
       */
      expect(rowButtonsOf(name)).toEqual([]);
      expect(
        within(rowOf(name)).queryByRole("button", { name: "View Error" }),
      ).toBeNull();
    }

    expect(rowMenuOf("Partner ISAC")).toContain("Create Monitor");
  });

  test("View Error shows the poll's and the check's messages in full, each under its column's name, each to copy", () => {
    renderPage("threat-intel");

    fireEvent.click(
      within(rowOf("Corporate MISP")).getByRole("button", {
        name: "View Error",
      }),
    );

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Corporate MISP",
    });

    const poll: HTMLElement = within(dialog).getByRole("region", {
      name: "Last Error",
    });
    const check: HTMLElement = within(dialog).getByRole("region", {
      name: "Last Match Error",
    });

    expect(within(poll).getByLabelText("Full error message").textContent).toBe(
      POLL_FAILURE,
    );
    expect(within(check).getByLabelText("Full error message").textContent).toBe(
      MATCH_FAILURE,
    );
    expect(
      within(poll).getByRole("button", { name: "Copy Error" }),
    ).toBeInTheDocument();
    expect(
      within(check).getByRole("button", { name: "Copy Error" }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Copy this message when contacting support. Credentials are redacted.",
    );

    // The footer's Close, not the header's X.
    fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("a check's overflow reads as a note to act on, not a message for support", () => {
    renderPage("threat-intel");

    fireEvent.click(
      within(rowOf("OpenCTI ransomware C2")).getByRole("button", {
        name: "View Error",
      }),
    );

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "OpenCTI ransomware C2",
    });

    expect(dialog).toHaveTextContent(FEED_OVERFLOW);
    expect(dialog).not.toHaveTextContent("contacting support");
    expect(within(dialog).getByRole("button", { name: "Copy" })).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "Copy Error" }),
    ).toBeNull();
  });

  test("the row shows what most people look at; the setting and the two messages wait in Customize Columns", () => {
    renderPage("threat-intel");

    expect(columnTitles("ThreatIntelFeed", "shown")).toEqual([
      "Name",
      "Source",
      "Status",
      "Last Polled",
      "Last Match",
      "Last Poll Summary",
    ]);
    expect(columnTitles("ThreatIntelFeed", "hidden")).toEqual([
      "Interval (Minutes)",
      "Last Error",
      "Last Evaluated",
      "Last Match Error",
    ]);

    const columns: Array<CapturedColumn> = table("ThreatIntelFeed").columns;

    // One line, cut short, its whole text under the pointer.
    expect(
      columns.find((column: CapturedColumn): boolean => {
        return column.title === "Last Poll Summary";
      })?.type,
    ).toBe(FieldType.Text);

    // Shown again from Customize Columns, a message wraps.
    for (const title of ["Last Error", "Last Match Error"]) {
      const column: CapturedColumn | undefined = columns.find(
        (candidate: CapturedColumn): boolean => {
          return candidate.title === title;
        },
      );
      expect(column?.type).toBe(FieldType.LongText);
      expect(column?.wrapContent).toBe(true);
    }
  });

  test("View Error is the row's button whenever it shows, ahead of Create Monitor", () => {
    renderPage("threat-intel");

    const viewError: ActionButtonSchema<AnyRow> | undefined = table(
      "ThreatIntelFeed",
    ).actionButtons?.find((button: ActionButtonSchema<AnyRow>): boolean => {
      return button.title === "View Error";
    });

    expect(viewError?.placement).toBe(ActionButtonPlacement.Primary);
  });

  test("in German, the Status and the button read in German", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    renderPage("threat-intel");

    const german: Record<string, string> = readLocale("de");

    expect(statusOf("Corporate MISP")).toBe(german["Poll failed"]);
    expect(statusOf("Sinkhole partners")).toBe(german["Matching failed"]);
    expect(statusOf("OpenCTI ransomware C2")).toBe(german["Needs attention"]);
    expect(statusOf("Botnet C2 list")).toBe(german["Waiting for first poll"]);
    expect(rowButtonOf("Corporate MISP")).toBe(german["View Error"]);
    expect(german["Poll failed"]).not.toBe("Poll failed");
  });
});

describe("the detection rules table says whether each rule works", () => {
  const RULE_OVERFLOW: string = describeDetectionOverflow({
    kind: "rule",
    matched: 10000,
    moreThanRead: true,
    opened: 100,
    findingsWritten: true,
  });

  beforeEach(() => {
    mockRows.set("DetectionRule", [
      rule({
        name: "Brute force from one IP address",
        lastEvaluatedAt: POLLED_AT,
        lastError:
          "Timeout exceeded: elapsed 30.00 seconds, maximum: 30. (TIMEOUT_EXCEEDED)",
      }),
      rule({
        name: "Password spraying",
        lastEvaluatedAt: POLLED_AT,
        lastError: RULE_OVERFLOW,
      }),
      rule({ name: "Impossible travel between two sign-ins" }),
      rule({ name: "Account locked out", lastEvaluatedAt: POLLED_AT }),
      rule({ name: "Legacy VPN brute force", isEnabled: false }),
    ]);
  });

  test("each rule's Status is how its last run went", () => {
    renderPage("detection-rules");

    expect(statusOf("Brute force from one IP address")).toBe("Run failed");
    expect(statusOf("Password spraying")).toBe("Needs attention");
    expect(statusOf("Impossible travel between two sign-ins")).toBe(
      "Waiting for first run",
    );
    expect(statusOf("Account locked out")).toBe("Enabled");
    expect(statusOf("Legacy VPN brute force")).toBe("Disabled");
  });

  test("a rule with a message leads its row with View Error, which shows it in full", () => {
    renderPage("detection-rules");

    expect(rowButtonOf("Password spraying")).toBe("View Error");
    // Create Monitor is set up once: it waits in the row's menu, Edit leads.
    expect(rowButtonsOf("Account locked out")).toEqual([]);

    fireEvent.click(
      within(rowOf("Brute force from one IP address")).getByRole("button", {
        name: "View Error",
      }),
    );

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Brute force from one IP address",
    });

    expect(
      within(dialog).getByLabelText("Full error message").textContent,
    ).toBe(
      "Timeout exceeded: elapsed 30.00 seconds, maximum: 30. (TIMEOUT_EXCEEDED)",
    );
    expect(
      within(dialog).getByRole("region", { name: "Last Error" }),
    ).toBeInTheDocument();
  });

  test("when it last fired comes first; the interval and Last Error wait in Customize Columns", () => {
    renderPage("detection-rules");

    expect(columnTitles("DetectionRule", "shown")).toEqual([
      "Name",
      "Type",
      "Status",
      "Last Match",
      "Last Evaluated",
    ]);
    expect(columnTitles("DetectionRule", "hidden")).toEqual([
      "Interval (Minutes)",
      "Last Error",
    ]);
  });
});

describe("the Indicators table names types and confidence as the guide does", () => {
  beforeEach(() => {
    mockRows.set("ThreatIntelIndicator", [
      indicator({
        indicatorValue: "203.0.113.77",
        indicatorType: ThreatIntelIndicatorType.Ipv4Address,
        confidence: 92,
      }),
      indicator({
        indicatorValue:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        indicatorType: ThreatIntelIndicatorType.FileHashSha256,
        confidence: 0,
      }),
      indicator({
        indicatorValue: "smtp://relay.example",
        indicatorType: "smtp-relay",
        confidence: 40,
      }),
    ]);
  });

  test("a type reads as the guide names it, with the stored type under the pointer", () => {
    renderPage("threat-intel");

    const ip: HTMLElement = within(rowOf("203.0.113.77")).getByTestId(
      "threat-intel-indicator-type",
    );
    expect(ip).toHaveTextContent("IPv4 address");
    expect(ip).toHaveAttribute("title", "ipv4-addr");

    expect(
      within(
        rowOf(
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        ),
      ).getByTestId("threat-intel-indicator-type"),
    ).toHaveTextContent("File hash (SHA-256)");

    // A type the guide does not know reads as stored.
    expect(
      within(rowOf("smtp://relay.example")).getByTestId(
        "threat-intel-indicator-type",
      ),
    ).toHaveTextContent("smtp-relay");
  });

  test("STIX's 0 reads Not scored, as the threat levels name it; a score reads as a number", () => {
    renderPage("threat-intel");

    expect(
      within(
        rowOf(
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        ),
      ).getByTestId("threat-intel-indicator-confidence"),
    ).toHaveTextContent("Not scored");
    expect(
      within(rowOf("203.0.113.77")).getByTestId(
        "threat-intel-indicator-confidence",
      ),
    ).toHaveTextContent("92");
  });

  test("the CSV keeps the stored type and score", () => {
    renderPage("threat-intel");

    const columns: Array<CapturedColumn> = table(
      "ThreatIntelIndicator",
    ).columns;
    const typeColumn: CapturedColumn | undefined = columns.find(
      (column: CapturedColumn): boolean => {
        return column.title === "Type";
      },
    );
    const confidenceColumn: CapturedColumn | undefined = columns.find(
      (column: CapturedColumn): boolean => {
        return column.title === "Confidence";
      },
    );
    const unscored: AnyRow = mockRows.get("ThreatIntelIndicator")![1]!;

    expect(typeColumn?.getExportValue?.(unscored)).toBe("file-hash-sha256");
    expect(confidenceColumn?.getExportValue?.(unscored)).toBe("0");
  });

  test("the Type filter is a pick of the types, in the guide's words", () => {
    renderPage("threat-intel");

    const typeFilter: CapturedFilter | undefined = table(
      "ThreatIntelIndicator",
    ).filters?.find((filter: CapturedFilter): boolean => {
      return filter.title === "Type";
    });

    expect(typeFilter?.type).toBe(FieldType.Dropdown);
    expect(typeFilter?.filterDropdownOptions).toEqual(
      Object.values(ThreatIntelIndicatorType).map(
        (type: ThreatIntelIndicatorType) => {
          return { label: INDICATOR_TYPE_DOCS[type].label, value: type };
        },
      ),
    );
  });

  test("Valid Until stays in view; Valid From waits in Customize Columns", () => {
    renderPage("threat-intel");

    expect(columnTitles("ThreatIntelIndicator", "shown")).toEqual([
      "Value",
      "Type",
      "Status",
      "Feed",
      "Confidence",
      "Valid Until",
    ]);
    expect(columnTitles("ThreatIntelIndicator", "hidden")).toEqual([
      "Valid From",
    ]);
  });
});

describe("the Indicators table's helpers", () => {
  test("every stored type has the guide's name", () => {
    for (const type of Object.values(ThreatIntelIndicatorType)) {
      expect(getIndicatorTypeLabel(type)).toBe(INDICATOR_TYPE_DOCS[type].label);
      expect(getIndicatorTypeLabel(type)).not.toBe(type);
    }

    expect(getIndicatorTypeLabel(undefined)).toBe("");
    expect(getIndicatorTypeLabel("")).toBe("");
  });

  test("0, nothing and nonsense are unscored; any score above 0 is a score", () => {
    for (const confidence of [0, undefined, null, Number.NaN, -5]) {
      expect(isIndicatorUnscored(confidence)).toBe(true);
    }

    for (const confidence of [1, 39, 40, 92, 100]) {
      expect(isIndicatorUnscored(confidence)).toBe(false);
    }
  });
});
