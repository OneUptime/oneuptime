import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import fs from "fs";
import path from "path";

/*
 * Issue #5073: the AI Logs' "Tokens Used" showed every token a call used,
 * the ones the provider read from its prompt cache included, with "(N
 * cached)" beside it - so an agent loop's calls, which read most of their
 * conversation from cache, showed several times what they cost, and
 * nothing matched the project's daily limits once they counted cached tokens
 * by what they cost. The column now shows the tokens as OneUptime counts them
 * (AiTokenCount) - what the limits add up and the AI credits charge - and,
 * under that count, the facts behind it: how many tokens the call used in
 * all, how many came from the cache and how many went into it - the
 * provider's own numbers ("28,496 tokens · 20,654 from cache · 4,216 written
 * to cache"). Each fact is translated whole and kept on one line, so a
 * narrow column wraps between facts, never inside one ("20,654 from" /
 * "cache"), with a dot between facts that share a line.
 *
 * The table itself is captured, not rendered: its columns are under test.
 */
const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import LlmLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/AILogs/LlmLogsTable";
import {
  getLlmLogCacheFacts,
  LLM_LOG_TOKENS_FROM_CACHE,
  LLM_LOG_TOKENS_WRITTEN_TO_CACHE,
  LLM_LOG_TOTAL_TOKENS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AILogs/LlmLogTokens";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import AiTokenCount from "../../../Types/AI/AiTokenCount";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

interface TokensColumn {
  title: string;
  headerTooltip?: string | undefined;
  wrapContent?: boolean | undefined;
  disableSort?: boolean | undefined;
  getElement: (item: LlmLog) => ReactElement;
}

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// The facts the column states, as en.json keys them (the "other" forms).
const FACT_TEMPLATES: Array<PluralTemplate> = [
  LLM_LOG_TOTAL_TOKENS,
  LLM_LOG_TOKENS_FROM_CACHE,
  LLM_LOG_TOKENS_WRITTEN_TO_CACHE,
];

/*
 * Languages that write "tokens" as English does: their "{{count}} tokens"
 * may stay the English text. Every other language words it its own way -
 * Italian too, whose "token" is the same for one and for many, so only its
 * "one" form reads as English's.
 */
const TOKENS_AS_IN_ENGLISH: Array<string> = [
  "da",
  "es",
  "nl",
  "no",
  "pt",
  "sv",
];

const ONE_TOKEN_AS_IN_ENGLISH: Array<string> = [...TOKENS_AS_IN_ENGLISH, "it"];

// Languages without a "one" form: their _one keys are never read.
const WITHOUT_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

const HEADER_TOOLTIP: string =
  "As counted toward the project's daily AI limits: a token the provider read from its prompt cache, or wrote to it, counts for what the model charges for it next to a fresh token. On most current models a read counts as a tenth of a token.";

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  const locale: Record<string, string> = readLocale(language);

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

function log(values: {
  totalTokens: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  modelName?: string;
}): LlmLog {
  const row: LlmLog = new LlmLog();
  row.totalTokens = values.totalTokens;
  row.cachedInputTokens = values.cachedInputTokens || 0;
  row.cacheCreationTokens = values.cacheCreationTokens || 0;
  if (values.modelName) {
    row.modelName = values.modelName;
  }
  return row;
}

function tokensColumn(): TokensColumn {
  render(<LlmLogsTable />);

  const props: Record<string, unknown> =
    mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
  const columns: Array<TokensColumn> = (props["columns"] ||
    []) as Array<TokensColumn>;
  const column: TokensColumn | undefined = columns.find(
    (candidate: TokensColumn) => {
      return candidate.title === "Tokens Used";
    },
  );

  expect(column).toBeDefined();

  return column!;
}

interface CellParts {
  count: string;
  // The facts under the count, each as it reads, without the dots.
  facts: Array<string>;
}

function factsIn(line: Element | null): Array<string> {
  if (!line) {
    return [];
  }

  return Array.from(line.querySelectorAll("p > span")).map(
    (fact: Element): string => {
      const copy: Element = fact.cloneNode(true) as Element;

      for (const dot of Array.from(
        copy.querySelectorAll("[aria-hidden='true']"),
      )) {
        dot.remove();
      }

      return (copy.textContent || "").trim();
    },
  );
}

function renderCell(item: LlmLog): HTMLElement {
  const { container } = render(tokensColumn().getElement(item));
  return container;
}

function cellParts(item: LlmLog): CellParts {
  const container: HTMLElement = renderCell(item);

  return {
    count:
      container.querySelector("[data-testid='llm-log-tokens'] > p")
        ?.textContent || "",
    facts: factsIn(
      container.querySelector("[data-testid='llm-log-cache-tokens']"),
    ),
  };
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("the AI Logs' Tokens Used", () => {
  test("shows an agent loop's call as it counts: 28,496 tokens, 20,654 of them read from cache, count 9,908", () => {
    expect(
      cellParts(log({ totalTokens: 28_496, cachedInputTokens: 20_654 })),
    ).toEqual({
      count: "9,908",
      facts: ["28,496 tokens", "20,654 from cache"],
    });
  });

  test("a call that wrote to the cache counts the quarter more it cost", () => {
    expect(
      cellParts(log({ totalTokens: 24_117, cacheCreationTokens: 20_654 })),
    ).toEqual({
      count: "29,281",
      facts: ["24,117 tokens", "20,654 written to cache"],
    });
  });

  test("a call that read and wrote - every call of an agent loop after its first - states both, in the same words", () => {
    expect(
      cellParts(
        log({
          totalTokens: 28_496,
          cachedInputTokens: 20_654,
          cacheCreationTokens: 4_216,
        }),
      ),
    ).toEqual({
      // 3,626 fresh + 2,066 for the cache read + 5,270 for the cache write.
      count: "10,962",
      facts: ["28,496 tokens", "20,654 from cache", "4,216 written to cache"],
    });
    expect(
      AiTokenCount.count({
        totalTokens: 28_496,
        cachedInputTokens: 20_654,
        cacheCreationTokens: 4_216,
      }),
    ).toBe(10_962);
  });

  test("a call that used no cache - or a row from before the cache was counted - shows its tokens alone", () => {
    const container: HTMLElement = renderCell(log({ totalTokens: 1_200 }));

    expect(
      container.querySelector("[data-testid='llm-log-tokens']")?.textContent,
    ).toBe("1,200");
    expect(
      container.querySelector("[data-testid='llm-log-cache-tokens']"),
    ).toBeNull();
  });

  test("each fact stays whole on one line, and a dot sits between facts but before none of them", () => {
    const container: HTMLElement = renderCell(
      log({
        totalTokens: 28_496,
        cachedInputTokens: 20_654,
        cacheCreationTokens: 4_216,
      }),
    );
    const line: HTMLElement = container.querySelector(
      "[data-testid='llm-log-cache-tokens']",
    ) as HTMLElement;
    const facts: Array<Element> = Array.from(line.querySelectorAll("p > span"));

    expect(facts).toHaveLength(3);

    for (const fact of facts) {
      // A narrow column wraps between facts, never inside one.
      expect(fact.className.split(" ")).toContain("whitespace-nowrap");
    }

    // The first fact has no dot; each later one has one a screen reader skips.
    expect(facts[0]!.querySelector("[aria-hidden='true']")).toBeNull();

    for (const fact of facts.slice(1)) {
      expect(fact.querySelector("[aria-hidden='true']")?.textContent).toBe("·");
    }

    /*
     * A fact a narrow column wraps to the start of a line keeps its dot in
     * the gap before it, which the box clips: no line starts with a dot.
     */
    expect(line.className.split(" ")).toContain("overflow-hidden");
    expect(line.querySelector("p")?.className.split(" ")).toEqual(
      expect.arrayContaining(["-ml-3", "flex", "flex-wrap"]),
    );
  });

  test("the facts are quieter than the count they explain", () => {
    const container: HTMLElement = renderCell(
      log({ totalTokens: 28_496, cachedInputTokens: 20_654 }),
    );

    expect(
      container
        .querySelector("[data-testid='llm-log-cache-tokens'] p")
        ?.className.split(" "),
    ).toEqual(expect.arrayContaining(["text-xs", "text-gray-500"]));
  });

  test("the (i) beside the title says how the tokens are counted", () => {
    const column: TokensColumn = tokensColumn();

    expect(column.headerTooltip).toBe(HEADER_TOOLTIP);
    // The line under the count may wrap rather than widen the table.
    expect(column.wrapContent).toBe(true);
  });

  test("is not sorted by the provider's counts, which are not the count it shows", () => {
    // 9,908 counted from 28,496 tokens; 29,281 counted from 24,117.
    const mostlyRead: number = AiTokenCount.count({
      totalTokens: 28_496,
      cachedInputTokens: 20_654,
    });
    const mostlyWritten: number = AiTokenCount.count({
      totalTokens: 24_117,
      cacheCreationTokens: 20_654,
    });

    // The call with more tokens counts less: the two orders disagree.
    expect(mostlyRead).toBeLessThan(mostlyWritten);
    expect(tokensColumn().disableSort).toBe(true);
  });

  test("the table reads both cache columns of every row, and its model", () => {
    render(<LlmLogsTable />);

    const props: Record<string, unknown> =
      mockCapturedTableProps[mockCapturedTableProps.length - 1]!;

    expect(props["selectMoreFields"]).toEqual(
      expect.objectContaining({
        cachedInputTokens: true,
        cacheCreationTokens: true,
        modelName: true,
      }),
    );
  });

  test("a row counts its cached tokens at its model's prices", () => {
    // gpt-4o reads its cache for half a fresh token's price.
    expect(
      cellParts(
        log({
          totalTokens: 28_496,
          cachedInputTokens: 20_654,
          modelName: "gpt-4o",
        }),
      ),
    ).toEqual({
      count: "18,169",
      facts: ["28,496 tokens", "20,654 from cache"],
    });

    // Claude Opus 5.5 for a twentieth.
    expect(
      cellParts(
        log({
          totalTokens: 28_496,
          cachedInputTokens: 20_654,
          modelName: "claude-opus-5-5",
        }),
      ).count,
    ).toBe("8,875");

    // A model the cost catalog has no cache price for: a tenth, as before.
    expect(
      cellParts(
        log({
          totalTokens: 28_496,
          cachedInputTokens: 20_654,
          modelName: "prod-fast",
        }),
      ).count,
    ).toBe("9,908");
  });
});

describe("the facts under the count, in words", () => {
  const ENGLISH: Translator = createTranslator(undefined, "en");

  test.each([
    [{ totalTokens: 100 }, []],
    [
      { totalTokens: 28_496, cachedInputTokens: 20_654 },
      ["28,496 tokens", "20,654 from cache"],
    ],
    [
      { totalTokens: 24_117, cacheCreationTokens: 20_654 },
      ["24,117 tokens", "20,654 written to cache"],
    ],
    [
      { totalTokens: 50, cachedInputTokens: 30, cacheCreationTokens: 10 },
      ["50 tokens", "30 from cache", "10 written to cache"],
    ],
    [{ totalTokens: 1, cachedInputTokens: 1 }, ["1 token", "1 from cache"]],
    [
      // A report that does not add up still states what was reported.
      { totalTokens: 10, cachedInputTokens: 40 },
      ["10 tokens", "40 from cache"],
    ],
  ])("%p states %p", (usage: Record<string, number>, facts: Array<string>) => {
    expect(
      getLlmLogCacheFacts(ENGLISH, AiTokenCount.getBreakdown(usage)),
    ).toEqual(facts);
  });

  test("in German, with German numbers", () => {
    expect(
      getLlmLogCacheFacts(
        translatorFor("de"),
        AiTokenCount.getBreakdown({
          totalTokens: 28_496,
          cachedInputTokens: 20_654,
          cacheCreationTokens: 4_216,
        }),
      ),
    ).toEqual([
      "28.496 Tokens",
      "20.654 aus dem Cache",
      "4.216 in den Cache geschrieben",
    ]);
  });

  test("in Spanish, whose words agree with the count", () => {
    expect(
      getLlmLogCacheFacts(
        translatorFor("es"),
        AiTokenCount.getBreakdown({
          totalTokens: 1,
          cacheCreationTokens: 1,
        }),
      ),
    ).toEqual(["1 token", "1 escrito en la caché"]);
    expect(
      getLlmLogCacheFacts(
        translatorFor("es"),
        AiTokenCount.getBreakdown({
          totalTokens: 24_117,
          cacheCreationTokens: 20_654,
        }),
      ),
    ).toEqual(["24.117 tokens", "20.654 escritos en la caché"]);
  });

  test("in Japanese, which has no 'one' form", () => {
    expect(
      getLlmLogCacheFacts(
        translatorFor("ja"),
        AiTokenCount.getBreakdown({
          totalTokens: 1,
          cacheCreationTokens: 1,
        }),
      ),
    ).toEqual(["1 トークン", "キャッシュへの書き込み 1"]);
  });

  test("in Russian, whose count reads right for any number", () => {
    expect(
      getLlmLogCacheFacts(
        translatorFor("ru"),
        AiTokenCount.getBreakdown({
          totalTokens: 28_496,
          cachedInputTokens: 20_654,
        }),
      ),
    ).toEqual([
      `Токенов: ${(28_496).toLocaleString("ru")}`,
      `из кэша: ${(20_654).toLocaleString("ru")}`,
    ]);
  });

  test.each(LANGUAGES)(
    "%s has its own words for every fact of the column and its (i)",
    (language: string) => {
      const english: Record<string, string> = readLocale("en");
      const locale: Record<string, string> = readLocale(language);
      const keys: Array<string> = [HEADER_TOOLTIP];

      for (const template of FACT_TEMPLATES) {
        keys.push(template.other, `${template.other}_one`);

        // en.json keys the "other" form and holds the "one" form under _one.
        expect(english[template.other]).toBe(template.other);
        expect(english[`${template.other}_one`]).toBe(template.one);
      }

      for (const key of keys) {
        const translated: string | undefined = locale[key];

        expect({ language, key, defined: translated !== undefined }).toEqual({
          language,
          key,
          defined: true,
        });

        // A fact's number is the language's to place, but it is there.
        expect({
          language,
          key,
          keepsCount: translated!.includes("{{count}}"),
        }).toEqual({ language, key, keepsCount: key !== HEADER_TOOLTIP });

        const isTokensAsInEnglish: boolean =
          key === LLM_LOG_TOTAL_TOKENS.other
            ? TOKENS_AS_IN_ENGLISH.includes(language)
            : key === `${LLM_LOG_TOTAL_TOKENS.other}_one` &&
              ONE_TOKEN_AS_IN_ENGLISH.includes(language);

        const isUnreadOneForm: boolean =
          key.endsWith("_one") && WITHOUT_ONE_FORM.includes(language);

        if (!isTokensAsInEnglish && !isUnreadOneForm) {
          expect({
            language,
            key,
            translated: translated !== english[key],
          }).toEqual({ language, key, translated: true });
        }
      }
    },
  );
});
