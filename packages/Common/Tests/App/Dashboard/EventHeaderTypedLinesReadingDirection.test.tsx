import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import EventStatusPanel, {
  ComponentProps,
  EventStatusFact,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import {
  EVENT_HEADER_FACT_LABEL_TEXT_CLASS_NAME,
  EVENT_HEADER_TEST_IDS,
  EVENT_HEADER_TITLE_CLASS_NAME,
  EVENT_HEADER_TITLE_WORDS_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventHeaderLayout";
import { getCommanderFact } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventPeopleFacts";
import { isWrappingLineClassName } from "../../../UI/Components/IsolatedText/IsolatedLine";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import { StateListType } from "../../../Utils/StateOrder";

/*
 * AN EVENT'S HEADER, ITS TYPED LINES READ THE WAY THEY ARE WRITTEN (#7086).
 *
 * The header of an incident, an alert, an episode and a maintenance event
 * draws two lines someone typed: the record's title, and - over the person
 * who holds it - the name the project gave its primary role. On an Arabic
 * or Persian page, laid out from the right, an English title wrapped with
 * each of its lines lined up on the right, and its full stop or bracket at
 * its end was drawn at its start (".(High Node Memory Utilization (EU"); an
 * English role name did the same over its person.
 *
 * Each is a line of its own now that reads the way it is written
 * (IsolatedLine): the title as a box inside the heading, which keeps its
 * tag, its classes and its place in the header; the role name as its
 * label's words beside the label's icon. A title or a name that reads the
 * page's way is drawn exactly as it was, and so is everything on an
 * English page. The header is drawn here with the real Dashboard locales.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
};

const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["ar", "fa"];

const ENGLISH_TITLE: string =
  "oneuptime-test - High Node Memory Utilization on AllNodesInEuWest1 (p95).";
const ARABIC_TITLE: string = "ارتفاع استخدام ذاكرة العقد في المنطقة الأوروبية.";

const ENGLISH_ROLE: string = "Incident Lead (EU on-call)";
const ARABIC_ROLE: string = "قائد الاستجابة";

const instances: Record<string, i18n> = {};
const locales: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  for (const language of ["en", "ar", "fa"]) {
    const instance: i18n = createInstance();

    locales[language] = readLocale(language);

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: locales[language]! } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const drawHeader: (
  language: string,
  overrides: Partial<ComponentProps>,
) => void = (language: string, overrides: Partial<ComponentProps>): void => {
  const props: ComponentProps = {
    stateList: StateListType.IncidentState,
    states: [
      { id: "created", name: "Created", color: new Color("#64748b") },
      { id: "resolved", name: "Resolved", color: new Color("#10b981") },
    ],
    identifier: "INC-42",
    currentStateId: "created",
    actions: [],
    onActionClick: (): void => {},
    ...overrides,
  };

  render(
    <I18nextProvider i18n={instances[language]!}>
      <EventStatusPanel {...props} />
    </I18nextProvider>,
  );
};

const titleOf: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId(EVENT_HEADER_TEST_IDS.title);
};

const CLAMPED_CLASSES: Array<string> =
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" ");

describe("the header's title", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English title is a line of its own inside the heading, wrapping from its own start",
    (language: string) => {
      drawHeader(language, { title: ENGLISH_TITLE });

      const heading: HTMLElement = titleOf();
      const words: HTMLElement = screen.getByTestId(
        EVENT_HEADER_TEST_IDS.titleWords,
      );

      // The heading is still the page's h2, in its place and with its classes.
      expect(heading.tagName).toBe("H2");
      expect(screen.getByRole("heading", { level: 2 })).toBe(heading);
      expect(heading).toHaveAccessibleName(ENGLISH_TITLE);
      expect(heading).not.toHaveAttribute("dir");
      expect(heading.className.split(" ")).toEqual(
        expect.arrayContaining(EVENT_HEADER_TITLE_CLASS_NAME.split(" ")),
      );

      // Its words read left to right, the full stop where it was typed.
      expect(Array.from(heading.children)).toEqual([words]);
      expect(heading.textContent).toBe(ENGLISH_TITLE);
      expect(words.tagName).toBe("SPAN");
      expect(words.textContent).toBe(ENGLISH_TITLE);
      expect(words).toHaveAttribute("dir", "ltr");

      /*
       * As wide as its words at the page's start, each wrapped line from its
       * own start - never lined up by its end, each line on the right.
       */
      expect(words.getAttribute("class")).toBe(
        `${EVENT_HEADER_TITLE_WORDS_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(words).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic title is drawn as it always was, with no box of its own",
    (language: string) => {
      drawHeader(language, { title: ARABIC_TITLE });

      const heading: HTMLElement = titleOf();

      expect(heading.children).toHaveLength(0);
      expect(heading.textContent).toBe(ARABIC_TITLE);
      expect(heading).not.toHaveAttribute("dir");
      expect(screen.queryByTestId(EVENT_HEADER_TEST_IDS.titleWords)).toBeNull();
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: a title with no letters (a number) reads as the page does",
    (language: string) => {
      drawHeader(language, { title: "502 / 503" });

      expect(titleOf().children).toHaveLength(0);
      expect(titleOf().textContent).toBe("502 / 503");
    },
  );

  test("on an English page an English title has the markup it always had", () => {
    drawHeader("en", { title: ENGLISH_TITLE });

    const heading: HTMLElement = titleOf();

    expect(heading.tagName).toBe("H2");
    expect(heading.children).toHaveLength(0);
    expect(heading.innerHTML).toBe(
      "oneuptime-test - High Node Memory Utilization on AllNodesInEuWest1 (p95).",
    );
    expect(heading).not.toHaveAttribute("dir");
    expect(screen.queryByTestId(EVENT_HEADER_TEST_IDS.titleWords)).toBeNull();
  });

  test("on an English page an Arabic title reads right to left, at the page's start", () => {
    drawHeader("en", { title: ARABIC_TITLE });

    const words: HTMLElement = screen.getByTestId(
      EVENT_HEADER_TEST_IDS.titleWords,
    );

    expect(words).toHaveAttribute("dir", "rtl");
    expect(words.textContent).toBe(ARABIC_TITLE);
    expect(words).toHaveClass(...CLAMPED_CLASSES);
    expect(titleOf()).not.toHaveAttribute("dir");
  });

  test("the title's words wrap whole: they say they wrap, and are never cut short", () => {
    const classes: Array<string> =
      EVENT_HEADER_TITLE_WORDS_CLASS_NAME.split(" ");

    // A block of its own inside the heading, breaking a word too long for it.
    expect(classes).toEqual(["block", "[overflow-wrap:anywhere]"]);
    // So IsolatedLine sizes it to its words rather than aligning it by its end.
    expect(isWrappingLineClassName(EVENT_HEADER_TITLE_WORDS_CLASS_NAME)).toBe(
      true,
    );
    expect(EVENT_HEADER_TITLE_WORDS_CLASS_NAME).not.toContain("truncate");
    expect(EVENT_HEADER_TITLE_WORDS_CLASS_NAME).not.toContain("line-clamp");

    // The heading around it keeps wrapping whole too.
    expect(EVENT_HEADER_TITLE_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "basis-full",
        "break-words",
        "[overflow-wrap:anywhere]",
      ]),
    );
  });

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: the number and the pills before the title keep the page's way",
    (language: string) => {
      drawHeader(language, { title: ENGLISH_TITLE });

      const chips: HTMLElement = screen.getByTestId(
        EVENT_HEADER_TEST_IDS.chips,
      );

      expect(chips).not.toHaveAttribute("dir");
      expect(
        within(chips).getByTestId(EVENT_HEADER_TEST_IDS.number),
      ).not.toHaveAttribute("dir");
      // Read before the actions, as before.
      expect(
        Array.from(screen.getByTestId(EVENT_HEADER_TEST_IDS.top).children)[1],
      ).toBe(titleOf());
    },
  );
});

describe("the commander fact's label: the project's name for its primary role", () => {
  const commanderFact: (roleName: string) => EventStatusFact = (
    roleName: string,
  ): EventStatusFact => {
    return getCommanderFact({
      holding: {
        role: {
          id: "0193c0de-7086-4aaa-8bbb-000000000001",
          name: roleName,
          isPrimaryRole: true,
        },
        members: [
          {
            roleId: "0193c0de-7086-4aaa-8bbb-000000000001",
            userId: "0193c0de-7086-4aaa-8bbb-000000000002",
            name: "Maya Chen",
            hasProfilePicture: false,
          },
        ],
      },
    })!;
  };

  // The label's words: the dt's last child, after its icon.
  const labelWordsOf: (labelText: string) => HTMLElement = (
    labelText: string,
  ): HTMLElement => {
    const facts: HTMLElement = screen.getByTestId(EVENT_HEADER_TEST_IDS.facts);
    const label: HTMLElement | undefined = Array.from(
      facts.querySelectorAll("dt"),
    ).find((element: HTMLElement): boolean => {
      return element.textContent === labelText;
    });

    expect(label).toBeDefined();

    return label!.lastElementChild as HTMLElement;
  };

  test("the commander fact says its label is a name someone typed", () => {
    const fact: EventStatusFact = commanderFact(ENGLISH_ROLE);

    expect(fact.label).toBe(ENGLISH_ROLE);
    expect(fact.isLabelTyped).toBe(true);
    expect(fact.icon).toBe(IconProp.ShieldCheck);
  });

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English role name wraps from its own start beside its icon",
    (language: string) => {
      drawHeader(language, {
        title: ENGLISH_TITLE,
        facts: [commanderFact(ENGLISH_ROLE)],
      });

      const words: HTMLElement = labelWordsOf(ENGLISH_ROLE);
      const label: HTMLElement = words.parentElement as HTMLElement;

      expect(label.tagName).toBe("DT");
      expect(words.tagName).toBe("SPAN");
      expect(words.textContent).toBe(ENGLISH_ROLE);
      expect(words).toHaveAttribute("dir", "ltr");
      expect(words.getAttribute("class")).toBe(
        `${EVENT_HEADER_FACT_LABEL_TEXT_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(words).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);

      // The label keeps the page's way: its icon first, at the page's start.
      expect(label).not.toHaveAttribute("dir");
      expect(label.children).toHaveLength(2);
      expect(label.firstElementChild).not.toBe(words);
      expect(label.firstElementChild!.querySelector("svg")).not.toBeNull();
      expect(label.firstElementChild).not.toHaveAttribute("dir");
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: the built-in name is the reader's word for it, drawn as it was",
    (language: string) => {
      const word: string = locales[language]!["Incident Commander"]!;

      expect(word).toBeTruthy();
      expect(word).not.toBe("Incident Commander");

      drawHeader(language, {
        title: ENGLISH_TITLE,
        facts: [commanderFact("Incident Commander")],
      });

      const words: HTMLElement = labelWordsOf(word);

      expect(words).not.toHaveAttribute("dir");
      expect(words.getAttribute("class")).toBe(
        EVENT_HEADER_FACT_LABEL_TEXT_CLASS_NAME,
      );
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic role name reads the page's way, drawn as it was",
    (language: string) => {
      drawHeader(language, {
        title: ARABIC_TITLE,
        facts: [commanderFact(ARABIC_ROLE)],
      });

      const words: HTMLElement = labelWordsOf(ARABIC_ROLE);

      expect(words).not.toHaveAttribute("dir");
      expect(words.getAttribute("class")).toBe(
        EVENT_HEADER_FACT_LABEL_TEXT_CLASS_NAME,
      );
    },
  );

  test("on an English page an English role name has the markup of any other label", () => {
    drawHeader("en", {
      title: ENGLISH_TITLE,
      facts: [
        commanderFact(ENGLISH_ROLE),
        { label: ENGLISH_ROLE, icon: IconProp.ShieldCheck, value: "Maya Chen" },
      ],
    });

    const labels: Array<HTMLElement> = Array.from(
      screen
        .getByTestId(EVENT_HEADER_TEST_IDS.facts)
        .querySelectorAll<HTMLElement>("dt"),
    );

    expect(labels).toHaveLength(2);
    // The typed label and a product label of the same words: the same markup.
    expect(labels[0]!.outerHTML).toBe(labels[1]!.outerHTML);
    expect(labels[0]!.lastElementChild).not.toHaveAttribute("dir");
    expect(labels[0]!.lastElementChild!.getAttribute("class")).toBe(
      EVENT_HEADER_FACT_LABEL_TEXT_CLASS_NAME,
    );
  });

  test("on an English page an Arabic role name reads right to left", () => {
    drawHeader("en", {
      title: ENGLISH_TITLE,
      facts: [commanderFact(ARABIC_ROLE)],
    });

    const words: HTMLElement = labelWordsOf(ARABIC_ROLE);

    expect(words).toHaveAttribute("dir", "rtl");
    expect(words).toHaveClass(...CLAMPED_CLASSES);
  });

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: a label that is the product's own words is left as it was, even in English",
    (language: string) => {
      /*
       * The product's labels are looked up in the reader's language; one
       * not worded there yet is not a typed name, and keeps the markup every
       * label had.
       */
      drawHeader(language, {
        title: ENGLISH_TITLE,
        facts: [
          {
            label: "Zz product label not worded yet",
            icon: IconProp.Info,
            value: "-",
          },
        ],
      });

      const words: HTMLElement = labelWordsOf(
        "Zz product label not worded yet",
      );

      expect(words).not.toHaveAttribute("dir");
      expect(words.getAttribute("class")).toBe(
        EVENT_HEADER_FACT_LABEL_TEXT_CLASS_NAME,
      );
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: the commander's name under the label reads its own way too",
    (language: string) => {
      drawHeader(language, {
        title: ENGLISH_TITLE,
        facts: [commanderFact(ENGLISH_ROLE)],
      });

      const person: HTMLElement = screen.getByTestId("event-person-name");

      expect(person.textContent).toBe("Maya Chen");
      expect(person).toHaveAttribute("dir", "ltr");
    },
  );
});
