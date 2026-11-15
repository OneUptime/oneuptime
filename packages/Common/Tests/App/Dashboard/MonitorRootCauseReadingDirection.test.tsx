import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult, screen } from "@testing-library/react";
import childProcess from "child_process";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import MonitorRootCauseValue from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/MonitorRootCauseValue";
import { getShownMarkdownReadingDirection } from "../../../UI/Components/Markdown.tsx/MarkdownReadingDirection";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import MonitorRootCauseWording from "../../../Utils/Monitor/MonitorRootCauseWording";
import { writeProbeTimeoutFailureCause } from "../../../Utils/Monitor/ProbeFailureReading";
import {
  REQUEST_FAILURE_DESCRIPTIONS,
  RequestFailureDescription,
} from "../../../Utils/Monitor/RequestFailureDescriptions";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * AN INCIDENT'S ROOT CAUSE READS THE WAY ITS LABELS DO (#8004).
 *
 * A root cause a monitor wrote is OneUptime's labels, worded in the reader's
 * language, with the values the check found after them:
 *
 *   **نام معیار**: Website is down
 *   - کد خطا: ETIMEDOUT
 *
 * The viewer lays each block out the way most of its letters read, and the
 * value usually has more letters than the label: on a Persian page the
 * line was laid out from the left, its colon and its bullet on the wrong
 * side, and the card turned from side to side line by line. Each value a
 * line keeps as stored is set apart from the label now (FSI ... PDI), and
 * an isolate's letters do not decide a block's way: the line reads as its
 * label does, the value whole inside it. A root cause somebody typed reads
 * the way its own words do, as before.
 *
 * Laid out with the real react-markdown and remark-gfm the Dashboard draws
 * it with, and the viewer's own rehype plugin and address check, in a node
 * subprocess (jest stubs react-markdown, an ES module; see
 * MarkdownUrlTransform.test.ts).
 */

type Language = "en" | "de" | "ar" | "fa";

const URL_CHECKED: string = "https://shop.example.com/health";

const CONNECTION_REFUSED: string =
  REQUEST_FAILURE_DESCRIPTIONS[RequestFailureDescription.ConnectionRefused];

const RAW_ERROR: string = "connect ECONNREFUSED 203.0.113.7:443";

// A Website monitor's root cause, line for line as the engine writes it.
const ROOT_CAUSE: string = [
  mdText`
**Created because the following criteria was met**:

**Criteria Name**: ${"Website is down"}
`.toString(),
  mdText`**Filter Conditions Met**: ${"Response Status Code was 503, above the 499 threshold."}`.toString(),
  "",
  mdText`**Cause**: ${writeProbeTimeoutFailureCause(3)}`.toString(),
  "",
  "**Request Details**",
  mdText`- Destination: ${URL_CHECKED}`.toString(),
  mdText`- Request Method: ${"GET"}`.toString(),
  "",
  "**Response Snapshot**",
  "- Timed Out: Yes",
  "- Attempts: 3",
  "",
  "**Request Failed Details**",
  mdText`- Failed Phase: ${"TCP Connection"}`.toString(),
  mdText`- Error Code: ${"ECONNREFUSED"}`.toString(),
  mdText`- Error Description: ${CONNECTION_REFUSED}`.toString(),
  mdText`- Raw Error Message: ${RAW_ERROR}`.toString(),
]
  .join("\n")
  .trim();

// A root cause somebody typed, in English.
const TYPED_ROOT_CAUSE: string = [
  "The checkout service ran out of database connections after the deploy.",
  "",
  "- Pool size was cut to 10 (was 40).",
  "- Rolled back at 09:42.",
].join("\n");

const word: (
  rootCause: string,
  language: Language,
  setsValuesApart?: boolean,
) => string = (
  rootCause: string,
  language: Language,
  setsValuesApart: boolean = true,
): string => {
  return MonitorRootCauseWording.wordRootCause({
    rootCause: rootCause,
    translator: dashboardTranslator(language),
    setsValuesApart: setsValuesApart,
  });
};

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");

const RENDER_SCRIPT: string = String.raw`
  const esbuild = require("esbuild");
  const Module = require("module");
  const path = require("path");

  const entry = [
    'import React from "react";',
    'import { renderToStaticMarkup } from "react-dom/server";',
    'import ReactMarkdown from "react-markdown";',
    'import remarkGfm from "remark-gfm";',
    'import { markdownUrlTransform } from "./UI/Components/Markdown.tsx/MarkdownUrlTransform";',
    'import { rehypeBlocksReadTheirOwnWay } from "./UI/Components/Markdown.tsx/MarkdownReadingDirection";',
    "const texts = JSON.parse(process.env.MARKDOWN_TEXTS);",
    "process.stdout.write(JSON.stringify(texts.map((text) => renderToStaticMarkup(",
    "  React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeBlocksReadTheirOwnWay], urlTransform: markdownUrlTransform }, text),",
    "))));",
  ].join("\n");

  esbuild
    .build({
      stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts", sourcefile: "render.ts" },
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
    })
    .then((result) => {
      const file = path.join(process.cwd(), "render.js");
      const compiled = new Module(file);
      compiled.filename = file;
      compiled.paths = Module._nodeModulePaths(process.cwd());
      compiled._compile(result.outputFiles[0].text, file);
    })
    .catch((error) => {
      process.stderr.write(String(error && error.stack ? error.stack : error));
      process.exit(1);
    });
`;

// Each text as the viewer's Markdown lays it out, as HTML.
function renderWithReactMarkdown(texts: Array<string>): Array<string> {
  return JSON.parse(
    childProcess.execFileSync(process.execPath, ["-e", RENDER_SCRIPT], {
      cwd: COMMON_ROOT,
      env: { ...process.env, MARKDOWN_TEXTS: JSON.stringify(texts) },
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as Array<string>;
}

const asElement: (html: string) => HTMLElement = (
  html: string,
): HTMLElement => {
  const frame: HTMLElement = document.createElement("div");
  frame.innerHTML = html;

  return frame;
};

// Every block of a laid-out text, with the way it reads.
const blocksOf: (
  frame: HTMLElement,
) => Array<{ tag: string; dir: string | null; text: string }> = (
  frame: HTMLElement,
): Array<{ tag: string; dir: string | null; text: string }> => {
  return Array.from(frame.children).map((block: Element) => {
    return {
      tag: block.tagName.toLowerCase(),
      dir: block.getAttribute("dir"),
      text: withoutIsolateMarks(block.textContent || "").trim(),
    };
  });
};

// The block whose words start with `start`.
const blockStarting: (frame: HTMLElement, start: string) => Element = (
  frame: HTMLElement,
  start: string,
): Element => {
  const block: Element | undefined = Array.from(frame.children).find(
    (candidate: Element): boolean => {
      return withoutIsolateMarks(candidate.textContent || "")
        .trim()
        .startsWith(start);
    },
  );

  if (!block) {
    throw new Error(`No block starting "${start}"`);
  }

  return block;
};

const WORDED: Record<string, string> = {};
const LAID_OUT: Record<string, HTMLElement> = {};

const CASES: Record<string, string> = {
  en: word(ROOT_CAUSE, "en"),
  de: word(ROOT_CAUSE, "de"),
  ar: word(ROOT_CAUSE, "ar"),
  fa: word(ROOT_CAUSE, "fa"),
  // The same Persian page, its values not set apart: the line as it was laid out.
  "fa, values not set apart": word(ROOT_CAUSE, "fa", false),
  "fa, typed": word(TYPED_ROOT_CAUSE, "fa"),
  "fa, typed after the monitor's": word(
    `${ROOT_CAUSE}\n\n${TYPED_ROOT_CAUSE}`,
    "fa",
  ),
  "en, stored": ROOT_CAUSE,
};

beforeAll(() => {
  const names: Array<string> = Object.keys(CASES);
  const html: Array<string> = renderWithReactMarkdown(
    names.map((name: string): string => {
      return CASES[name]!;
    }),
  );

  names.forEach((name: string, index: number) => {
    WORDED[name] = CASES[name]!;
    LAID_OUT[name] = asElement(html[index]!);
  });
});

describe.each(["fa", "ar"] as Array<Language>)(
  "a monitor's root cause on a page in %s",
  (language: Language) => {
    const words: () => Record<string, string> = (): Record<string, string> => {
      return readDashboardLocale(language);
    };

    test("every line and every list reads from the right, as the page does", () => {
      const blocks: Array<{ tag: string; dir: string | null }> = blocksOf(
        LAID_OUT[language]!,
      );

      expect(blocks.length).toBeGreaterThanOrEqual(10);
      expect(
        blocks.filter((block: { dir: string | null }): boolean => {
          return block.dir !== "rtl";
        }),
      ).toEqual([]);
      expect(
        blocks.filter((block: { tag: string }): boolean => {
          return block.tag === "ul";
        }),
      ).toHaveLength(3);
      // So does the viewer's frame.
      expect(getShownMarkdownReadingDirection(WORDED[language])).toBe("rtl");
    });

    test("each list item reads beside its bullet, none turned the other way", () => {
      expect(LAID_OUT[language]!.querySelectorAll("li")).toHaveLength(8);
      expect(LAID_OUT[language]!.querySelectorAll("bdi")).toHaveLength(0);
    });

    test("the English values sit whole in isolates after their labels", () => {
      const criteria: Element = blockStarting(
        LAID_OUT[language]!,
        words()["Criteria Name"]!,
      );

      expect(criteria.textContent).toBe(
        `${words()["Criteria Name"]}: ${isolated("Website is down")}`,
      );
      expect(LAID_OUT[language]!.textContent).toContain(
        `${words()["Error Code"]}: ${isolated("ECONNREFUSED")}`,
      );
      expect(LAID_OUT[language]!.textContent).toContain(
        `${words()["Raw Error Message"]}: ${isolated(RAW_ERROR)}`,
      );
    });

    test("what OneUptime wrote reads in the reader's language", () => {
      const text: string = LAID_OUT[language]!.textContent || "";

      expect(text).toContain(words()[CONNECTION_REFUSED]!);
      expect(text).not.toContain("Connection refused.");
      expect(text).not.toContain("Criteria Name");
    });

    test("the address checked is still a link to it, its isolate's marks left out", () => {
      const link: HTMLAnchorElement | null =
        LAID_OUT[language]!.querySelector("a");

      expect(link?.getAttribute("href")).toBe(URL_CHECKED);
    });
  },
);

describe("the same Persian page, before the values were set apart", () => {
  test("negative control: the criteria's line and the address list read from the left", () => {
    const words: Record<string, string> = readDashboardLocale("fa");
    const laidOut: HTMLElement = LAID_OUT["fa, values not set apart"]!;

    expect(
      blockStarting(laidOut, words["Criteria Name"]!).getAttribute("dir"),
    ).toBe("ltr");
    expect(
      blocksOf(laidOut).some((block: { dir: string | null }): boolean => {
        return block.dir === "ltr";
      }),
    ).toBe(true);
  });
});

describe("in English and German", () => {
  test("in English: the root cause as stored, laid out as before", () => {
    expect(WORDED["en"]).toBe(ROOT_CAUSE);
    expect(LAID_OUT["en"]!.innerHTML).toBe(LAID_OUT["en, stored"]!.innerHTML);
    expect(
      blocksOf(LAID_OUT["en"]!).every((block: { dir: string | null }) => {
        return block.dir === "ltr";
      }),
    ).toBe(true);
  });

  test("in German: every line left to right, no isolate's marks", () => {
    expect(WORDED["de"]).toBe(withoutIsolateMarks(WORDED["de"]!));
    expect(
      blocksOf(LAID_OUT["de"]!).every((block: { dir: string | null }) => {
        return block.dir === "ltr";
      }),
    ).toBe(true);
  });
});

describe("a root cause somebody typed", () => {
  test("in English on a Persian page: as typed, left to right", () => {
    expect(WORDED["fa, typed"]).toBe(TYPED_ROOT_CAUSE);
    expect(
      blocksOf(LAID_OUT["fa, typed"]!).map((block: { dir: string | null }) => {
        return block.dir;
      }),
    ).toEqual(["ltr", "ltr"]);
    expect(getShownMarkdownReadingDirection(TYPED_ROOT_CAUSE)).toBe("ltr");
  });

  test("added after the monitor's: its words left to right, the monitor's lines from the right", () => {
    const laidOut: HTMLElement = LAID_OUT["fa, typed after the monitor's"]!;
    const blocks: Array<{ tag: string; dir: string | null; text: string }> =
      blocksOf(laidOut);

    expect(
      blocks.slice(-2).map((block: { dir: string | null }): string | null => {
        return block.dir;
      }),
    ).toEqual(["ltr", "ltr"]);
    expect(
      blocks.slice(0, -2).every((block: { dir: string | null }): boolean => {
        return block.dir === "rtl";
      }),
    ).toBe(true);
  });
});

/*
 * The Root Cause page draws the root cause through MonitorRootCauseValue,
 * which hands the viewer the worded text with its values set apart.
 */
describe("the Root Cause page", () => {
  const instances: Partial<Record<Language, i18n>> = {};

  beforeAll(async () => {
    for (const language of ["en", "de", "fa"] as Array<Language>) {
      const instance: i18n = createInstance();
      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          [language]: { translation: readDashboardLocale(language) },
        },
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

  const renderIn: (language: Language) => Promise<RenderResult> = async (
    language: Language,
  ): Promise<RenderResult> => {
    const view: RenderResult = render(
      <I18nextProvider i18n={instances[language]!}>
        <MonitorRootCauseValue
          rootCause={ROOT_CAUSE}
          placeholder="No root cause identified for this incident."
        />
      </I18nextProvider>,
    );

    await screen.findByTestId("react-markdown");

    return view;
  };

  test("in Persian: the viewer is handed the values set apart, and reads from the right", async () => {
    const view: RenderResult = await renderIn("fa");
    const frame: Element = view.getByTestId("react-markdown").parentElement!;

    expect(frame).toHaveAttribute("dir", "rtl");
    expect(view.getByTestId("react-markdown").textContent).toBe(WORDED["fa"]);
  });

  test("in German: the worded root cause, no isolate's marks", async () => {
    const view: RenderResult = await renderIn("de");

    expect(view.getByTestId("react-markdown").textContent).toBe(WORDED["de"]);
  });

  test("in English: as stored", async () => {
    const view: RenderResult = await renderIn("en");

    expect(view.getByTestId("react-markdown").textContent).toBe(ROOT_CAUSE);
  });
});
