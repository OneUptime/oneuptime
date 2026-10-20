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
 * conversation from the cache, showed several times what they cost, and
 * nothing matched the project's daily limits once they counted cached tokens
 * by what they cost. The column now shows the tokens as OneUptime counts them
 * (AiTokenCount) - what the limits add up and the AI credits charge - and,
 * under that count, how many tokens the call used in all and how many of them
 * came from the cache or went into it: the provider's own numbers.
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
import { getLlmLogCacheText } from "../../../../App/FeatureSet/Dashboard/src/Components/AILogs/LlmLogTokens";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import AiTokenCount from "../../../Types/AI/AiTokenCount";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

interface TokensColumn {
  title: string;
  headerTooltip?: string | undefined;
  wrapContent?: boolean | undefined;
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

// The sentences the column says, as en.json keys them.
const CACHE_READ_KEY: string = "{{count}} tokens, {{cacheRead}} from the cache";
const CACHE_WRITE_KEY: string =
  "{{count}} tokens, {{cacheWrite}} written to the cache";
const CACHE_BOTH_KEY: string =
  "{{count}} tokens: {{cacheRead}} from the cache, {{cacheWrite}} written to it";
const HEADER_TOOLTIP: string =
  "As counted toward the project's daily AI limits: a token the provider read from its prompt cache counts as a tenth of a token, and a token written to that cache as one and a quarter.";

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
}): LlmLog {
  const row: LlmLog = new LlmLog();
  row.totalTokens = values.totalTokens;
  row.cachedInputTokens = values.cachedInputTokens || 0;
  row.cacheCreationTokens = values.cacheCreationTokens || 0;
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

function cellText(item: LlmLog): { count: string; cache: string } {
  const { container } = render(tokensColumn().getElement(item));
  const paragraphs: Array<string> = Array.from(
    container.querySelectorAll("p"),
  ).map((paragraph: HTMLParagraphElement) => {
    return paragraph.textContent || "";
  });

  return { count: paragraphs[0] || "", cache: paragraphs[1] || "" };
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("the AI Logs' Tokens Used", () => {
  test("shows an agent loop's call as it counts: 28,496 tokens, 20,654 of them read from the cache, count 9,908", () => {
    expect(
      cellText(log({ totalTokens: 28_496, cachedInputTokens: 20_654 })),
    ).toEqual({
      count: "9,908",
      cache: "28,496 tokens, 20,654 from the cache",
    });
  });

  test("a call that wrote to the cache counts the quarter more it cost", () => {
    expect(
      cellText(log({ totalTokens: 24_117, cacheCreationTokens: 20_654 })),
    ).toEqual({
      count: "29,281",
      cache: "24,117 tokens, 20,654 written to the cache",
    });
  });

  test("a call that read and wrote says both", () => {
    expect(
      cellText(
        log({
          totalTokens: 29_712,
          cachedInputTokens: 20_654,
          cacheCreationTokens: 4_216,
        }),
      ),
    ).toEqual({
      count: AiTokenCount.count({
        totalTokens: 29_712,
        cachedInputTokens: 20_654,
        cacheCreationTokens: 4_216,
      }).toLocaleString("en"),
      cache: "29,712 tokens: 20,654 from the cache, 4,216 written to it",
    });
  });

  test("a call that used no cache - or a row from before the cache was counted - shows its tokens alone", () => {
    expect(cellText(log({ totalTokens: 1_200 }))).toEqual({
      count: "1,200",
      cache: "",
    });
  });

  test("the (i) beside the title says how the tokens are counted", () => {
    const column: TokensColumn = tokensColumn();

    expect(column.headerTooltip).toBe(HEADER_TOOLTIP);
    // The line under the count may wrap rather than widen the table.
    expect(column.wrapContent).toBe(true);
  });

  test("the table reads both cache columns of every row", () => {
    render(<LlmLogsTable />);

    const props: Record<string, unknown> =
      mockCapturedTableProps[mockCapturedTableProps.length - 1]!;

    expect(props["selectMoreFields"]).toEqual(
      expect.objectContaining({
        cachedInputTokens: true,
        cacheCreationTokens: true,
      }),
    );
  });
});

describe("the line under the count, in words", () => {
  const ENGLISH: Translator = createTranslator(undefined, "en");

  test.each([
    [{ totalTokens: 100 }, ""],
    [
      { totalTokens: 28_496, cachedInputTokens: 20_654 },
      "28,496 tokens, 20,654 from the cache",
    ],
    [
      { totalTokens: 24_117, cacheCreationTokens: 20_654 },
      "24,117 tokens, 20,654 written to the cache",
    ],
    [
      { totalTokens: 50, cachedInputTokens: 30, cacheCreationTokens: 10 },
      "50 tokens: 30 from the cache, 10 written to it",
    ],
    [
      { totalTokens: 1, cachedInputTokens: 1 },
      "1 token, 1 from the cache",
    ],
  ])("%p says %p", (usage: Record<string, number>, text: string) => {
    expect(getLlmLogCacheText(ENGLISH, AiTokenCount.getBreakdown(usage))).toBe(
      text,
    );
  });

  test("in German, with German numbers", () => {
    expect(
      getLlmLogCacheText(
        translatorFor("de"),
        AiTokenCount.getBreakdown({
          totalTokens: 28_496,
          cachedInputTokens: 20_654,
        }),
      ),
    ).toBe("28.496 Tokens, davon 20.654 aus dem Cache");
  });

  test("in Japanese, which has no 'one' form", () => {
    expect(
      getLlmLogCacheText(
        translatorFor("ja"),
        AiTokenCount.getBreakdown({
          totalTokens: 1,
          cacheCreationTokens: 1,
        }),
      ),
    ).toBe("1 トークン（うちキャッシュへの書き込み 1）");
  });

  test.each(LANGUAGES)(
    "%s has its own words for every sentence of the column",
    (language: string) => {
      const english: Record<string, string> = readLocale("en");
      const locale: Record<string, string> = readLocale(language);

      for (const key of [
        CACHE_READ_KEY,
        CACHE_WRITE_KEY,
        CACHE_BOTH_KEY,
        HEADER_TOOLTIP,
      ]) {
        expect(english[key]).toBe(key);
        expect(locale[key]).toBeDefined();
        expect({ language, key, translated: locale[key] !== key }).toEqual({
          language,
          key,
          translated: true,
        });

        // Every placeholder the English sentence fills, the translation fills.
        for (const placeholder of ["{{count}}", "{{cacheRead}}", "{{cacheWrite}}"]) {
          expect({
            language,
            key,
            placeholder,
            kept: locale[key]!.includes(placeholder),
          }).toEqual({
            language,
            key,
            placeholder,
            kept: key.includes(placeholder),
          });
        }
      }
    },
  );
});
