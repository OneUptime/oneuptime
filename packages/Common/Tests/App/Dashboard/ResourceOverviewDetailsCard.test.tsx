import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Follow-up of #4980: a resource's Overview ended with a Details card that
 * listed every fact the page knows how to show, "—" for each one the
 * resource never reported, and an "Explore telemetry" card of links that
 * repeated the side menu beside it. A new service's Overview read ten
 * Details rows of which two said something, then a second card, "Service
 * Details", that repeated its name.
 *
 * Rendered for real: the shared ResourceOverview with rows some of which
 * are empty, and the Service Overview page over a fake read of the service.
 *
 * #5298's UI review finished the card: the record's own ID is the small ID
 * line every details card ends with (DetailRecordLine), not a row that
 * spelled out 36 characters first; the description is the hero's line,
 * under the name, where a phone shows it; the labels card is a phone's
 * only (from 640px the page's header lists them); the row labels are in
 * the reader's language; a value breaks after its own dots and slashes
 * first, a sentence between its words (it used to be break-all: "switched
 * off for th" / "is project").
 */

const getItemMock: MockFunction = getJestMockFunction();
const fetchSpanMetricsMock: MockFunction = getJestMockFunction();
const fetchSignalsMock: MockFunction = getJestMockFunction();
const fetchMetricSeriesMock: MockFunction = getJestMockFunction();

const SERVICE_ID: string = "dddddddd-0000-4000-8000-000000000004";

// A test may give some English its German; the rest stays English.
const TRANSLATIONS: Record<string, string> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return TRANSLATIONS[key] ?? opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (): string => {
        return "failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("aaaaaaaa-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("dddddddd-0000-4000-8000-000000000004");
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics",
  () => {
    const format: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat",
    ) as Record<string, unknown>;
    return {
      __esModule: true,
      ...format,
      fetchSpanMetrics: (...args: Array<unknown>): unknown => {
        return fetchSpanMetricsMock(...args);
      },
      fetchLogAndExceptionSignals: (...args: Array<unknown>): unknown => {
        return fetchSignalsMock(...args);
      },
      fetchMetricSeries: (...args: Array<unknown>): unknown => {
        return fetchMetricSeriesMock(...args);
      },
    };
  },
);

// recharts draws nothing in jsdom.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="line-chart" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          autoRefreshInterval: "off",
          setAutoRefreshInterval: (): void => {},
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/ResourceSecurityCard",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

/*
 * The page draws no CardModelDetail any more; were it to again, this marker
 * would say so.
 */
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: { cardProps?: { title?: string } }) => {
      return (
        <div data-testid="card-model-detail">{props.cardProps?.title}</div>
      );
    },
  };
});

import ResourceOverview, {
  RESOURCE_OVERVIEW_DETAIL_VALUE_CLASS_NAME,
  ResourceOverviewDetailRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import {
  RESOURCE_HERO_CONTROLS_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_TEST_ID,
  RESOURCE_HERO_IDENTITY_CLASS_NAME,
  RESOURCE_HERO_TOP_ROW_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceHeroLayout";
import ServiceView from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { EDIT_IN_SETTINGS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/EditInSettingsLink";
import Label from "../../../Models/DatabaseModels/Label";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import TechStack from "../../../Types/Service/TechStack";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/services/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

function label(name: string): Label {
  const item: Label = new Label();
  item.name = name;
  item.color = new Color("#4f46e5");
  return item;
}

const RECORD_ID: string = "6d1c4b2e-0000-4000-8000-000000000042";

function renderOverview(
  rows: Array<ResourceOverviewDetailRow>,
  extra: {
    labels?: Array<Label>;
    settingsRoute?: Route;
    description?: string;
    recordId?: string;
    controls?: React.ReactElement;
  } = {},
): void {
  render(
    <MemoryRouter>
      <ResourceOverview
        icon={IconProp.Database}
        title="orders-db"
        identifier="orders-db:5432"
        identifierLabel="endpoint"
        status="active"
        lastSeenAt={undefined}
        chips={[]}
        tiles={[]}
        detailRows={rows}
        labels={extra.labels}
        settingsRoute={extra.settingsRoute}
        description={extra.description}
        recordId={extra.recordId}
        controls={extra.controls}
      />
    </MemoryRouter>,
  );
}

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(" ").filter(Boolean);
}

// The text between the <wbr>s of an element's own children.
function partsOf(holder: Element): Array<string> {
  const parts: Array<string> = [""];

  for (const node of Array.from(holder.childNodes)) {
    if (node.nodeName === "WBR") {
      parts.push("");
      continue;
    }
    parts[parts.length - 1] += node.textContent || "";
  }

  return parts;
}

// A row's value (<dd>), found by its label.
function valueOfRow(label: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .queryAllByTestId("resource-overview-detail-row")
    .find((candidate: HTMLElement): boolean => {
      return candidate.querySelector("dt")?.textContent === label;
    });

  if (!row) {
    throw new Error(`No Details row "${label}"`);
  }

  return row.querySelector("dd") as HTMLElement;
}

// The Details card's rows, as label: value.
function detailRows(): Array<string> {
  return screen
    .queryAllByTestId("resource-overview-detail-row")
    .map((row: HTMLElement): string => {
      const term: string = row.querySelector("dt")?.textContent || "";
      const value: string = row.querySelector("dd")?.textContent || "";
      return `${term}: ${value}`;
    });
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  for (const key of Object.keys(TRANSLATIONS)) {
    delete TRANSLATIONS[key];
  }
});

describe("the Details card says only what the resource reported", () => {
  test("a row with no value is not drawn, and no row reads a dash", () => {
    renderOverview([
      { label: "Engine (db.system.name)", value: "postgresql" },
      { label: "Version", value: undefined },
      { label: "Endpoints", value: "" },
      { label: "Workload", value: "   " },
      { label: "Database ID", value: "6d1c4b2e" },
    ]);

    expect(detailRows()).toEqual([
      "Engine (db.system.name): postgresql",
      "Database ID: 6d1c4b2e",
    ]);
    expect(screen.queryByText("Version")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoints")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  test("a row's element is drawn in place of its value, and only when there is a value", () => {
    renderOverview([
      {
        label: "Agent version",
        value: "14.0.80",
        element: <span data-testid="agent-sign">14.0.80 (outdated)</span>,
      },
      {
        label: "Runs on",
        value: undefined,
        element: <span data-testid="runs-on-link">a cluster</span>,
      },
    ]);

    expect(screen.getByTestId("agent-sign")).toHaveTextContent(
      "14.0.80 (outdated)",
    );
    expect(screen.queryByTestId("runs-on-link")).not.toBeInTheDocument();
    expect(detailRows()).toEqual(["Agent version: 14.0.80 (outdated)"]);
  });

  test("the rows are a description list, in the page's order", () => {
    renderOverview([
      { label: "B", value: "2" },
      { label: "A", value: "1" },
    ]);

    const list: HTMLElement = screen.getByTestId("resource-overview-details");
    expect(list.tagName).toBe("DL");
    expect(detailRows()).toEqual(["B: 2", "A: 1"]);
  });

  test("nothing reported says so in one line, and draws no empty list", () => {
    renderOverview([
      { label: "Cloud Provider", value: undefined },
      { label: "Cloud Region", value: "" },
    ]);

    expect(
      screen.getByTestId("resource-overview-no-details"),
    ).toHaveTextContent("No details reported yet.");
    expect(
      screen.queryByTestId("resource-overview-details"),
    ).not.toBeInTheDocument();
  });

  test("there is never an Explore telemetry card", () => {
    renderOverview([{ label: "Database ID", value: "6d1c4b2e" }]);

    expect(screen.queryByText("Explore telemetry")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Drill into the raw signals for this resource."),
    ).not.toBeInTheDocument();
  });

  test("Edit in Settings is on the Details card; the card's line says what its rows are", () => {
    renderOverview([{ label: "Engine", value: "postgresql" }], {
      settingsRoute: new Route("/dashboard/p/databases/1/settings"),
      description: "The orders database.",
    });

    expect(screen.getByTestId(EDIT_IN_SETTINGS_TEST_ID)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Metadata captured from OpenTelemetry resource attributes.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the labels are a phone's card only", () => {
  test("from 640px the page's header lists them, so their card is hidden there", () => {
    renderOverview([{ label: "Engine", value: "postgresql" }], {
      labels: [label("payments"), label("team-orders")],
    });

    const card: HTMLElement = screen.getByTestId("resource-overview-labels");
    expect(classesOf(card)).toContain("sm:hidden");
    expect(classesOf(card)).not.toContain("hidden");
    expect(card).toHaveTextContent("Labels");
    expect(card).toHaveTextContent("payments");
    expect(card).toHaveTextContent("team-orders");
  });

  test("no labels, no card", () => {
    renderOverview([{ label: "Engine", value: "postgresql" }], { labels: [] });

    expect(
      screen.queryByTestId("resource-overview-labels"),
    ).not.toBeInTheDocument();
  });
});

describe("the description is the hero's line, under the name", () => {
  test("drawn in the hero, at every width, and not the Details card's line", () => {
    renderOverview([{ label: "Engine", value: "postgresql" }], {
      description: "The orders database.",
    });

    const description: HTMLElement = screen.getByTestId(
      RESOURCE_HERO_DESCRIPTION_TEST_ID,
    );
    expect(description).toHaveTextContent("The orders database.");
    expect(
      screen.getByTestId("resource-overview-title-block"),
    ).toContainElement(description);
    // No breakpoint hides it: a card's description is hidden on a phone.
    for (const className of classesOf(description)) {
      expect(className).not.toMatch(/(^|:)hidden$/);
    }
    expect(screen.getAllByText("The orders database.")).toHaveLength(1);
  });

  test("a resource without one draws no line for it", () => {
    renderOverview([{ label: "Engine", value: "postgresql" }]);

    expect(
      screen.queryByTestId(RESOURCE_HERO_DESCRIPTION_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("the record's own ID is the card's ID line", () => {
  test("the line ends the card: ID, its first group, a copy button", () => {
    renderOverview(
      [
        { label: "Engine", value: "postgresql" },
        { label: "Version", value: "16.4" },
      ],
      { recordId: RECORD_ID },
    );

    const body: HTMLElement = screen.getByTestId(
      "resource-overview-details-body",
    );
    const line: HTMLElement = within(body).getByTestId("detail-id-line");

    expect(within(line).getByTestId("detail-id-label")).toHaveTextContent("ID");
    // The whole ID is its text, for a copy and find-in-page.
    expect(within(line).getByTestId("detail-id-value").textContent).toBe(
      RECORD_ID,
    );
    expect(within(line).getByTestId("detail-id-copy")).toBeInTheDocument();
    // After the rows, never one of them.
    expect(body.lastElementChild).toContainElement(line);
    expect(detailRows()).toEqual(["Engine: postgresql", "Version: 16.4"]);
    expect(
      within(screen.getByTestId("resource-overview-details")).queryByText(
        RECORD_ID,
      ),
    ).not.toBeInTheDocument();
  });

  test("a resource that reported nothing still has its ID line, under the one line that says so", () => {
    renderOverview([{ label: "Cloud Provider", value: undefined }], {
      recordId: RECORD_ID,
    });

    const body: HTMLElement = screen.getByTestId(
      "resource-overview-details-body",
    );
    expect(
      within(body).getByTestId("resource-overview-no-details"),
    ).toHaveTextContent("No details reported yet.");
    expect(within(body).getByTestId("detail-id-line")).toBeInTheDocument();
    expect(
      screen.queryByTestId("resource-overview-details"),
    ).not.toBeInTheDocument();
  });

  test("without a record ID there is no ID line", () => {
    renderOverview([{ label: "Engine", value: "postgresql" }]);

    expect(screen.queryByTestId("detail-id-line")).not.toBeInTheDocument();
  });
});

describe("the rows are read in the reader's language", () => {
  test("a row's label is looked up; a value is drawn as reported", () => {
    TRANSLATIONS["Cloud Account ID"] = "Cloud-Konto-ID";
    TRANSLATIONS["Discovered from"] = "Erkannt aus";

    renderOverview([
      { label: "Cloud Account ID", value: "123456789012" },
      { label: "Discovered from", value: "Traces", mono: false },
      { label: "Engine (db.system.name)", value: "postgresql" },
    ]);

    expect(detailRows()).toEqual([
      "Cloud-Konto-ID: 123456789012",
      "Erkannt aus: Traces",
      // A label the locale leaves English stays English.
      "Engine (db.system.name): postgresql",
    ]);
  });
});

describe("a long value wraps inside its row, where it reads", () => {
  test("a name breaks after its own dots and slashes, and reads as written", () => {
    renderOverview([
      {
        label: "Service Namespace",
        value: "com.acme-commerce.inventory.reservations",
      },
    ]);

    const value: HTMLElement = valueOfRow("Service Namespace");
    expect(value.textContent).toBe("com.acme-commerce.inventory.reservations");
    expect(partsOf(value)).toEqual([
      "com.",
      "acme-commerce.",
      "inventory.",
      "reservations",
    ]);
  });

  test("anywhere only where a part is too long for the line: never break-all", () => {
    renderOverview([
      {
        label: "Recording health",
        value: "Session replay is switched off for this project",
        mono: false,
      },
      { label: "Endpoints", value: "orders-db.internal:5432" },
    ]);

    for (const label of ["Recording health", "Endpoints"]) {
      const value: HTMLElement = valueOfRow(label);
      expect(classesOf(value)).toEqual(
        expect.arrayContaining(
          RESOURCE_OVERVIEW_DETAIL_VALUE_CLASS_NAME.split(" "),
        ),
      );
      expect(classesOf(value)).toContain("[overflow-wrap:anywhere]");
      expect(classesOf(value)).not.toContain("break-all");
    }
    // A sentence keeps its words: no <wbr> in it.
    expect(valueOfRow("Recording health").querySelectorAll("wbr")).toHaveLength(
      0,
    );
  });

  test("words are set in the page's type, raw values in monospace", () => {
    renderOverview([
      { label: "Discovered from", value: "Traces", mono: false },
      { label: "Version", value: "16.4" },
    ]);

    expect(classesOf(valueOfRow("Discovered from"))).not.toContain("font-mono");
    expect(classesOf(valueOfRow("Version"))).toContain("font-mono");
  });
});

describe("the hero's row: every resource hero's (ResourceHeroLayout)", () => {
  test("the row, the title block and the controls take ResourceHeroLayout's three class names", () => {
    renderOverview([{ label: "Engine", value: "postgresql" }], {
      controls: <div data-testid="controls">controls</div>,
    });

    const row: HTMLElement = screen.getByTestId("resource-overview-header-row");
    const title: HTMLElement = screen.getByTestId(
      "resource-overview-title-block",
    );
    const controls: HTMLElement = screen.getByTestId(
      "resource-overview-controls",
    );

    expect(classesOf(row)).toEqual(RESOURCE_HERO_TOP_ROW_CLASS_NAME.split(" "));
    expect(classesOf(title)).toEqual(
      RESOURCE_HERO_IDENTITY_CLASS_NAME.split(" "),
    );
    expect(classesOf(controls)).toEqual(
      RESOURCE_HERO_CONTROLS_CLASS_NAME.split(" "),
    );
    expect(Array.from(row.children)).toEqual([title, controls]);
    expect(controls).toContainElement(screen.getByTestId("controls"));
  });

  test("the name keeps its room: no title basis of its own, no min-w-0 that lets the controls squeeze it", () => {
    renderOverview([{ label: "Engine", value: "postgresql" }], {
      controls: <div data-testid="controls">controls</div>,
    });

    const title: HTMLElement = screen.getByTestId(
      "resource-overview-title-block",
    );
    expect(classesOf(title)).not.toContain("basis-96");
    expect(classesOf(title)).not.toContain("min-w-0");
    // The controls keep to the row's end from md, on either side of a page.
    const controls: HTMLElement = screen.getByTestId(
      "resource-overview-controls",
    );
    expect(classesOf(controls)).toContain("md:ms-auto");
    expect(classesOf(controls)).not.toContain("md:ml-auto");
  });
});

describe("the Service Overview has one Details card", () => {
  beforeEach(() => {
    fetchSpanMetricsMock.mockImplementation(async () => {
      return {
        total: 10,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: 12,
        countSeries: [],
        errorSeries: [],
        p95Series: [],
      };
    });
    fetchSignalsMock.mockImplementation(async () => {
      return {
        logs: {
          total: 0,
          errorCount: 0,
          countSeries: [],
          errorSeries: [],
          failed: false,
        },
        exceptions: {
          total: 0,
          unhandledCount: 0,
          unhandledSeries: [],
          handledSeries: [],
          failed: false,
        },
      };
    });
    fetchMetricSeriesMock.mockImplementation(async () => {
      return [];
    });
  });

  async function renderService(
    service: Record<string, unknown>,
  ): Promise<void> {
    getItemMock.mockImplementation(async () => {
      return { name: "checkout", ...service };
    });

    render(
      <MemoryRouter>
        <ServiceView {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    await screen.findByTestId("resource-overview-details");
  }

  test("a new service: its detected language, its ID line, nothing empty, no second card", async () => {
    await renderService({ telemetrySdkLanguage: "nodejs" });

    expect(detailRows()).toEqual(["Technology: Node.js"]);
    // Its ID is the card's ID line, not a row.
    expect(
      within(screen.getByTestId("detail-id-line")).getByTestId(
        "detail-id-value",
      ).textContent,
    ).toBe(SERVICE_ID);
    expect(screen.queryByText("Service ID")).not.toBeInTheDocument();
    expect(screen.queryByText("Cloud Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Service Namespace")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-model-detail")).not.toBeInTheDocument();
    expect(screen.queryByText("Service Details")).not.toBeInTheDocument();
    expect(screen.queryByText("Explore telemetry")).not.toBeInTheDocument();
    // One SDK language: the Technology row says it, no second row.
    expect(
      screen.queryByText("SDK Language (telemetry.sdk.language)"),
    ).not.toBeInTheDocument();
  });

  test("a reported service: every fact it reported, in order, and only those", async () => {
    await renderService({
      telemetrySdkLanguage: "python",
      runtimeName: "CPython",
      runtimeVersion: "3.12.4",
      serviceVersion: "2.7.0",
      deploymentEnvironment: "production",
      cloudProvider: "aws",
      cloudRegion: "eu-west-1",
    });

    expect(detailRows()).toEqual([
      "Technology: Python",
      "Runtime: CPython 3.12.4",
      "Service Version: 2.7.0",
      "Deployment Environment: production",
      "Cloud Provider: aws",
      "Cloud Region: eu-west-1",
    ]);
  });

  test("a tech stack set in Settings is the Technology row, one line in words", async () => {
    await renderService({
      telemetrySdkLanguage: "nodejs",
      techStack: [TechStack.React, TechStack.NodeJS],
    });

    const technology: HTMLElement = valueOfRow("Technology");
    expect(technology.textContent).toBe(
      `${TechStack.React}, ${TechStack.NodeJS}`,
    );
    // A list in words, not a column of <p>s.
    expect(technology.querySelectorAll("p")).toHaveLength(0);
    expect(classesOf(technology)).not.toContain("font-mono");
  });

  test("its labels are a phone's card, its description the hero's line, its settings one link on Details", async () => {
    await renderService({
      telemetrySdkLanguage: "go",
      description: "Takes the basket to an order.",
      labels: [label("checkout-team")],
    });

    expect(screen.getByTestId("resource-overview-labels")).toHaveTextContent(
      "checkout-team",
    );
    expect(
      screen.getByTestId(RESOURCE_HERO_DESCRIPTION_TEST_ID),
    ).toHaveTextContent("Takes the basket to an order.");
    expect(screen.getAllByTestId(EDIT_IN_SETTINGS_TEST_ID)).toHaveLength(1);
  });

  test("the service is read with its labels, for the Labels card", async () => {
    await renderService({ telemetrySdkLanguage: "go" });

    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]?.[0] as { select: Record<string, unknown> }
    ).select;

    expect(select["labels"]).toEqual({ name: true, color: true });
    expect(select["techStack"]).toBe(true);
    expect(select["description"]).toBe(true);
  });
});
