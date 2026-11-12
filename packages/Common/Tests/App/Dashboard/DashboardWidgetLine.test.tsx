import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import DashboardWidgetLine, {
  DashboardWidgetLineTag,
  getWidgetPageLanguage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetLine";
import { ResourceListNameCell } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceListBase";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import { isolated } from "../../Helpers/IsolateMarks";

/*
 * A DASHBOARD WIDGET'S LINE OF SOMEONE'S WORDS, READ THE WAY THEY ARE
 * WRITTEN (#6927, #6858).
 *
 * Every list widget cuts its names short where their column ends, and the
 * Funnel and User Retention widgets cut their titles where the widget
 * does. On an Arabic or Persian board such a line ends at the left - where
 * an English name starts: "checkout-api-production-7d9f8b6c4" read
 * "...production-7d9f8b6c4", and a cluster's pods, which share their
 * start, all looked alike. A widget draws such a line as a
 * DashboardWidgetLine, and a list's cell that holds a name as a
 * ResourceListNameCell (one): its box reads the way its words do when
 * that is not the board's way, so an English name is cut at its own end
 * and still starts on the board's side, under its column's name. Words
 * that read the board's way are drawn exactly as they were.
 *
 * A public dashboard's page is English, read from the left, whatever its
 * visitor's browser speaks: its lines are read against English there.
 */

const ENGLISH_NAME: string = "checkout-api-production-7d9f8b6c4";
const ARABIC_NAME: string = "خادم الدفع الرئيسي";
const PERSIAN_NAME: string = "سرور پرداخت اصلی";

const ONE_LINE_CELL: string = "px-3 py-2 text-xs text-gray-700 truncate";

// The SLO and gauge tiles' title, centred over the tile.
const CENTRED_TITLE: string =
  "text-[11px] font-medium text-gray-400 truncate uppercase tracking-wider w-full text-center";

// The Value widget's title over its set-up and no-data states.
const CLAMPED_TITLE: string =
  "text-xs font-medium text-gray-500 max-w-full line-clamp-1 px-1";

const PUBLIC_DASHBOARD: PublicDashboardContext = {
  dashboardId: new ObjectID("d0000000-0000-4000-8000-0000000000c1"),
  apiUrl: URL.fromString("https://dev.oneuptime.com/public-dashboard-api"),
  postJSON: async () => {
    throw new Error("A line reads nothing.");
  },
  apiClient: {} as unknown as PublicDashboardContext["apiClient"],
};

// The elements a line replaced: a title's div, span, p or h3.
const REPLACED_TAGS: Array<DashboardWidgetLineTag> = ["div", "span", "p", "h3"];

const LANGUAGES: Array<string> = ["en", "de", "ar", "fa"];
const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: Object.fromEntries(
        LANGUAGES.map((code: string) => {
          return [code, { translation: {} }];
        }),
      ),
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
});

function drawOn(language: string, element: ReactElement): void {
  render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
}

// A list's row with one cell, as a widget's renderRow draws it.
function drawCellOn(language: string, cell: ReactElement): void {
  drawOn(
    language,
    <table>
      <tbody>
        <tr>{cell}</tr>
      </tbody>
    </table>,
  );
}

describe("the language a widget's lines are laid out in", () => {
  test("in the Dashboard: the reader's, which the page is laid out in", () => {
    for (const language of ["ar", "fa", "de", "en", "pt-BR"]) {
      expect(getWidgetPageLanguage(language)).toBe(language);
    }
  });

  test("with no language set up: English", () => {
    expect(getWidgetPageLanguage(undefined)).toBe("en");
    expect(getWidgetPageLanguage(null)).toBe("en");
    expect(getWidgetPageLanguage("")).toBe("en");
  });

  test("on a public dashboard: English, whatever the visitor's browser speaks", () => {
    setPublicDashboardContext(PUBLIC_DASHBOARD);

    for (const language of ["ar", "fa", "de", "en"]) {
      expect(getWidgetPageLanguage(language)).toBe("en");
    }

    setPublicDashboardContext(null);
    expect(getWidgetPageLanguage("ar")).toBe("ar");
  });
});

describe.each(["ar", "fa"])(
  "a widget's line on a %s board",
  (language: string) => {
    test("an English name reads left to right, cut at its own end and lined up on the board's side", () => {
      drawOn(
        language,
        <DashboardWidgetLine
          text={ENGLISH_NAME}
          className="min-w-0 truncate text-sm font-medium text-gray-700"
          dataTestId="line"
        />,
      );

      const line: HTMLElement = screen.getByTestId("line");

      expect(line.tagName).toBe("DIV");
      expect(line).toHaveAttribute("dir", "ltr");
      expect(line.className).toBe(
        `min-w-0 truncate text-sm font-medium text-gray-700 ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(line).toHaveTextContent(ENGLISH_NAME);
    });

    test("a name in the board's own script is drawn exactly as it was", () => {
      for (const name of [ARABIC_NAME, PERSIAN_NAME]) {
        drawOn(
          language,
          <DashboardWidgetLine
            text={name}
            className={ONE_LINE_CELL}
            dataTestId="line"
          />,
        );

        const line: HTMLElement = screen.getByTestId("line");

        expect(line).not.toHaveAttribute("dir");
        expect(line.className).toBe(ONE_LINE_CELL);
        cleanup();
      }
    });

    test("a sentence of the board's with an English name set apart in it reads the board's way", () => {
      // An SLO tile's title: the SLO's name, then its metric in Arabic.
      const title: string = `${isolated("Checkout availability")} · ميزانية الخطأ المتبقية`;

      drawOn(
        language,
        <DashboardWidgetLine
          text={title}
          className={CENTRED_TITLE}
          dataTestId="line"
        />,
      );

      expect(screen.getByTestId("line")).not.toHaveAttribute("dir");
      expect(screen.getByTestId("line").className).toBe(CENTRED_TITLE);
    });

    test("a line with no letters - a figure, a dash, nothing - reads the board's way", () => {
      for (const text of ["99.95%", "—", "4,210", ""]) {
        drawOn(
          language,
          <DashboardWidgetLine
            text={text}
            className={ONE_LINE_CELL}
            dataTestId="line"
          />,
        );

        expect(screen.getByTestId("line")).not.toHaveAttribute("dir");
        expect(screen.getByTestId("line").className).toBe(ONE_LINE_CELL);
        cleanup();
      }
    });

    test("a title centred over its tile stays centred: its dir, no alignment of its own", () => {
      drawOn(
        language,
        <DashboardWidgetLine
          text="Checkout availability"
          className={CENTRED_TITLE}
          title="Checkout availability"
          dataTestId="line"
        />,
      );

      const line: HTMLElement = screen.getByTestId("line");

      expect(line).toHaveAttribute("dir", "ltr");
      expect(line.className).toBe(CENTRED_TITLE);
      expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
      expect(line).toHaveAttribute("title", "Checkout availability");
    });

    test("a title cut to one line by line-clamp keeps its ... : as wide as its words, not aligned to its end", () => {
      drawOn(
        language,
        <DashboardWidgetLine
          as="p"
          text="Active requests per region"
          className={CLAMPED_TITLE}
          dataTestId="line"
        />,
      );

      const line: HTMLElement = screen.getByTestId("line");

      expect(line.tagName).toBe("P");
      expect(line).toHaveAttribute("dir", "ltr");
      expect(line.className).toBe(
        `${CLAMPED_TITLE} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    });

    test("it draws what it is handed - a link around the name - read the name's way", () => {
      drawOn(
        language,
        <DashboardWidgetLine
          text={ENGLISH_NAME}
          className={ONE_LINE_CELL}
          dataTestId="line"
        >
          <a href="/dashboard/monitors/1">{ENGLISH_NAME}</a>
        </DashboardWidgetLine>,
      );

      const line: HTMLElement = screen.getByTestId("line");

      expect(line).toHaveAttribute("dir", "ltr");
      expect(line.firstElementChild?.tagName).toBe("A");
      expect(line.firstElementChild).not.toHaveAttribute("dir");
      expect(line).toHaveTextContent(ENGLISH_NAME);
    });

    test.each(REPLACED_TAGS)(
      "it is drawn as the %s it replaced",
      (tag: DashboardWidgetLineTag) => {
        drawOn(
          language,
          <DashboardWidgetLine
            as={tag}
            text={ENGLISH_NAME}
            className="truncate"
            dataTestId="line"
          />,
        );

        expect(screen.getByTestId("line").tagName).toBe(tag.toUpperCase());
        expect(screen.getByTestId("line")).toHaveAttribute("dir", "ltr");
      },
    );

    test("a line with no classes of its own takes only the alignment", () => {
      drawOn(
        language,
        <DashboardWidgetLine text={ENGLISH_NAME} dataTestId="line" />,
      );

      expect(screen.getByTestId("line").className).toBe(
        LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
      );
    });

    test("a line of the board's script with no classes has no empty class attribute", () => {
      drawOn(
        language,
        <DashboardWidgetLine text={ARABIC_NAME} dataTestId="line" />,
      );

      expect(screen.getByTestId("line")).not.toHaveAttribute("class");
      expect(screen.getByTestId("line")).not.toHaveAttribute("dir");
    });
  },
);

describe.each(["de", "en"])(
  "a widget's line on a %s board",
  (language: string) => {
    test("an English name is drawn exactly as it always was", () => {
      for (const className of [ONE_LINE_CELL, CENTRED_TITLE, CLAMPED_TITLE]) {
        drawOn(
          language,
          <DashboardWidgetLine
            text={ENGLISH_NAME}
            className={className}
            dataTestId="line"
          />,
        );

        expect(screen.getByTestId("line")).not.toHaveAttribute("dir");
        expect(screen.getByTestId("line").className).toBe(className);
        cleanup();
      }
    });

    test("an Arabic name reads right to left, cut at its own end, lined up on the board's side", () => {
      drawOn(
        language,
        <DashboardWidgetLine
          text={ARABIC_NAME}
          className={ONE_LINE_CELL}
          dataTestId="line"
        />,
      );

      expect(screen.getByTestId("line")).toHaveAttribute("dir", "rtl");
      expect(screen.getByTestId("line").className).toBe(
        `${ONE_LINE_CELL} ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
    });
  },
);

describe("a widget's line on a public dashboard", () => {
  test.each(["ar", "fa"])(
    "a visitor whose browser speaks %s sees an English name as the English page draws it",
    (language: string) => {
      setPublicDashboardContext(PUBLIC_DASHBOARD);

      drawOn(
        language,
        <DashboardWidgetLine
          text={ENGLISH_NAME}
          className={ONE_LINE_CELL}
          dataTestId="line"
        />,
      );

      expect(screen.getByTestId("line")).not.toHaveAttribute("dir");
      expect(screen.getByTestId("line").className).toBe(ONE_LINE_CELL);
    },
  );

  test("an Arabic name on it reads right to left, as on any English page", () => {
    setPublicDashboardContext(PUBLIC_DASHBOARD);

    drawOn(
      "ar",
      <DashboardWidgetLine
        text={ARABIC_NAME}
        className={ONE_LINE_CELL}
        dataTestId="line"
      />,
    );

    expect(screen.getByTestId("line")).toHaveAttribute("dir", "rtl");
    expect(screen.getByTestId("line")).toHaveClass(
      LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
    );
  });
});

describe("a list's cell that holds a name (ResourceListNameCell)", () => {
  test.each(["ar", "fa"])(
    "on a %s board an English name's cell reads left to right, cut at its end, on the board's side",
    (language: string) => {
      drawCellOn(
        language,
        <ResourceListNameCell
          name={ENGLISH_NAME}
          className={ONE_LINE_CELL}
          title="eu-west-production"
          dataTestId="name-cell"
        >
          <a href="/dashboard/kubernetes/pods/1">{ENGLISH_NAME}</a>
        </ResourceListNameCell>,
      );

      const cell: HTMLElement = screen.getByTestId("name-cell");

      expect(cell.tagName).toBe("TD");
      expect(cell).toHaveAttribute("dir", "ltr");
      expect(cell).toHaveClass("truncate", LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
      expect(cell).toHaveAttribute("title", "eu-west-production");
      expect(cell.querySelector("a")).toHaveTextContent(ENGLISH_NAME);
    },
  );

  test("with nothing handed to it, it draws the name", () => {
    drawCellOn(
      "ar",
      <ResourceListNameCell
        name="payments-production"
        className={ONE_LINE_CELL}
        dataTestId="name-cell"
      />,
    );

    expect(screen.getByTestId("name-cell").textContent).toBe(
      "payments-production",
    );
    expect(screen.getByTestId("name-cell")).not.toHaveAttribute("title");
  });

  test("an Arabic name's cell on an Arabic board, and an English one on a German board, are drawn as they were", () => {
    drawCellOn(
      "ar",
      <ResourceListNameCell
        name={ARABIC_NAME}
        className={ONE_LINE_CELL}
        dataTestId="name-cell"
      />,
    );

    expect(screen.getByTestId("name-cell")).not.toHaveAttribute("dir");
    expect(screen.getByTestId("name-cell").className).toBe(ONE_LINE_CELL);
    cleanup();

    drawCellOn(
      "de",
      <ResourceListNameCell
        name={ENGLISH_NAME}
        className={ONE_LINE_CELL}
        dataTestId="name-cell"
      />,
    );

    expect(screen.getByTestId("name-cell")).not.toHaveAttribute("dir");
    expect(screen.getByTestId("name-cell").className).toBe(ONE_LINE_CELL);
  });

  test("a row drawn by a plain function - a Kubernetes list's renderRow - still reads each name its own way", () => {
    // No hooks of its own: the cells read the board's language themselves.
    function renderRow(row: {
      name: string;
      namespace: string;
      cluster: string;
    }): ReactElement {
      return (
        <tr>
          <ResourceListNameCell
            name={row.name}
            className={ONE_LINE_CELL}
            dataTestId="pod-name"
          />
          <ResourceListNameCell
            name={row.namespace}
            className="px-3 py-2 text-xs text-gray-500 truncate"
            dataTestId="pod-namespace"
          />
          <td className="px-3 py-2" data-testid="pod-phase">
            Running
          </td>
        </tr>
      );
    }

    drawOn(
      "fa",
      <table>
        <tbody>
          {renderRow({
            name: ENGLISH_NAME,
            namespace: "payments-production",
            cluster: "eu-west-production",
          })}
        </tbody>
      </table>,
    );

    expect(screen.getByTestId("pod-name")).toHaveAttribute("dir", "ltr");
    expect(screen.getByTestId("pod-namespace")).toHaveAttribute("dir", "ltr");
    // A state's cell is the page's: it is written for its reader already.
    expect(screen.getByTestId("pod-phase")).not.toHaveAttribute("dir");
  });
});
