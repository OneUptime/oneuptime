import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  PUBLIC_DASHBOARD_BOARD_MIN_WIDTH_IN_PX,
  PUBLIC_DASHBOARD_FRAME_CLASS_NAME,
} from "../../FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewLayout";
import {
  MASTER_PASSWORD_COPY,
  MASTER_PASSWORD_PROMPT_TEST_ID,
  MASTER_PASSWORD_TITLE_TEST_ID,
} from "../../FeatureSet/PublicDashboard/src/Pages/MasterPassword/MasterPasswordCopy";

/*
 * A public dashboard on a phone (the #5106 / #5116 follow-up).
 *
 * The page was 1000px wide as a whole (a minWidth on its outer box), so on a
 * phone the toolbar - auto-refresh, theme, full screen - sat past the right
 * edge until the visitor scrolled, and the header and footer scrolled away
 * with the board. The board's twelve columns still need their 1000px, so
 * only the board keeps them, in a frame of its own that scrolls sideways
 * below 1080px; the page around it is the screen's width. The browser suite
 * (packages/E2E/PublicDashboardTheme, "the page at a phone's width")
 * measures it; this holds the source to it.
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

// Without its comments, collapsed to one line.
const readSource: (file: string) => string = (file: string): string => {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
};

describe("a public dashboard's page on a phone", () => {
  const source: string = readSource(VIEW_PAGE);

  test("the board keeps the width its grid is laid out for; nothing else does", () => {
    expect(PUBLIC_DASHBOARD_BOARD_MIN_WIDTH_IN_PX).toBe(1000);
    // The page's old minWidth, gone.
    expect(source).not.toContain('minWidth: "1000px"');
    expect(source.match(/minWidth:/g) || []).toHaveLength(1);
    expect(source).toContain(
      "style={{ minWidth: `${PUBLIC_DASHBOARD_BOARD_MIN_WIDTH_IN_PX}px` }}",
    );
  });

  test("the board's frame scrolls sideways only below the board's width and a scroll bar", () => {
    expect(PUBLIC_DASHBOARD_FRAME_CLASS_NAME).toBe(
      "max-[1079px]:overflow-x-auto",
    );
    expect(source).toContain(
      "className={`mt-3 ${PUBLIC_DASHBOARD_FRAME_CLASS_NAME}`}",
    );
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

  test("the title and the toolbar share a row while they fit, and the toolbar moves under the title when not", () => {
    expect(source).toContain(
      '<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">',
    );
    expect(source).toContain(
      '<div className="flex min-w-0 flex-1 basis-40 items-center gap-3 sm:gap-4">',
    );
    expect(source).toContain(
      'className="ml-auto flex items-center gap-2 flex-shrink-0"',
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
