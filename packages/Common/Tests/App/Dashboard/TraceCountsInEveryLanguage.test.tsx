import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { RenderResult, cleanup, render } from "@testing-library/react";
import * as React from "react";

/*
 * ---------------------------------------------------------------------------
 * Counts and ages in Traces, in every language
 * ---------------------------------------------------------------------------
 *
 * A count picks a form by the language's own rule, not English's: Russian says
 * 21 in its "one" form, French says 0 there, and Japanese has no such form. So
 * each counted phrase is drawn across the counts those rules split on, in every
 * language, and read for what a reader must never see: a placeholder, a bare
 * key, or an English form borrowed for a count English would not use it for.
 *
 * A row's age is the shortest phrase on the list and the one that wrapped: in
 * Swedish "1 min sedan" ran to two lines in a column sized for "1m ago", and
 * every row grew. It is mounted in the real TraceRow, on either side of each
 * boundary between its units.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 0 };
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 0 };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async () => {
        return { data: {} };
      },
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDInFactory } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDInFactory("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import TraceRow from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceRow";
import {
  ATTRIBUTE_COUNT,
  ERROR_COUNT,
  EXCEPTION_COUNT,
  MATCH_COUNT,
  SPAN_COUNT,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceDetailPresentation";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import {
  PluralTemplate,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  ENGLISH,
  LANGUAGES,
  NO_ONE_FORM,
  OTHER_LANGUAGES,
  createLanguageInstances,
  hasOwnWording,
  inLanguage,
  sentence,
  textOf,
  translatorFor,
} from "./TracesLanguageHarness";

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

// Half a second past the mark, so a slow machine cannot cross a boundary.
const PAST_THE_MARK: number = 500;

const COUNTED_PHRASES: Array<PluralTemplate> = [
  SPAN_COUNT,
  ERROR_COUNT,
  ATTRIBUTE_COUNT,
  EXCEPTION_COUNT,
  MATCH_COUNT,
  {
    one: "Copied {{count}} attribute as {{format}} JSON",
    other: "Copied {{count}} attributes as {{format}} JSON",
  },
  {
    one: "Copy {{count}} attribute as {{format}} JSON",
    other: "Copy {{count}} attributes as {{format}} JSON",
  },
  {
    one: "Filter {{count}} attribute",
    other: "Filter {{count}} attributes",
  },
  {
    one: "Load {{count}} more span",
    other: "Load {{count}} more spans",
  },
  {
    one: "Showing the first {{count}} span.",
    other: "Showing the first {{count}} spans.",
  },
  {
    one: "Showing {{loaded}} of {{count}} span.",
    other: "Showing {{loaded}} of {{count}} spans.",
  },
  {
    one: "{{count}} hidden span",
    other: "{{count}} hidden spans",
  },
  {
    one: "{{count}} span of {{total}} match",
    other: "{{count}} spans of {{total}} match",
  },
];

// What a phrase's other placeholders hold.
const VALUES: Record<string, string> = {
  format: "Nested",
  loaded: "7",
  total: "9",
};

// The counts the languages' plural rules split on.
const COUNTS: Array<number> = [
  0, 1, 2, 3, 4, 5, 7, 10, 11, 12, 14, 19, 20, 21, 22, 25, 100, 101, 102, 111,
  121, 1000, 1001, 1234567,
];

const AGE_PHRASES: Array<string> = [
  "{{count}}s ago",
  "{{count}}m ago",
  "{{count}}h ago",
  "{{count}}d ago",
  "{{count}}mo ago",
  "{{count}}y ago",
];

// How long ago a span started, what its row says, and of how many.
const AGES: Array<[string, number, string, number]> = [
  ["five seconds", 5 * SECOND, "{{count}}s ago", 5],
  ["the last second of a minute", 59 * SECOND, "{{count}}s ago", 59],
  ["a minute", MINUTE, "{{count}}m ago", 1],
  ["the last minute of an hour", 59 * MINUTE, "{{count}}m ago", 59],
  ["an hour", HOUR, "{{count}}h ago", 1],
  ["the last hour of a day", 23 * HOUR, "{{count}}h ago", 23],
  ["a day", DAY, "{{count}}d ago", 1],
  ["the last day of a month", 29 * DAY, "{{count}}d ago", 29],
  ["a month", 30 * DAY, "{{count}}mo ago", 1],
  ["the last month of a year", 330 * DAY, "{{count}}mo ago", 11],
  ["a year", 360 * DAY, "{{count}}y ago", 1],
  ["two years", 720 * DAY, "{{count}}y ago", 2],
];

const makeSpan: (ageInMs: number) => Span = (ageInMs: number): Span => {
  const span: Span = new Span();
  span.spanId = "a1b2c3d4e5f60718";
  span.traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  span.name = "GET /health";
  span.statusCode = SpanStatus.Ok;
  span.durationUnixNano = 1_000_000;
  span.startTime = new Date(Date.now() - ageInMs - PAST_THE_MARK);
  return span;
};

// The row's age: the only cell titled with the span's start time.
const ageCell: (result: RenderResult) => HTMLElement = (
  result: RenderResult,
): HTMLElement => {
  const cell: HTMLElement | null = result.container.querySelector<HTMLElement>(
    "div.text-right[title]",
  );

  expect(cell).not.toBeNull();

  return cell as HTMLElement;
};

beforeAll(async () => {
  await createLanguageInstances();
});

afterEach(() => {
  cleanup();
});

describe("the counted phrases, in the Dashboard's locales", () => {
  test("each is a key of the Dashboard's English, in both forms", () => {
    for (const phrase of COUNTED_PHRASES) {
      expect(ENGLISH[phrase.other]).toBe(phrase.other);
      expect(ENGLISH[`${phrase.other}_one`]).toBe(phrase.one);
    }
  });

  test.each(OTHER_LANGUAGES)(
    "%s words each phrase's general form",
    (language: string) => {
      expect(
        COUNTED_PHRASES.filter((phrase: PluralTemplate): boolean => {
          return !hasOwnWording(language, phrase.other);
        }).map((phrase: PluralTemplate): string => {
          return phrase.other;
        }),
      ).toEqual([]);
    },
  );

  test.each(
    OTHER_LANGUAGES.filter((language: string): boolean => {
      return !NO_ONE_FORM.includes(language);
    }),
  )("%s words each phrase's one form", (language: string) => {
    expect(
      COUNTED_PHRASES.filter((phrase: PluralTemplate): boolean => {
        return !hasOwnWording(language, `${phrase.other}_one`);
      }).map((phrase: PluralTemplate): string => {
        return phrase.one;
      }),
    ).toEqual([]);
  });
});

describe.each(LANGUAGES)("counted phrases in %s", (language: string) => {
  test.each(
    COUNTED_PHRASES.map((phrase: PluralTemplate): [string, PluralTemplate] => {
      return [phrase.other, phrase];
    }),
  )(
    "%s reads whole for every count",
    (_name: string, phrase: PluralTemplate) => {
      const translator: Translator = translatorFor(language);

      for (const count of COUNTS) {
        const drawn: string = translator.translatePlural(phrase, count, VALUES);

        if (drawn.includes("{{") || drawn.includes("_one")) {
          throw new Error(`${count} drew ${drawn}`);
        }

        if (!drawn.includes(translator.formatNumber(count))) {
          throw new Error(`${count} is missing from ${drawn}`);
        }
      }
    },
  );
});

describe("a language's own rule picks the form", () => {
  test("English says one for exactly 1", () => {
    const translator: Translator = translatorFor("en");

    expect(translator.translatePlural(SPAN_COUNT, 1)).toBe("1 span");
    expect(translator.translatePlural(SPAN_COUNT, 0)).toBe("0 spans");
    expect(translator.translatePlural(SPAN_COUNT, 21)).toBe("21 spans");
  });

  test("Russian says 21 in its one form, and 11 in its general form", () => {
    const translator: Translator = translatorFor("ru");
    const oneForm: string = sentence("ru", `${SPAN_COUNT.other}_one`, {
      count: "21",
    });

    expect(translator.translatePlural(SPAN_COUNT, 21)).toBe(oneForm);
    expect(translator.translatePlural(SPAN_COUNT, 11)).not.toBe(
      sentence("ru", `${SPAN_COUNT.other}_one`, { count: "11" }),
    );
  });

  test("French says 0 in its one form", () => {
    expect(translatorFor("fr").translatePlural(ERROR_COUNT, 0)).toBe(
      sentence("fr", `${ERROR_COUNT.other}_one`, { count: "0" }),
    );
  });

  test.each(NO_ONE_FORM)(
    "%s has one form for 1 and for 2",
    (language: string) => {
      const translator: Translator = translatorFor(language);

      expect(
        translator
          .translatePlural(SPAN_COUNT, 1)
          .replace(translator.formatNumber(1), "#"),
      ).toBe(
        translator
          .translatePlural(SPAN_COUNT, 2)
          .replace(translator.formatNumber(2), "#"),
      );
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s writes a large count its own way",
    (language: string) => {
      const translator: Translator = translatorFor(language);

      expect(translator.translatePlural(SPAN_COUNT, 1234567)).toContain(
        (1234567).toLocaleString(language),
      );
    },
  );
});

describe("the age phrases, in the Dashboard's locales", () => {
  test("each is a key of the Dashboard's English", () => {
    for (const phrase of AGE_PHRASES) {
      expect(ENGLISH[phrase]).toBe(phrase);
    }
  });

  test.each(LANGUAGES)(
    "%s tells every unit apart: 5 minutes is never 5 months",
    (language: string) => {
      const ages: Array<string> = AGE_PHRASES.map((phrase: string): string => {
        return sentence(language, phrase, { count: 5 });
      });

      expect(new Set(ages).size).toBe(AGE_PHRASES.length);
    },
  );

  test.each(LANGUAGES)("%s says the count", (language: string) => {
    for (const phrase of AGE_PHRASES) {
      const drawn: string = sentence(language, phrase, { count: 47 });

      expect(drawn).toContain("47");
      expect(drawn).not.toContain("{{");
    }
  });
});

describe.each(LANGUAGES)("a row's age in %s", (language: string) => {
  test.each(AGES)(
    "%s ago",
    (_name: string, ageInMs: number, phrase: string, count: number) => {
      const result: RenderResult = render(
        inLanguage(
          language,
          <TraceRow span={makeSpan(ageInMs)} maxDurationNano={4_000_000} />,
        ),
      );

      expect(textOf(ageCell(result))).toBe(
        sentence(language, phrase, { count }),
      );
    },
  );

  test("REGRESSION: stays on one line, in a column wide enough to hold it", () => {
    const result: RenderResult = render(
      inLanguage(
        language,
        <TraceRow span={makeSpan(MINUTE)} maxDurationNano={4_000_000} />,
      ),
    );

    expect(ageCell(result)).toHaveClass("whitespace-nowrap", "w-24");
    expect(ageCell(result)).not.toHaveClass("w-16");
  });

  test("the hover says when, in full, whatever the row's language", () => {
    const span: Span = makeSpan(MINUTE);
    const result: RenderResult = render(
      inLanguage(
        language,
        <TraceRow span={span} maxDurationNano={4_000_000} />,
      ),
    );

    expect(ageCell(result).getAttribute("title")).toContain(
      (span.startTime as Date).toISOString(),
    );
  });
});
