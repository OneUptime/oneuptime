import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as PublicDashboardLayout from "../../FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewLayout";
import {
  MASTER_PASSWORD_COPY,
  MASTER_PASSWORD_PROMPT_TEST_ID,
  MASTER_PASSWORD_TITLE_TEST_ID,
} from "../../FeatureSet/PublicDashboard/src/Pages/MasterPassword/MasterPasswordCopy";

/*
 * A public dashboard on a phone (the #5106 / #5116 follow-up, and #5284's).
 *
 * The page was 1000px wide as a whole (a minWidth on its outer box), so on a
 * phone the toolbar - auto-refresh, theme, full screen - sat past the right
 * edge until the visitor scrolled. #5284 kept the board's 1000px in a frame
 * of its own that scrolled sideways below 1080px, so a phone showed half of
 * each row of widgets. Now nothing keeps a width of its own: the board lays
 * its widgets out in the screen's width - the shared canvas and
 * Common/Utils/Dashboard/DashboardBoardLayout, on a phone one under
 * another. The browser suite (packages/E2E/PublicDashboardTheme, "the page
 * at a phone's width") measures it; this holds the source to it.
 */

const VIEW_PAGE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "PublicDashboard",
  "src",
  "Pages",
  "DashboardView",
  "DashboardViewPage.tsx",
);

const PROMPT_PAGE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "PublicDashboard",
  "src",
  "Pages",
  "MasterPassword",
  "MasterPassword.tsx",
);

/*
 * Each block comment, from its opener to the next closer, as one space -
 * read with indexOf, one pass over the code, where a pattern looking for the
 * end of every opener would take time growing with the square of the file.
 */
const withoutBlockComments: (code: string) => string = (
  code: string,
): string => {
  const parts: Array<string> = [];
  let at: number = 0;
  let open: number = code.indexOf("/*");

  while (open >= 0) {
    const close: number = code.indexOf("*/", open + 2);

    if (close < 0) {
      break;
    }

    parts.push(code.slice(at, open));
    at = close + 2;
    open = code.indexOf("/*", at);
  }

  parts.push(code.slice(at));

  return parts.join(" ");
};

// Without its comments, collapsed to one line.
const readSource: (file: string) => string = (file: string): string => {
  return withoutBlockComments(fs.readFileSync(file, "utf8"))
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
};

describe("a public dashboard's page on a phone", () => {
  const source: string = readSource(VIEW_PAGE);

  test("nothing on the page keeps a width of its own: the board lays its widgets out in the screen's", () => {
    // The page's old minWidth, and the board's own after it, gone.
    expect(source).not.toContain("minWidth");
    expect(source).not.toContain("min-w-[");
    expect(source).toContain(
      "<div ref={boardRef} data-testid={PUBLIC_DASHBOARD_BOARD_TEST_ID}>",
    );
    // So is the width it kept, for anyone who still reads it.
    expect(Object.keys(PublicDashboardLayout).sort()).toEqual([
      "PUBLIC_DASHBOARD_BOARD_TEST_ID",
      "PUBLIC_DASHBOARD_FRAME_TEST_ID",
      "PUBLIC_DASHBOARD_HEADER_TEST_ID",
      "PUBLIC_DASHBOARD_PAGE_TEST_ID",
      "PUBLIC_DASHBOARD_TOOLBAR_TEST_ID",
    ]);
  });

  test("the board's frame never scrolls sideways: it is only the box Full Screen shows", () => {
    expect(source).toContain('className="mt-3"');
    expect(source).not.toContain("overflow-x");
  });

  test("Full Screen shows the frame, the widgets are laid out in the board's own width", () => {
    // The frame is the canvas ref Full Screen asks for.
    expect(source).toContain("ref={dashboardCanvasRef}");
    expect(source).toContain("ref={boardRef}");
    expect(source).toContain(
      "setDashboardTotalWidth(boardRef.current?.offsetWidth || 0)",
    );
    expect(source).not.toContain("dashboardViewRef");
  });

  /*
   * The title keeps 18rem beside the toolbar or takes the row: beside the
   * toolbar on a phone (10rem), "Acme Production" read "Acme Prod...".
   */
  test("the title and the toolbar share a row while the title keeps room to be read; on a phone the toolbar moves under it", () => {
    expect(source).toContain(
      '<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">',
    );
    expect(source).toContain(
      '<div className="flex min-w-0 flex-1 basis-72 items-center gap-3 sm:gap-4">',
    );
    expect(source).not.toContain("basis-40");
    expect(source).toContain(
      'className="ml-auto flex items-center gap-2 flex-shrink-0"',
    );
  });

  test("a long name takes two lines on a phone and one beside the toolbar, never cut to a word", () => {
    expect(source).toContain(
      '<h1 className="line-clamp-2 break-words text-lg font-semibold text-gray-900 sm:line-clamp-1">',
    );
    expect(source).not.toContain(
      '<h1 className="text-lg font-semibold text-gray-900 truncate">',
    );
  });

  test("the rule between the time range and the variables is not left hanging when they wrap on a phone", () => {
    expect(source).toContain(
      '<div className="w-px h-5 bg-gray-200 max-sm:hidden"></div>',
    );
  });
});

describe("a public dashboard's password prompt", () => {
  const source: string = readSource(PROMPT_PAGE);

  test("names the dashboard once, and says what to do once", () => {
    expect(source).toContain(
      "{props.dashboardName || MASTER_PASSWORD_COPY.fallbackTitle}",
    );
    expect(source).toContain("{MASTER_PASSWORD_COPY.prompt}");
    expect(source).toContain(`data-testid={MASTER_PASSWORD_TITLE_TEST_ID}`);
    expect(source).toContain(`data-testid={MASTER_PASSWORD_PROMPT_TEST_ID}`);
    expect(MASTER_PASSWORD_TITLE_TEST_ID).not.toBe(
      MASTER_PASSWORD_PROMPT_TEST_ID,
    );
  });

  test("the field is named by its label alone: no description, no placeholder", () => {
    expect(source).toContain("title: MASTER_PASSWORD_COPY.passwordLabel,");
    expect(source).not.toContain("Enter the password to unlock");
    expect(source).not.toContain('placeholder: "Enter password"');
    expect(source).not.toMatch(/description: "Enter/);
    expect(MASTER_PASSWORD_COPY.prompt).toBe(
      "Enter the password to view this dashboard.",
    );
  });
});
