import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import IsolatedLine, {
  getIsolatedLine,
  isCentredLineClassName,
  isWrappingLineClassName,
} from "../../../UI/Components/IsolatedText/IsolatedLine";
import Pill from "../../../UI/Components/Pill/Pill";
import ProbeElement from "../../../UI/Components/Probe/Probe";
import RoleLabel from "../../../UI/Components/RoleLabel/RoleLabel";
import Probe from "../../../Models/DatabaseModels/Probe";
import Color from "../../../Types/Color";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";

/*
 * A NAME ON A LINE OF ITS OWN, IN A CELL THAT LAYS OUT MORE.
 *
 * A table's cell that draws a logo, a mark or a badge beside a record's
 * name, or a line of the page's words under it, keeps the page's way
 * (drawsItsOwnLines): one way for the whole cell would turn those the
 * wrong way round. The name draws its own line the way it is written
 * (IsolatedLine) so an English name on an Arabic page is cut short at its
 * own end; a badge's words (Pill) read their own way inside the page's
 * line, and a probe's and a role's name are lines of their own beside
 * their marks.
 */

const ENGLISH_NAME: string = "payments-gateway-eu-west-1 (primary)";
const ARABIC_NAME: string = "بوابة الدفع الرئيسية";

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

const drawOn: (language: string, element: ReactElement) => void = (
  language: string,
  element: ReactElement,
): void => {
  render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
};

describe("getIsolatedLine", () => {
  test.each(["ar", "fa"])(
    "an English line on a %s page reads left to right, lined up by its end",
    (language: string) => {
      expect(
        getIsolatedLine({
          text: ENGLISH_NAME,
          pageLanguage: language,
          className: "truncate text-sm",
        }),
      ).toEqual({
        dir: "ltr",
        className: `truncate text-sm ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      });
    },
  );

  test("a line cut short to a few lines is as wide as its words instead (its ... kept)", () => {
    for (const className of [
      "line-clamp-2 text-sm",
      "mt-0.5 line-clamp-3",
      "line-clamp-1",
    ]) {
      expect(
        getIsolatedLine({ text: ENGLISH_NAME, pageLanguage: "ar", className }),
      ).toEqual({
        dir: "ltr",
        className: `${className} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      });
    }

    // Only a line-clamp class: not a class that merely starts the same.
    expect(
      getIsolatedLine({
        text: ENGLISH_NAME,
        pageLanguage: "ar",
        className: "line-clamp-none truncate",
      }).className,
    ).toBe(`line-clamp-none truncate ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`);
  });

  test("with no classes of its own it takes only the alignment", () => {
    expect(getIsolatedLine({ text: ENGLISH_NAME, pageLanguage: "fa" })).toEqual(
      {
        dir: "ltr",
        className: LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
      },
    );
  });

  test("words that read the page's way are drawn exactly as they were", () => {
    expect(
      getIsolatedLine({
        text: ARABIC_NAME,
        pageLanguage: "ar",
        className: "truncate",
      }),
    ).toEqual({ dir: undefined, className: "truncate" });
    expect(
      getIsolatedLine({
        text: ENGLISH_NAME,
        pageLanguage: "en",
        className: "truncate",
      }),
    ).toEqual({ dir: undefined, className: "truncate" });
    // No letters (a port, a count, a dash) reads as the page does.
    expect(
      getIsolatedLine({ text: "8443", pageLanguage: "ar", className: "x" }),
    ).toEqual({ dir: undefined, className: "x" });
    expect(
      getIsolatedLine({ text: "", pageLanguage: "ar", className: undefined }),
    ).toEqual({ dir: undefined, className: "" });
  });

  test("an Arabic line on an English page reads right to left", () => {
    expect(
      getIsolatedLine({
        text: ARABIC_NAME,
        pageLanguage: "en",
        className: "truncate",
      }),
    ).toEqual({
      dir: "rtl",
      className: `truncate ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    });
  });
});

describe("<IsolatedLine />", () => {
  test.each(["ar", "fa"])(
    "on a %s page an English name's line reads left to right and keeps its classes, title and test id",
    (language: string) => {
      drawOn(
        language,
        <IsolatedLine
          text={ENGLISH_NAME}
          className="truncate text-sm font-medium"
          title={ENGLISH_NAME}
          dataTestId="the-name"
        />,
      );

      const line: HTMLElement = screen.getByTestId("the-name");

      expect(line.tagName).toBe("DIV");
      expect(line).toHaveAttribute("dir", "ltr");
      expect(line).toHaveClass(
        "truncate",
        "text-sm",
        "font-medium",
        LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
      );
      expect(line).toHaveAttribute("title", ENGLISH_NAME);
      expect(line.textContent).toBe(ENGLISH_NAME);
    },
  );

  test("on an English page it is drawn as the box it replaced", () => {
    drawOn(
      "en",
      <IsolatedLine
        text={ENGLISH_NAME}
        className="truncate"
        dataTestId="the-name"
      />,
    );

    const line: HTMLElement = screen.getByTestId("the-name");

    expect(line).not.toHaveAttribute("dir");
    expect(line.getAttribute("class")).toBe("truncate");
    expect(line).not.toHaveAttribute("title");
  });

  test("a line with no classes has no empty class attribute", () => {
    drawOn("ar", <IsolatedLine text={ARABIC_NAME} dataTestId="the-name" />);

    expect(screen.getByTestId("the-name")).not.toHaveAttribute("class");
  });

  test("it is drawn as the paragraph or span it replaced", () => {
    drawOn(
      "ar",
      <div>
        <IsolatedLine as="p" text={ENGLISH_NAME} dataTestId="as-p" />
        <IsolatedLine as="span" text={ENGLISH_NAME} dataTestId="as-span" />
      </div>,
    );

    expect(screen.getByTestId("as-p").tagName).toBe("P");
    expect(screen.getByTestId("as-span").tagName).toBe("SPAN");
  });

  test("it draws what it is handed - a link around the name - read the name's way", () => {
    drawOn(
      "ar",
      <IsolatedLine
        as="span"
        text={ENGLISH_NAME}
        className="block truncate"
        dataTestId="the-name"
      >
        <a href="#check">{ENGLISH_NAME}</a>
      </IsolatedLine>,
    );

    const line: HTMLElement = screen.getByTestId("the-name");

    expect(line).toHaveAttribute("dir", "ltr");
    expect(within(line).getByRole("link", { name: ENGLISH_NAME })).toBe(
      line.firstElementChild,
    );
  });

  test("a description cut to two lines is as wide as its words", () => {
    drawOn(
      "fa",
      <IsolatedLine
        as="p"
        text="Rotates the database password every 30 days."
        className="line-clamp-2 text-sm"
        dataTestId="the-description"
      />,
    );

    const line: HTMLElement = screen.getByTestId("the-description");

    expect(line).toHaveAttribute("dir", "ltr");
    expect(line).toHaveClass(
      ...CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
    );
    expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });
});

/*
 * A LINE THAT WRAPS, READ THE OTHER WAY (#6742).
 *
 * A box whose words run onto more lines - Spend's job name, which breaks
 * anywhere ([overflow-wrap:anywhere]); a record's name beside its icon on
 * a phone's card - was aligned to its end as a one-line box is: every
 * wrapped line of an English name on an Arabic page lined up on the right,
 * ragged on its left, where it starts. Its classes say it wraps, so it is
 * as wide as its words instead (CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME):
 * at the page's start, each of its lines from its own start.
 */
describe("a line whose classes say it wraps", () => {
  const WRAPPING_CLASS_NAMES: Array<string> = [
    "whitespace-normal",
    "whitespace-pre-wrap",
    "whitespace-pre-line",
    "whitespace-break-spaces",
    "text-wrap",
    "text-balance",
    "text-pretty",
    "break-words",
    "break-all",
    "[overflow-wrap:anywhere]",
    "[overflow-wrap:break-word]",
    "[word-break:break-all]",
    "[word-break:break-word]",
  ];

  test.each(WRAPPING_CLASS_NAMES)(
    "with %s, an English line on an Arabic page is as wide as its words, not aligned to its end",
    (wrapClassName: string) => {
      const className: string = `min-w-0 font-medium ${wrapClassName}`;

      expect(isWrappingLineClassName(className)).toBe(true);
      expect(
        getIsolatedLine({ text: ENGLISH_NAME, pageLanguage: "ar", className }),
      ).toEqual({
        dir: "ltr",
        className: `${className} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      });
    },
  );

  test.each(["fa", "ar"])(
    "on a %s page Spend's job name, which breaks anywhere, wraps from its own start",
    (language: string) => {
      expect(
        getIsolatedLine({
          text: ENGLISH_NAME,
          pageLanguage: language,
          className:
            "min-w-0 font-medium text-gray-900 [overflow-wrap:anywhere]",
        }),
      ).toEqual({
        dir: "ltr",
        className: `min-w-0 font-medium text-gray-900 [overflow-wrap:anywhere] ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      });
    },
  );

  test.each(["truncate", "whitespace-nowrap", "text-nowrap"])(
    "kept to one line by %s, it is a one-line box whatever else it says, aligned to its end",
    (oneLineClassName: string) => {
      const className: string = `break-words ${oneLineClassName}`;

      expect(isWrappingLineClassName(className)).toBe(false);
      expect(
        getIsolatedLine({ text: ENGLISH_NAME, pageLanguage: "ar", className })
          .className,
      ).toBe(`${className} ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`);
    },
  );

  test("only a whole class counts: a variant's or a look-alike's does not", () => {
    for (const className of [
      "md:whitespace-normal",
      "hover:break-words",
      "break-words-x",
      "text-wrap-balance",
      "xwhitespace-normal",
      "whitespace-nowrap",
      "overflow-hidden text-ellipsis",
      "",
    ]) {
      expect(isWrappingLineClassName(className)).toBe(false);
    }

    expect(isWrappingLineClassName(undefined)).toBe(false);
    expect(isWrappingLineClassName(null)).toBe(false);
    expect(
      getIsolatedLine({
        text: ENGLISH_NAME,
        pageLanguage: "ar",
        className: "md:whitespace-normal",
      }).className,
    ).toBe(`md:whitespace-normal ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`);
  });

  test("a line cut short to a few lines that also breaks its words is as wide as its words once", () => {
    const className: string =
      "line-clamp-2 text-sm font-normal text-gray-500 [overflow-wrap:anywhere]";

    expect(
      getIsolatedLine({ text: ENGLISH_NAME, pageLanguage: "fa", className }),
    ).toEqual({
      dir: "ltr",
      className: `${className} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    });
  });

  test("words that read the page's way are drawn exactly as they were, wrapping or not", () => {
    expect(
      getIsolatedLine({
        text: ARABIC_NAME,
        pageLanguage: "ar",
        className: "whitespace-normal break-words",
      }),
    ).toEqual({ dir: undefined, className: "whitespace-normal break-words" });
    expect(
      getIsolatedLine({
        text: ENGLISH_NAME,
        pageLanguage: "en",
        className: "[overflow-wrap:anywhere]",
      }),
    ).toEqual({ dir: undefined, className: "[overflow-wrap:anywhere]" });
  });

  test("a Persian line that wraps on an English page reads right to left, as wide as its words", () => {
    expect(
      getIsolatedLine({
        text: ARABIC_NAME,
        pageLanguage: "en",
        className: "break-words",
      }),
    ).toEqual({
      dir: "rtl",
      className: `break-words ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    });
  });

  test("drawn, Spend's job name on a Persian page reads left to right, its lines from its own start", () => {
    drawOn(
      "fa",
      <div className="flex flex-wrap items-center gap-2">
        <IsolatedLine
          as="span"
          text="nightly_orders_rollup_eu_west_1_full_refresh (dbt)"
          className="min-w-0 font-medium text-gray-900 [overflow-wrap:anywhere]"
          dataTestId="job-name"
        />
      </div>,
    );

    const line: HTMLElement = screen.getByTestId("job-name");

    expect(line).toHaveAttribute("dir", "ltr");
    expect(line).toHaveClass(
      "[overflow-wrap:anywhere]",
      ...CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
    );
    expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    // The badge's row beside it keeps the page's way.
    expect(line.parentElement).not.toHaveAttribute("dir");
  });

  test("a one-line name (truncate) is still aligned to its end", () => {
    drawOn(
      "ar",
      <IsolatedLine
        text={ENGLISH_NAME}
        className="min-w-0 truncate"
        dataTestId="one-line"
      />,
    );

    expect(screen.getByTestId("one-line")).toHaveClass(
      LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
    );
  });
});

/*
 * A LINE IN THE MIDDLE OF ITS BOX (#6858).
 *
 * A gauge's and an SLO tile's title sit centred over the tile
 * (text-center). Aligned to its end as a one-line box is, a short English
 * title on an Arabic board would leave the middle for the tile's right
 * side; it keeps its place and takes only its dir, which is what cuts a
 * long one at its own end: a line too long for its box runs from its own
 * start, wherever it is aligned.
 */
describe("a line centred in its box", () => {
  const TITLE_CLASS_NAME: string =
    "text-[11px] font-medium text-gray-400 truncate uppercase tracking-wider w-full text-center";

  test.each(["ar", "fa"])(
    "an English title on a %s page reads left to right and stays centred",
    (language: string) => {
      expect(isCentredLineClassName(TITLE_CLASS_NAME)).toBe(true);
      expect(
        getIsolatedLine({
          text: ENGLISH_NAME,
          pageLanguage: language,
          className: TITLE_CLASS_NAME,
        }),
      ).toEqual({ dir: "ltr", className: TITLE_CLASS_NAME });
    },
  );

  test("an Arabic title on an English page reads right to left and stays centred", () => {
    expect(
      getIsolatedLine({
        text: ARABIC_NAME,
        pageLanguage: "en",
        className: "truncate text-center",
      }),
    ).toEqual({ dir: "rtl", className: "truncate text-center" });
  });

  test("a centred line cut to a few lines keeps its place as well", () => {
    expect(
      getIsolatedLine({
        text: ENGLISH_NAME,
        pageLanguage: "ar",
        className: "line-clamp-2 text-center",
      }),
    ).toEqual({ dir: "ltr", className: "line-clamp-2 text-center" });
  });

  test("words that read the page's way are drawn exactly as they were", () => {
    expect(
      getIsolatedLine({
        text: ARABIC_NAME,
        pageLanguage: "ar",
        className: TITLE_CLASS_NAME,
      }),
    ).toEqual({ dir: undefined, className: TITLE_CLASS_NAME });
    expect(
      getIsolatedLine({
        text: ENGLISH_NAME,
        pageLanguage: "en",
        className: TITLE_CLASS_NAME,
      }),
    ).toEqual({ dir: undefined, className: TITLE_CLASS_NAME });
  });

  test("only the whole class counts: a variant's, a look-alike's or the start's and end's do not", () => {
    for (const className of [
      "md:text-center",
      "hover:text-center",
      "text-center-x",
      "xtext-center",
      "text-start",
      "text-end",
      "text-left",
      "items-center justify-center",
      "",
    ]) {
      expect(isCentredLineClassName(className)).toBe(false);
    }

    expect(isCentredLineClassName(undefined)).toBe(false);
    expect(isCentredLineClassName(null)).toBe(false);
    // A variant's centring is the page's at the other widths: aligned to its end.
    expect(
      getIsolatedLine({
        text: ENGLISH_NAME,
        pageLanguage: "ar",
        className: "truncate md:text-center",
      }).className,
    ).toBe(`truncate md:text-center ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`);
  });

  test("drawn on a Persian page, the title is a centred line read left to right", () => {
    drawOn(
      "fa",
      <IsolatedLine
        text="Checkout availability"
        className={TITLE_CLASS_NAME}
        dataTestId="centred-title"
      />,
    );

    const title: HTMLElement = screen.getByTestId("centred-title");

    expect(title).toHaveAttribute("dir", "ltr");
    expect(title).toHaveClass("text-center", "truncate");
    expect(title).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    expect(title.className).toBe(TITLE_CLASS_NAME);
  });
});

describe("a badge's words (Pill)", () => {
  test.each(["ar", "fa"])(
    "on a %s page a label named in English reads left to right; its dot stays the page's",
    (language: string) => {
      drawOn(
        language,
        <Pill text="Production EU West" color={new Color("#0f766e")} />,
      );

      expect(screen.getByTestId("pill-text")).toHaveAttribute("dir", "ltr");
      // The badge itself, and so where its dot is, read as the page does.
      expect(screen.getByTestId("pill")).not.toHaveAttribute("dir");
      expect(screen.getByTestId("pill").textContent).toBe("Production EU West");
    },
  );

  test("a badge in the page's own words is drawn as it always was", () => {
    drawOn("ar", <Pill text={ARABIC_NAME} color={new Color("#0f766e")} />);
    expect(screen.getByTestId("pill-text")).not.toHaveAttribute("dir");

    cleanup();

    drawOn("en", <Pill text="Production" color={new Color("#0f766e")} />);
    expect(screen.getByTestId("pill-text")).not.toHaveAttribute("dir");
  });

  test("a badge with no letters (a count) reads as the page does", () => {
    drawOn("ar", <Pill text="42" color={new Color("#0f766e")} />);
    expect(screen.getByTestId("pill-text")).not.toHaveAttribute("dir");
  });
});

describe("a probe's and a role's name", () => {
  /*
   * Drawn inline in the page's line, an English probe name too long for its
   * cell lost its start ("gapore office behind the corporate proxy"), with
   * no "..." to say so. Its own line reads its way and ends in "...".
   */
  test("a probe's English name is a line of its own, read left to right and cut at its own end", () => {
    const probe: Probe = new Probe();
    probe.name = "Ohio (us-east-2)";

    drawOn("ar", <ProbeElement probe={probe} suffix="(2)" />);

    const name: HTMLElement = screen.getByTestId("probe-name");

    expect(name).toHaveAttribute("dir", "ltr");
    expect(name).toHaveClass(
      "overflow-hidden",
      "text-ellipsis",
      LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
    );
    // The words read as they always did: the name, then the suffix.
    expect(name.textContent).toBe("Ohio (us-east-2) (2)");
    // Its box may shrink below its words, so the "..." can show.
    expect(name.parentElement).toHaveClass("min-w-0");
  });

  test("a probe's name in the page's script keeps the page's way", () => {
    const probe: Probe = new Probe();
    probe.name = ARABIC_NAME;

    drawOn("ar", <ProbeElement probe={probe} />);

    expect(screen.getByTestId("probe-name")).not.toHaveAttribute("dir");
  });

  test("a probe with no suffix keeps the words it always had", () => {
    const probe: Probe = new Probe();
    probe.name = "Frankfurt";

    drawOn("en", <ProbeElement probe={probe} />);

    expect(screen.getByTestId("probe-name").textContent).toBe("Frankfurt ");
  });

  test("a role's English name reads left to right beside its mark", () => {
    drawOn(
      "fa",
      <div data-testid="role">
        <RoleLabel name="Incident Commander" color={new Color("#b91c1c")} />
      </div>,
    );

    const name: HTMLElement = screen.getByText("Incident Commander");

    // Its own line, cut short at its own end where its cell is narrow.
    expect(name).toHaveAttribute("dir", "ltr");
    expect(name).toHaveClass(
      "min-w-0",
      "overflow-hidden",
      "text-ellipsis",
      LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
    );
    // Its mark beside it keeps the page's way.
    expect(name.parentElement).not.toHaveAttribute("dir");
    expect(name.parentElement).toHaveClass("min-w-0");
    expect(screen.getByTestId("role").textContent).toBe("Incident Commander");
  });
});
