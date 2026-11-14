import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A CARD'S REMOVE KEEPS ITS OWN SIZE AT EVERY WIDTH (issue #7331).
 *
 * The shared Button takes the whole width of its row below md, in larger
 * words, and steps 12px in from md up: a form's or a dialog's footer,
 * where the buttons stack on a phone. The Data Source widgets' query card
 * put its Remove in the card's header, beside the "Query" label: on a
 * 390px phone it ran from the label to the card's edge, touching the
 * label, and read as the card's main action. A button in a row beside a
 * label now says so (isFullWidthOnPhone={false}) and keeps the size md
 * and up draw it at, a gap apart from the label - in the query card, in
 * the metric Table's column card, and in a metric widget's added query
 * row.
 *
 * jsdom lays nothing out, so the classes are what is read: no w-full, no
 * md:w-auto, no 12px step, no larger words on a phone.
 */

const getListMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return "11111111-1111-4111-8111-111111111111";
      },
    },
  };
});

import Button, {
  ButtonSize,
  ButtonStyleType,
  keepButtonOwnSizeAtEveryWidth,
} from "../../../UI/Components/Button/Button";
import ArgumentsForm, {
  METRIC_QUERY_ROW_HEADER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm";
import DataSourceQueryEditor, {
  DATA_SOURCE_QUERY_CARD_HEADER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/DataSourceQueryEditor";
import TableColumnsEditor, {
  TABLE_COLUMN_CARD_HEADER_TEST_ID,
  TABLE_COLUMNS_ADD_ROW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/TableColumnsEditor";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  TableColumn,
  TableColumnKind,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import { ObjectType } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import DashboardChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardChartComponent";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

// The footer's layout: the whole row on a phone, a 12px step from md up.
const FOOTER_LAYOUT: ReadonlyArray<string> = [
  "w-full",
  "md:w-auto",
  "md:ml-3",
  "md:mt-0",
  "text-base",
  "md:text-sm",
];

function classesOf(element: Element): Array<string> {
  return Array.from(element.classList);
}

// The button keeps its own size: none of the footer's layout is left on it.
function expectOwnSize(button: HTMLElement): void {
  const footerLayoutLeft: Array<string> = classesOf(button).filter(
    (name: string): boolean => {
      return FOOTER_LAYOUT.includes(name);
    },
  );

  expect({ button: button.textContent, footerLayoutLeft }).toEqual({
    button: button.textContent,
    footerLayoutLeft: [],
  });
  // The words md and up draw it in, at every width.
  expect(button).toHaveClass("text-sm");
  // Still the small red outlined button it was.
  expect(button).toHaveClass("px-2", "py-1", "rounded-md");
  expect(button.className).toMatch(/\bborder-red-/);
}

// The header: the label at one end, the Remove at the other, a gap apart.
function expectHeaderRow(header: HTMLElement): HTMLElement {
  expect(header).toHaveClass("flex", "items-center", "justify-between");
  expect(header).toHaveClass("gap-3");

  const remove: HTMLElement = within(header).getByRole("button", {
    name: /Remove/,
  });

  expectOwnSize(remove);

  // The label gives way before the button does: it may shrink, wrap.
  const label: Element = header.firstElementChild as Element;

  expect(label).not.toContainElement(remove);
  expect(label).toHaveClass("min-w-0");

  // Nothing between them stretches the button again.
  let wrapper: HTMLElement | null = remove.parentElement;

  while (wrapper && wrapper !== header) {
    expect(wrapper.className).not.toMatch(/\[&_button\]/);
    expect(wrapper).not.toHaveClass("w-full", "flex-1", "grow");
    wrapper = wrapper.parentElement;
  }

  return remove;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      ru: { translation: readDashboardLocale("ru") },
      "zh-CN": { translation: readDashboardLocale("zh-CN") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await act(async () => {
    await i18next.changeLanguage("en");
  });
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
});

afterEach(() => {
  cleanup();
});

describe("a button's footer layout, taken off", () => {
  test("the whole row, the 12px step and the larger words go; the rest stays, in its order", () => {
    expect(
      keepButtonOwnSizeAtEveryWidth(
        "inline-flex w-full justify-center rounded-md border border-red-300 bg-white text-base font-medium text-red-700 md:mt-0 md:ml-3 md:w-auto md:text-sm px-2 py-1",
      ),
    ).toBe(
      "inline-flex justify-center rounded-md border border-red-300 bg-white font-medium text-red-700 px-2 py-1 text-sm",
    );
  });

  test("a button with no footer layout is left as it was", () => {
    expect(
      keepButtonOwnSizeAtEveryWidth(
        "inline-flex items-center rounded-md border border-gray-300 text-sm px-2 py-1",
      ),
    ).toBe(
      "inline-flex items-center rounded-md border border-gray-300 text-sm px-2 py-1",
    );
  });

  test("names that only look like the footer's are kept", () => {
    expect(
      keepButtonOwnSizeAtEveryWidth(
        "w-fit md:w-full sm:ml-3 text-base-content max-w-full",
      ),
    ).toBe("w-fit md:w-full sm:ml-3 text-base-content max-w-full");
  });

  test("extra spaces leave no empty names behind", () => {
    expect(keepButtonOwnSizeAtEveryWidth("  w-full   px-2  ")).toBe("px-2");
  });
});

describe("the shared Button", () => {
  const STYLES_THAT_FILL_THE_ROW: ReadonlyArray<[string, ButtonStyleType]> = [
    ["NORMAL", ButtonStyleType.NORMAL],
    ["PRIMARY", ButtonStyleType.PRIMARY],
    ["DANGER", ButtonStyleType.DANGER],
    ["DANGER_OUTLINE", ButtonStyleType.DANGER_OUTLINE],
    ["SUCCESS", ButtonStyleType.SUCCESS],
    ["WARNING", ButtonStyleType.WARNING],
  ];

  test.each(STYLES_THAT_FILL_THE_ROW)(
    "%s fills a footer's row on a phone, as it always did",
    (_name: string, style: ButtonStyleType) => {
      render(<Button title="Save" buttonStyle={style} dataTestId="button" />);

      expect(screen.getByTestId("button")).toHaveClass(
        "w-full",
        "md:w-auto",
        "md:ml-3",
      );
    },
  );

  test.each(STYLES_THAT_FILL_THE_ROW)(
    "%s beside a label keeps its own size at every width",
    (_name: string, style: ButtonStyleType) => {
      render(
        <Button
          title="Remove"
          buttonStyle={style}
          buttonSize={ButtonSize.Small}
          isFullWidthOnPhone={false}
          dataTestId="button"
        />,
      );

      const button: HTMLElement = screen.getByTestId("button");

      for (const name of FOOTER_LAYOUT) {
        expect({
          style: _name,
          name,
          has: button.classList.contains(name),
        }).toEqual({ style: _name, name, has: false });
      }

      expect(button).toHaveClass("text-sm", "px-2", "py-1");
    },
  );

  test("a locked button beside a label is still its own size, and still faded", () => {
    render(
      <Button
        title="Remove"
        buttonStyle={ButtonStyleType.DANGER_OUTLINE}
        buttonSize={ButtonSize.Small}
        isFullWidthOnPhone={false}
        disabled={true}
        dataTestId="button"
      />,
    );

    const button: HTMLElement = screen.getByTestId("button");

    expect(button).not.toHaveClass("w-full");
    expect(button).toBeDisabled();
  });
});

function chartWithQueries(count: number): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: ObjectID.generate(),
    componentType: DashboardComponentType.DataSourceChart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 2,
    arguments: {
      queries: Array.from({ length: count }, (_: unknown, index: number) => {
        return {
          id: `q${index + 1}`,
          dataSourceId: "",
          query: index === 0 ? "up" : "rate(http_requests_total[5m])",
        };
      }),
    },
  } as DashboardBaseComponent;
}

describe("the Data Source query card's Remove", () => {
  test.each([
    ["the Data Source Chart's cards", DashboardComponentType.DataSourceChart],
    ["the Data Source Value's card", DashboardComponentType.DataSourceValue],
  ])(
    "%s: the label, and a small Remove a gap apart",
    async (_what: string, type: DashboardComponentType) => {
      const component: DashboardBaseComponent =
        type === DashboardComponentType.DataSourceChart
          ? chartWithQueries(2)
          : {
              ...chartWithQueries(1),
              componentType: type,
              arguments: { query: { id: "q1", dataSourceId: "", query: "up" } },
            };

      await act(async () => {
        render(
          <DataSourceQueryEditor component={component} onChange={() => {}} />,
        );
      });

      const headers: Array<HTMLElement> = screen.getAllByTestId(
        DATA_SOURCE_QUERY_CARD_HEADER_TEST_ID,
      );

      expect(headers).toHaveLength(
        type === DashboardComponentType.DataSourceChart ? 2 : 1,
      );

      for (const header of headers) {
        expectHeaderRow(header);
      }

      expect(headers[0]!.firstElementChild).toHaveTextContent(
        type === DashboardComponentType.DataSourceChart ? "Query 1" : "Query",
      );
    },
  );
});

describe("the metric Table's column card's Remove", () => {
  const COLUMNS: Array<TableColumn> = [
    {
      id: "requests",
      variable: "a",
      header: "Requests",
      kind: TableColumnKind.Metric,
      metricName: "http.requests",
      aggregation: MetricsAggregationType.Sum,
    },
    {
      id: "doubled",
      variable: "b",
      header: "Doubled",
      kind: TableColumnKind.Formula,
      formula: "a * 2",
    },
  ];

  test("each card: its letter and kind, and a small Remove a gap apart", () => {
    render(
      <TableColumnsEditor
        columns={COLUMNS}
        metricTypes={[]}
        onChange={() => {}}
      />,
    );

    const headers: Array<HTMLElement> = screen.getAllByTestId(
      TABLE_COLUMN_CARD_HEADER_TEST_ID,
    );

    expect(headers).toHaveLength(2);

    for (const header of headers) {
      expectHeaderRow(header);
      // The letter and the kind may wrap under each other, not under Remove.
      expect(header.firstElementChild).toHaveClass("flex-wrap");
    }

    expect(headers[0]!.firstElementChild).toHaveTextContent("a");
    expect(headers[1]!.firstElementChild).toHaveTextContent("b");
  });

  /*
   * Under the cards, Add Metric and Add Formula sit side by side. On a
   * phone the shared Button gave each half the row in larger words, which
   * broke over two lines in German: each keeps its own size, and the row
   * wraps them under each other when they do not fit.
   */
  test.each([["en"], ["de"]])(
    "in %s: Add Metric and Add Formula keep their own size, in a row that wraps",
    async (language: string) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      render(
        <TableColumnsEditor
          columns={COLUMNS}
          metricTypes={[]}
          onChange={() => {}}
        />,
      );

      const row: HTMLElement = screen.getByTestId(
        TABLE_COLUMNS_ADD_ROW_TEST_ID,
      );

      expect(row).toHaveClass("flex", "flex-wrap", "gap-2");

      const buttons: Array<HTMLElement> = within(row).getAllByRole("button");

      expect(
        buttons.map((button: HTMLElement): string => {
          return button.textContent || "";
        }),
      ).toEqual([
        language === "en"
          ? "Add Metric"
          : readDashboardLocale("de")["Add Metric"],
        language === "en"
          ? "Add Formula"
          : readDashboardLocale("de")["Add Formula"],
      ]);

      for (const button of buttons) {
        const footerLayoutLeft: Array<string> = classesOf(button).filter(
          (name: string): boolean => {
            return FOOTER_LAYOUT.includes(name);
          },
        );

        expect({ button: button.textContent, footerLayoutLeft }).toEqual({
          button: button.textContent,
          footerLayoutLeft: [],
        });
        expect(button).toHaveClass("text-sm");
      }
    },
  );
});

describe("a metric widget's added query row's Remove", () => {
  test("Query 2 and Query 3: the label, and a small Remove a gap apart", () => {
    const chart: DashboardBaseComponent =
      DashboardChartComponentUtil.getDefaultComponent();

    chart.arguments = {
      ...(chart.arguments as Record<string, unknown>),
      metricQueryConfigs: ["b", "c"].map((variable: string) => {
        return {
          metricAliasData: {
            metricVariable: variable,
            title: undefined,
            description: undefined,
            legend: undefined,
            legendUnit: undefined,
          },
          metricQueryData: { filterData: {}, groupBy: undefined },
        };
      }),
    } as DashboardBaseComponent["arguments"];

    render(
      <ArgumentsForm
        component={chart}
        metrics={{ metricTypes: [], telemetryAttributes: [] }}
        onFormChange={() => {}}
      />,
    );

    const headers: Array<HTMLElement> = screen.getAllByTestId(
      METRIC_QUERY_ROW_HEADER_TEST_ID,
    );

    expect(headers).toHaveLength(2);
    expect(headers[0]!.firstElementChild).toHaveTextContent("Query 2");
    expect(headers[1]!.firstElementChild).toHaveTextContent("Query 3");

    for (const header of headers) {
      expectHeaderRow(header);
    }
  });
});

/*
 * The cards' labels, in the reader's language. "Query 1", "Query 2" on a
 * chart's query cards and a metric widget's added query rows were English
 * in fourteen Dashboard languages, beside a translated Remove.
 */
describe("the query cards' labels, in every Dashboard language", () => {
  // The words a card's header draws: its label, and its Remove.
  const HEADER_WORDS: ReadonlyArray<string> = [
    "Query {{number}}",
    "Query",
    "Remove",
  ];

  test("each is worded in every Dashboard language", () => {
    const unworded: Array<string> = [];

    for (const key of HEADER_WORDS) {
      for (const language of DASHBOARD_LANGUAGES) {
        if (!isWordedInDashboardLocale(key, language)) {
          unworded.push(`${language}: ${key}`);
        }
      }
    }

    expect(unworded).toEqual([]);
  });

  test("a word left in English, and not listed as the language's own, is found", () => {
    // Negative control: a key no locale has, and English itself.
    expect(isWordedInDashboardLocale("Query {{number}} of none", "de")).toBe(
      false,
    );
    expect(readDashboardLocale("en")["Query {{number}}"]).toBe(
      "Query {{number}}",
    );
  });

  test.each([
    ["de", "Abfrage 1", "Abfrage 2", "Entfernen"],
    ["ru", "Запрос 1", "Запрос 2", "Удалить"],
    ["zh-CN", "查询 1", "查询 2", "移除"],
  ])(
    "%s: the chart's cards read %s and %s, beside %s",
    async (language: string, first: string, second: string, remove: string) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      await act(async () => {
        render(
          <DataSourceQueryEditor
            component={chartWithQueries(2)}
            onChange={() => {}}
          />,
        );
      });

      const headers: Array<HTMLElement> = screen.getAllByTestId(
        DATA_SOURCE_QUERY_CARD_HEADER_TEST_ID,
      );

      expect(headers[0]!.firstElementChild).toHaveTextContent(first);
      expect(headers[1]!.firstElementChild).toHaveTextContent(second);

      for (const header of headers) {
        expect(header.textContent || "").not.toContain("Query");
        expect(
          within(header).getByRole("button", { name: remove }),
        ).toBeInTheDocument();
      }
    },
  );
});
