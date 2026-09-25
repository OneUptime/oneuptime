import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import * as React from "react";
import { JSONObject } from "../../../Types/JSON";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import IconProp from "../../../Types/Icon/IconProp";
import {
  ClassCandidate,
  collapseWhitespace,
  collectClassCandidates,
  describeCandidate,
} from "../../ClassStrings";
import {
  isSrOnlyUnhidingToken,
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../../ForeignHiddenRuleGuard";
import {
  NON_WIDTH_MEDIA_VARIANTS,
  PHONE_WIDTH_IN_PX,
  ScreenReaderOnlyOptions,
  TAILWIND_BREAKPOINTS_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
  isVisuallyCollapsed,
  splitVariants,
} from "../../ResponsiveVisibility";

/*
 * The foreign `.hidden` rule has a sibling. Bootstrap 3 and HTML5
 * Boilerplate - the same two stylesheets that ship
 * `.hidden{display:none !important}` - also ship `.sr-only`, the
 * visually-hidden pattern, and a browser that carries one carries the other.
 * Appended after Tailwind's <style>, the foreign `.sr-only` has the same
 * specificity as `.sm\:not-sr-only` and comes later, so it wins: a label
 * written `sr-only sm:not-sr-only` - visible from sm up, read-only to screen
 * readers below it - collapses to a 1px clip at every width. That is how the
 * screenshot dock's "Copy image" and "Download", the Send Test badges, the
 * session replay's collapsible action labels and the feed's "Filter & Sort"
 * would have become icon-only on a wide screen. The fix wrote them
 * `max-sm:sr-only sm:not-sr-only` (max-xl for the feed), which behaves the
 * same everywhere and never carries the class the foreign rule targets.
 *
 * Skip links keep `sr-only focus:not-sr-only` on purpose. They must be
 * hidden at EVERY width until focused, so a max-width form would be wrong,
 * and they do not need one: `.focus\:not-sr-only:focus` is a class plus a
 * pseudo-class, (0,2,0), and beats an appended `.sr-only`, (0,1,0), whatever
 * the order. Unfocused, the foreign rule and Tailwind agree the link is
 * hidden. The one case that would still break them - a foreign `.sr-only`
 * marked !important - is not what either library ships (their `.hidden` is
 * !important; their `.sr-only` is not), and the resolver's own tests pin
 * that boundary.
 *
 * jsdom has no layout and no stylesheet, so "is this label collapsed at
 * 1917px?" is answered by the sr-only resolver in ResponsiveVisibility.ts
 * (isVisuallyCollapsed, beside resolveDisplay), which has its own unit tests
 * in ResponsiveVisibility.test.ts. The labels are read from the real
 * components where rendering them is cheap; the status page's skip link and
 * the static sites' skip links are read from source. A sweep of every browser
 * module and every EJS view then checks that no class string anywhere lets
 * the foreign rule change what is on screen - and a last test holds that
 * sweep and ForeignHiddenRuleGuard to the same answer.
 */

/* ------------------------------------------------------------------------ */
/* The resolver, across widths                                              */
/* ------------------------------------------------------------------------ */

const MAX_WIDTH_SR_ONLY_CLASS: RegExp = /^max-(sm|md|lg|xl|2xl):sr-only$/;

// `min-[900px]:` / `max-[900px]:` inside a class token: an arbitrary screen.
const ARBITRARY_PIXEL_SCREEN: RegExp = /\b(?:min|max)-\[(\d+(?:\.\d+)?)px\]:/g;

function tokensOf(classText: string | null | undefined): Array<string> {
  return (classText || "").split(/\s+/).filter(Boolean);
}

// Every breakpoint and the pixel below it, plus a phone and a wide desktop.
const CHECK_WIDTHS_IN_PX: Array<number> = Array.from(
  new Set<number>([
    PHONE_WIDTH_IN_PX,
    ...Object.values(TAILWIND_BREAKPOINTS_IN_PX).flatMap(
      (breakpointInPx: number): Array<number> => {
        return [breakpointInPx - 1, breakpointInPx];
      },
    ),
    WIDE_DESKTOP_WIDTH_IN_PX,
  ]),
).sort((first: number, second: number): number => {
  return first - second;
});

/*
 * "375px collapsed, 639px collapsed, 640px shown, ..." - a failure then
 * reads as the widths that went wrong.
 */
function describeCollapse(
  classAttribute: string | null | undefined,
  options?: ScreenReaderOnlyOptions,
): string {
  return CHECK_WIDTHS_IN_PX.map((widthInPx: number): string => {
    return `${widthInPx}px ${
      isVisuallyCollapsed(classAttribute, widthInPx, options)
        ? "collapsed"
        : "shown"
    }`;
  }).join(", ");
}

function collapsedBelow(breakpoint: string): string {
  const breakpointInPx: number = TAILWIND_BREAKPOINTS_IN_PX[breakpoint]!;

  return CHECK_WIDTHS_IN_PX.map((widthInPx: number): string => {
    return `${widthInPx}px ${widthInPx < breakpointInPx ? "collapsed" : "shown"}`;
  }).join(", ");
}

function collapsedEverywhere(): string {
  return CHECK_WIDTHS_IN_PX.map((widthInPx: number): string => {
    return `${widthInPx}px collapsed`;
  }).join(", ");
}

function shownEverywhere(): string {
  return CHECK_WIDTHS_IN_PX.map((widthInPx: number): string => {
    return `${widthInPx}px shown`;
  }).join(", ");
}

/*
 * The media conditions worth resolving a class under: none (a screen with
 * default preferences), then every combination of the non-width media
 * variants it names, so `print:not-sr-only` is also resolved as it prints.
 */
function mediaEnvironmentsFor(classAttribute: string): Array<Array<string>> {
  const named: Array<string> = NON_WIDTH_MEDIA_VARIANTS.filter(
    (variant: string): boolean => {
      return tokensOf(classAttribute).some((token: string): boolean => {
        return splitVariants(token).slice(0, -1).includes(variant);
      });
    },
  );
  let environments: Array<Array<string>> = [[]];

  for (const variant of named) {
    environments = environments.flatMap(
      (environment: Array<string>): Array<Array<string>> => {
        return [environment, [...environment, variant]];
      },
    );
  }

  return environments;
}

// The checked widths, plus both sides of any arbitrary screen the class names.
function widthsFor(classAttribute: string): Array<number> {
  const widths: Set<number> = new Set<number>(CHECK_WIDTHS_IN_PX);

  for (const screen of classAttribute.matchAll(ARBITRARY_PIXEL_SCREEN)) {
    const widthInPx: number = parseFloat(screen[1]!);
    widths.add(widthInPx - 1);
    widths.add(widthInPx);
  }

  return Array.from(widths);
}

/*
 * Whether a foreign `.sr-only` changes what is on screen for this class at
 * any width where its screens change, focused or not, under any media
 * condition it names.
 */
function isForeignSrOnlyHazard(classAttribute: string): boolean {
  const widths: Array<number> = widthsFor(classAttribute);

  return mediaEnvironmentsFor(classAttribute).some(
    (mediaConditions: Array<string>): boolean => {
      return [false, true].some((isFocused: boolean): boolean => {
        const clean: ScreenReaderOnlyOptions = {
          isFocused: isFocused,
          mediaConditions: mediaConditions,
        };

        return widths.some((widthInPx: number): boolean => {
          return (
            isVisuallyCollapsed(classAttribute, widthInPx, {
              ...clean,
              withForeignSrOnlyRule: true,
            }) !== isVisuallyCollapsed(classAttribute, widthInPx, clean)
          );
        });
      });
    },
  );
}

/*
 * Put the pre-fix idiom back: every `max-<bp>:sr-only` becomes the bare
 * `sr-only` it replaced. Nothing used a max-width sr-only before the fix,
 * so this rebuilds the old class exactly.
 */
function restorePreFixSrOnly(classText: string | null): string {
  return tokensOf(classText)
    .map((token: string): string => {
      return MAX_WIDTH_SR_ONLY_CLASS.test(token) ? "sr-only" : token;
    })
    .join(" ");
}

/* ------------------------------------------------------------------------ */
/* Component seams                                                          */
/* ------------------------------------------------------------------------ */

/*
 * SendTestNotificationButton posts through API and reads its headers from
 * ModelAPI; both are stood in for the same way its own suite does, with the
 * answer decided per test.
 */
type PostResult = HTTPResponse<JSONObject> | HTTPErrorResponse;

let apiPost: () => Promise<PostResult> = async (): Promise<PostResult> => {
  return new HTTPResponse<JSONObject>(200, {}, {});
};

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (): Promise<PostResult> => {
        return apiPost();
      },
      getFriendlyErrorMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : "Request failed.";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-under-test" };
      },
    },
  };
});

import { DEFAULT_FEED_OPTIONS } from "../../../UI/Components/Feed/FeedOptions";
import FeedOptionsButton from "../../../UI/Components/Feed/FeedOptionsButton";
import MasterPage from "../../../UI/Components/MasterPage/MasterPage";
import { ReplayToolButton } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi";
import ReplayScreenshotActions from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshotActions";
import { ReplayScreenshot } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshot";
import SendTestNotificationButton from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/SendTestNotificationButton";

function noop(): void {
  /* Handlers the assertions do not care about. */
}

/*
 * The one element whose own text is exactly the label: the <span>, not the
 * button around it that shares the text.
 */
function getLabelElement(container: HTMLElement, text: string): HTMLElement {
  const matches: Array<HTMLElement> = Array.from(
    container.querySelectorAll<HTMLElement>("*"),
  ).filter((element: HTMLElement): boolean => {
    return (
      element.textContent === text &&
      Array.from(element.children).every((child: Element): boolean => {
        return child.textContent !== text;
      })
    );
  });

  expect(matches).toHaveLength(1);
  return matches[0]!;
}

function renderScreenshotDock(): void {
  render(
    <ReplayScreenshotActions
      onCapture={(): Promise<ReplayScreenshot> => {
        return Promise.resolve({
          blob: new Blob(["png-bytes"], { type: "image/png" }),
          fileName: "session-replay-frame.png",
          width: 1440,
          height: 900,
        });
      }}
      copyToClipboard={async (): Promise<void> => {
        /* The dock is only rendered, never clicked. */
      }}
      download={noop}
      clipboardSupport="supported"
      fit="contain"
      frameKey="1:41200"
    />,
  );
}

async function renderSendTestOutcome(
  outcome: "sent" | "failed",
): Promise<HTMLElement> {
  if (outcome === "failed") {
    apiPost = async (): Promise<PostResult> => {
      return new HTTPErrorResponse(400, { message: "Channel not found." }, {});
    };
  }

  render(
    <SendTestNotificationButton
      route="/slack/channels/test"
      requestBody={{ channelId: "C0123ALERTS" }}
      destinationName="#alerts"
      workspaceName="Slack"
    />,
  );

  await act(async (): Promise<void> => {
    fireEvent.click(
      screen.getByRole("button", {
        name: "Send test notification to #alerts",
      }),
    );
  });

  const testId: string = `send-test-notification-${outcome}`;

  await waitFor(() => {
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  return getLabelElement(
    screen.getByTestId(testId),
    outcome === "sent" ? "Sent" : "Failed",
  );
}

interface CollapsibleLabelCase {
  name: string;
  // Drawn from this breakpoint up; read to screen readers only below it.
  breakpoint: string;
  // The class this label carried before the fix (git 9bda7b343d).
  preFixClass: string;
  renderLabel: () => Promise<HTMLElement>;
}

const COLLAPSIBLE_LABELS: Array<CollapsibleLabelCase> = [
  {
    name: 'FeedOptionsButton "Filter & Sort"',
    breakpoint: "xl",
    preFixClass: "sr-only xl:not-sr-only",
    renderLabel: async (): Promise<HTMLElement> => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={[]}
          onChange={noop}
        />,
      );

      return screen.getByTestId("feed-options-label");
    },
  },
  {
    name: "ReplayToolButton collapsible action label",
    breakpoint: "sm",
    preFixClass: "sr-only sm:not-sr-only",
    renderLabel: async (): Promise<HTMLElement> => {
      render(
        <ReplayToolButton
          label="Details"
          icon={IconProp.Info}
          collapseLabelOnSmallScreens={true}
          onClick={noop}
        />,
      );

      return getLabelElement(
        screen.getByRole("button", { name: "Details" }),
        "Details",
      );
    },
  },
  {
    name: 'ReplayScreenshotActions "Copy image"',
    breakpoint: "sm",
    preFixClass: "sr-only sm:not-sr-only",
    renderLabel: async (): Promise<HTMLElement> => {
      renderScreenshotDock();

      return getLabelElement(
        screen.getByTestId("replay-screenshot-copy"),
        "Copy image",
      );
    },
  },
  {
    name: 'ReplayScreenshotActions "Download"',
    breakpoint: "sm",
    preFixClass: "sr-only sm:not-sr-only",
    renderLabel: async (): Promise<HTMLElement> => {
      renderScreenshotDock();

      return getLabelElement(
        screen.getByTestId("replay-screenshot-download"),
        "Download",
      );
    },
  },
  {
    name: 'SendTestNotificationButton "Sent" badge',
    breakpoint: "sm",
    preFixClass: "sr-only sm:not-sr-only",
    renderLabel: async (): Promise<HTMLElement> => {
      return renderSendTestOutcome("sent");
    },
  },
  {
    name: 'SendTestNotificationButton "Failed" badge',
    breakpoint: "sm",
    preFixClass: "sr-only sm:not-sr-only",
    renderLabel: async (): Promise<HTMLElement> => {
      return renderSendTestOutcome("failed");
    },
  },
];

/*
 * The contract for a label that is drawn from `breakpoint` up: the
 * max-width form, never the bare class, and - by the resolver - collapsed
 * below the breakpoint and on screen from it, identically with and without
 * a foreign `.sr-only` on the page.
 */
function expectCollapsedOnlyBelow(element: Element, breakpoint: string): void {
  const classAttribute: string = element.getAttribute("class") || "";
  const tokens: Array<string> = tokensOf(classAttribute);

  expect(tokens).toContain(`max-${breakpoint}:sr-only`);
  expect(tokens).toContain(`${breakpoint}:not-sr-only`);
  expect(tokens).not.toContain("sr-only");

  expect(describeCollapse(classAttribute)).toBe(collapsedBelow(breakpoint));
  expect(
    describeCollapse(classAttribute, { withForeignSrOnlyRule: true }),
  ).toBe(collapsedBelow(breakpoint));
}

/* ------------------------------------------------------------------------ */
/* Source                                                                   */
/* ------------------------------------------------------------------------ */

// packages/Common/Tests/UI/Components -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

// The static sites render EJS views, which the TypeScript walk never reads.
const EJS_VIEW_ROOTS: Array<string> = [
  path.join(REPOSITORY_ROOT, "packages", "Home", "Views"),
  path.join(REPOSITORY_ROOT, "packages", "App", "FeatureSet", "Docs", "Views"),
  path.join(
    REPOSITORY_ROOT,
    "packages",
    "App",
    "FeatureSet",
    "APIReference",
    "views",
  ),
];

const COMMON_MASTER_PAGE_FILE: string =
  "packages/Common/UI/Components/MasterPage/MasterPage.tsx";
const STATUS_PAGE_MASTER_PAGE_FILE: string =
  "packages/App/FeatureSet/StatusPage/src/Components/MasterPage/MasterPage.tsx";
const HOME_NAV_VIEW_FILE: string = "packages/Home/Views/nav.ejs";
const API_REFERENCE_INDEX_VIEW_FILE: string =
  "packages/App/FeatureSet/APIReference/views/pages/index.ejs";

const SKIP_LINK_FILES: Array<string> = [
  COMMON_MASTER_PAGE_FILE,
  STATUS_PAGE_MASTER_PAGE_FILE,
  HOME_NAV_VIEW_FILE,
  API_REFERENCE_INDEX_VIEW_FILE,
];

// The modules whose labels the fix converted.
const CONVERTED_LABEL_FILES: Array<string> = [
  "packages/Common/UI/Components/Feed/FeedOptionsButton.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshotActions.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/Workspace/SendTestNotificationButton.tsx",
];

/*
 * The static class attributes of an EJS view. Everything inside <% %> is
 * blanked first (newlines kept, so line numbers hold): only the text the
 * browser receives verbatim is read.
 */
function collectViewCandidates(
  relativePath: string,
  viewText: string,
): Array<ClassCandidate> {
  const staticText: string = viewText.replace(
    /<%[\s\S]*?%>/g,
    (tag: string): string => {
      return tag.replace(/[^\n]/g, " ");
    },
  );
  const candidates: Array<ClassCandidate> = [];

  for (const match of staticText.matchAll(
    /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
  )) {
    candidates.push({
      file: relativePath,
      line: staticText.slice(0, match.index).split("\n").length,
      classText: collapseWhitespace(match[1] ?? match[2] ?? ""),
    });
  }

  return candidates;
}

function listViewFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...listViewFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ejs")) {
      found.push(fullPath);
    }
  }

  return found;
}

interface SrOnlySweep {
  // Every class string that mentions sr-only, TypeScript and EJS alike.
  candidates: Array<ClassCandidate>;
  filesRead: number;
}

function sweepSrOnlyClassStrings(): SrOnlySweep {
  const candidates: Array<ClassCandidate> = [];
  let filesRead: number = 0;

  const read: (
    filePath: string,
    collect: (relativePath: string, text: string) => Array<ClassCandidate>,
  ) => void = (
    filePath: string,
    collect: (relativePath: string, text: string) => Array<ClassCandidate>,
  ): void => {
    filesRead++;
    const text: string = fs.readFileSync(filePath, "utf8");

    if (!text.includes("sr-only")) {
      return;
    }

    for (const candidate of collect(
      toRelativePath(REPOSITORY_ROOT, filePath),
      text,
    )) {
      if (candidate.classText.includes("sr-only")) {
        candidates.push(candidate);
      }
    }
  };

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const filePath of listSourceFiles(root)) {
      read(filePath, collectClassCandidates);
    }
  }

  for (const root of EJS_VIEW_ROOTS) {
    for (const filePath of listViewFiles(root)) {
      read(filePath, collectViewCandidates);
    }
  }

  return { candidates: candidates, filesRead: filesRead };
}

let sweep: SrOnlySweep = { candidates: [], filesRead: 0 };

/*
 * Parsing ~3,300 files takes seconds. Doing it in beforeAll rather than at
 * module scope keeps it under a timeout and reports a failure as a failed
 * test instead of a suite that could not even be collected.
 */
beforeAll(() => {
  sweep = sweepSrOnlyClassStrings();
}, 180000);

function skipLinkClassIn(file: string): ClassCandidate {
  const skipLinks: Array<ClassCandidate> = sweep.candidates.filter(
    (candidate: ClassCandidate): boolean => {
      return (
        candidate.file === file &&
        tokensOf(candidate.classText).includes("focus:not-sr-only")
      );
    },
  );

  expect({ file: file, skipLinks: skipLinks.length }).toEqual({
    file: file,
    skipLinks: 1,
  });

  return skipLinks[0]!;
}

/*
 * The contract for a skip link: collapsed at every width until focused and
 * on screen at every width once focused - with a foreign `.sr-only` on the
 * page as much as without one.
 */
function expectSkipLinkContract(classAttribute: string): void {
  const tokens: Array<string> = tokensOf(classAttribute);

  expect(tokens).toContain("sr-only");
  expect(tokens).toContain("focus:not-sr-only");

  for (const withForeignSrOnlyRule of [false, true]) {
    expect(
      describeCollapse(classAttribute, {
        withForeignSrOnlyRule: withForeignSrOnlyRule,
      }),
    ).toBe(collapsedEverywhere());
    expect(
      describeCollapse(classAttribute, {
        withForeignSrOnlyRule: withForeignSrOnlyRule,
        isFocused: true,
      }),
    ).toBe(shownEverywhere());
  }
}

/* ------------------------------------------------------------------------ */

beforeEach(() => {
  apiPost = async (): Promise<PostResult> => {
    return new HTTPResponse<JSONObject>(200, {}, {});
  };
});

/*
 * The resolver itself is unit-tested beside it, in ResponsiveVisibility.test.ts.
 * These cover what this file builds on top of it for the sweep.
 */
describe("sweep helpers", () => {
  test("isForeignSrOnlyHazard flags exactly the shapes the foreign rule changes", () => {
    expect(isForeignSrOnlyHazard("sr-only sm:not-sr-only")).toBe(true);
    expect(isForeignSrOnlyHazard("sr-only xl:not-sr-only")).toBe(true);
    expect(isForeignSrOnlyHazard("sr-only max-md:not-sr-only")).toBe(true);
    expect(isForeignSrOnlyHazard("max-sm:sr-only sm:not-sr-only")).toBe(false);
    expect(isForeignSrOnlyHazard("sr-only")).toBe(false);
    expect(isForeignSrOnlyHazard("sr-only focus:not-sr-only")).toBe(false);
    expect(isForeignSrOnlyHazard("sr-only group-hover:not-sr-only")).toBe(
      false,
    );
  });

  test("isForeignSrOnlyHazard resolves the media conditions and arbitrary screens a class names", () => {
    // Only while printing, and only between screens no named breakpoint marks.
    expect(isForeignSrOnlyHazard("sr-only print:not-sr-only")).toBe(true);
    expect(isForeignSrOnlyHazard("sr-only md:print:not-sr-only")).toBe(true);
    expect(isForeignSrOnlyHazard("sr-only min-[3000px]:not-sr-only")).toBe(
      true,
    );
    expect(isForeignSrOnlyHazard("sr-only max-[100px]:not-sr-only")).toBe(true);
    expect(mediaEnvironmentsFor("sr-only print:not-sr-only")).toEqual([
      [],
      ["print"],
    ]);
    expect(widthsFor("sr-only min-[900px]:not-sr-only")).toEqual(
      expect.arrayContaining([899, 900]),
    );
  });

  test("restorePreFixSrOnly rebuilds the pre-fix class", () => {
    expect(restorePreFixSrOnly("max-sm:sr-only sm:not-sr-only")).toBe(
      "sr-only sm:not-sr-only",
    );
    expect(restorePreFixSrOnly("max-xl:sr-only xl:not-sr-only")).toBe(
      "sr-only xl:not-sr-only",
    );
    expect(restorePreFixSrOnly("sr-only focus:not-sr-only")).toBe(
      "sr-only focus:not-sr-only",
    );
  });
});

describe("labels drawn from a breakpoint up survive a foreign .sr-only", () => {
  test.each(COLLAPSIBLE_LABELS)(
    "$name is collapsed only below $breakpoint",
    async (labelCase: CollapsibleLabelCase) => {
      const label: HTMLElement = await labelCase.renderLabel();

      expectCollapsedOnlyBelow(label, labelCase.breakpoint);
    },
  );

  /*
   * The same rendered label, its class put back to what it was before the
   * fix. The assertion above must fail on it: on a clean page the old class
   * looked right, and only the foreign rule collapsed it on a wide screen.
   */
  test.each(COLLAPSIBLE_LABELS)(
    "control: $name fails the same check with its pre-fix class",
    async (labelCase: CollapsibleLabelCase) => {
      const label: HTMLElement = await labelCase.renderLabel();
      const preFixClass: string = restorePreFixSrOnly(
        label.getAttribute("class"),
      );

      expect(preFixClass).toBe(labelCase.preFixClass);

      label.setAttribute("class", preFixClass);

      expect(() => {
        expectCollapsedOnlyBelow(label, labelCase.breakpoint);
      }).toThrow();
      expect(isVisuallyCollapsed(preFixClass, WIDE_DESKTOP_WIDTH_IN_PX)).toBe(
        false,
      );
      expect(
        isVisuallyCollapsed(preFixClass, WIDE_DESKTOP_WIDTH_IN_PX, {
          withForeignSrOnlyRule: true,
        }),
      ).toBe(true);
    },
  );
});

describe("skip links keep `sr-only focus:not-sr-only`", () => {
  test("the Common MasterPage skip link, rendered and focused", () => {
    render(
      <MasterPage isLoading={false} error="">
        <div>Children</div>
      </MasterPage>,
    );

    const skipLink: HTMLElement = screen.getByRole("link", {
      name: "Skip to main content",
    });
    const classAttribute: string = skipLink.getAttribute("class") || "";

    expectSkipLinkContract(classAttribute);

    // The focused half of the contract, on the real element.
    expect(
      isVisuallyCollapsed(classAttribute, WIDE_DESKTOP_WIDTH_IN_PX, {
        withForeignSrOnlyRule: true,
        isFocused: document.activeElement === skipLink,
      }),
    ).toBe(true);

    act(() => {
      skipLink.focus();
    });

    expect(document.activeElement).toBe(skipLink);
    expect(
      isVisuallyCollapsed(classAttribute, WIDE_DESKTOP_WIDTH_IN_PX, {
        withForeignSrOnlyRule: true,
        isFocused: document.activeElement === skipLink,
      }),
    ).toBe(false);
  });

  test.each(SKIP_LINK_FILES)("%s: the skip link in source", (file: string) => {
    expectSkipLinkContract(skipLinkClassIn(file).classText);
  });

  test("control: a skip link converted to the max-width form would show on wide screens", () => {
    /*
     * Why the codemod left them alone: `max-sm:sr-only` is right for a label
     * that belongs on screen from sm up, and wrong for a link that belongs
     * on screen only while focused.
     */
    expect(() => {
      expectSkipLinkContract("max-sm:sr-only sm:not-sr-only focus:not-sr-only");
    }).toThrow();
  });
});

describe("no class string anywhere lets a foreign .sr-only change the page", () => {
  test("the sweep read every tree and found the converted labels and the skip links", () => {
    // A broken walk must not let the main assertion pass over nothing.
    expect(sweep.filesRead).toBeGreaterThan(1000);

    const files: Set<string> = new Set<string>(
      sweep.candidates
        .filter((candidate: ClassCandidate): boolean => {
          return candidate.classText.includes("not-sr-only");
        })
        .map((candidate: ClassCandidate): string => {
          return candidate.file;
        }),
    );

    for (const file of [...CONVERTED_LABEL_FILES, ...SKIP_LINK_FILES]) {
      expect({ file: file, read: files.has(file) }).toEqual({
        file: file,
        read: true,
      });
    }
  });

  test("every converted module carries the max-width form and no bare sr-only undone by a screen", () => {
    for (const file of CONVERTED_LABEL_FILES) {
      const labels: Array<ClassCandidate> = sweep.candidates.filter(
        (candidate: ClassCandidate): boolean => {
          return (
            candidate.file === file &&
            tokensOf(candidate.classText).some((token: string): boolean => {
              return MAX_WIDTH_SR_ONLY_CLASS.test(token);
            })
          );
        },
      );

      expect({ file: file, hasMaxWidthLabel: labels.length > 0 }).toEqual({
        file: file,
        hasMaxWidthLabel: true,
      });
    }
  });

  test("the foreign rule changes nothing on screen, at any width, focused or not", () => {
    const hazards: Array<string> = sweep.candidates
      .filter((candidate: ClassCandidate): boolean => {
        return isForeignSrOnlyHazard(candidate.classText);
      })
      .map(describeCandidate);

    expect(hazards).toEqual([]);
  });

  test("control: the same sweep over the pre-fix class strings finds every converted label", () => {
    const hazardFiles: Set<string> = new Set<string>(
      sweep.candidates
        .filter((candidate: ClassCandidate): boolean => {
          return isForeignSrOnlyHazard(
            restorePreFixSrOnly(candidate.classText),
          );
        })
        .map((candidate: ClassCandidate): string => {
          return candidate.file;
        }),
    );

    expect(Array.from(hazardFiles).sort()).toEqual(
      [...CONVERTED_LABEL_FILES].sort(),
    );
  });

  test("the view reader sees static class text only", () => {
    const candidates: Array<string> = collectViewCandidates(
      "fixture.ejs",
      [
        '<a class="sr-only focus:not-sr-only">Skip</a>',
        "<span class='max-sm:sr-only sm:not-sr-only'>Label</span>",
        '<p class="<%= isOpen ? "sr-only sm:not-sr-only" : "" %> text-sm">x</p>',
      ].join("\n"),
    ).map((candidate: ClassCandidate): string => {
      return candidate.classText;
    });

    expect(candidates).toEqual([
      "sr-only focus:not-sr-only",
      "max-sm:sr-only sm:not-sr-only",
      "text-sm",
    ]);
  });

  test("the source reader joins a template's static text and its branches", () => {
    const candidates: Array<string> = collectClassCandidates(
      "Fixture.tsx",
      'const e = <span className={`sr-only ${wide ? "sm:not-sr-only" : ""}`} />;',
    ).map((candidate: ClassCandidate): string => {
      return candidate.classText;
    });

    expect(candidates).toContain("sr-only sm:not-sr-only");
    expect(isForeignSrOnlyHazard("sr-only sm:not-sr-only")).toBe(true);
  });

  test("the sweep and ForeignHiddenRuleGuard agree on which not-sr-only a foreign .sr-only beats", () => {
    /*
     * Two checks read the same hazard: the guard flags `sr-only
     * <variants>:not-sr-only` when every variant is a media query, and this
     * sweep calls a class a hazard when the resolver says the foreign rule
     * changes what is on screen. Both take "is a media query" from
     * isMediaQueryVariant in ResponsiveVisibility.ts, the source of truth, so
     * they must name the same variants - named screens and arbitrary ones,
     * the other media queries, stacks, and none of the state variants that
     * out-specify the foreign class.
     */
    const mediaQueries: Array<string> = [
      "sm",
      "md",
      "lg",
      "xl",
      "2xl",
      "max-sm",
      "max-md",
      "max-lg",
      "max-xl",
      "max-2xl",
      "min-[900px]",
      "max-[900px]",
      "print",
      "motion-safe",
      "motion-reduce",
      "contrast-more",
      "contrast-less",
      "portrait",
      "landscape",
      "forced-colors",
      "md:print",
      "sm:max-lg",
    ];
    const states: Array<string> = [
      "focus",
      "focus-visible",
      "focus-within",
      "hover",
      "group-hover",
      "group-focus",
      "peer-checked",
      "aria-expanded",
      "data-[state=open]",
      "dark",
      "[&.is-open]",
      "group-[.is-open]",
      "lg:group-hover",
      "sm:focus",
      "md:hover",
    ];

    const verdicts: Array<string> = [...mediaQueries, ...states].map(
      (variants: string): string => {
        return `${variants}: guard ${isSrOnlyUnhidingToken(`${variants}:not-sr-only`)}, sweep ${isForeignSrOnlyHazard(`sr-only ${variants}:not-sr-only`)}`;
      },
    );

    expect(verdicts).toEqual([
      ...mediaQueries.map((variants: string): string => {
        return `${variants}: guard true, sweep true`;
      }),
      ...states.map((variants: string): string => {
        return `${variants}: guard false, sweep false`;
      }),
    ]);
  });
});
