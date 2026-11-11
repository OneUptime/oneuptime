import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import IsolatedLine, {
  getIsolatedLine,
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
 * own end; a badge's words (Pill), a probe's and a role's name read their
 * own way inside the page's line.
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
  test("a probe's English name reads left to right inside the page's line, its suffix after it", () => {
    const probe: Probe = new Probe();
    probe.name = "Ohio (us-east-2)";

    drawOn("ar", <ProbeElement probe={probe} suffix="(2)" />);

    const name: HTMLElement = screen.getByTestId("probe-name");
    const isolate: HTMLElement = name.querySelector("bdi") as HTMLElement;

    expect(isolate).toHaveAttribute("dir", "ltr");
    expect(isolate.textContent).toBe("Ohio (us-east-2)");
    // The words read as they always did: the name, then the suffix.
    expect(name.textContent).toBe("Ohio (us-east-2) (2)");
    // The name's line, and the probe's mark beside it, keep the page's way.
    expect(name).not.toHaveAttribute("dir");
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

    const isolate: HTMLElement = screen
      .getByTestId("role")
      .querySelector("bdi") as HTMLElement;

    expect(isolate).toHaveAttribute("dir", "ltr");
    expect(screen.getByTestId("role").textContent).toBe("Incident Commander");
  });
});
