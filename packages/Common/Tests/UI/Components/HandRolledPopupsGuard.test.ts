// UX rule: Docs/ux/README.md#one-control-for-one-job
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../../ForeignHiddenRuleGuard";

/*
 * A MENU, A LIST OR A PANEL THAT OPENS FROM A CONTROL IS DRAWN ON THE
 * TOOLTIP LAYER, NEVER IN PLACE.
 *
 * Drawn `absolute` under its control, inside the box the control sits in, a
 * popup is cut off wherever that box clips: a list's card that rounds its
 * corners, a table that scrolls sideways (which clips up and down too), a
 * drawer's scrolling body. The logs toolbar's Columns lost its foot over a
 * trace's empty logs (#9859), Copy attributes near a span panel's foot
 * (#9861), and a search's suggestions ran into an investigation drawer's
 * scroll area (#9909). Popper, which places the shared popups, cannot see an
 * `overflow: clip` box either. The shared LayeredPopover
 * (Common/UI/Components/Tooltip/LayeredPopover.tsx) draws a popup on the
 * page's body, the tooltip layer, placed against the window - under its
 * control, above where the window has no room, slid along inside its sides
 * - and keeps what a menu drawn after its control had: Tab through it,
 * Escape, a press outside. A field's popup (a search's suggestions) is
 * drawn there too, leaving the keys to its field (isFieldPopup).
 *
 * This reads every frontend's browser source (and Common/UI, and ee/ when
 * present) through the TypeScript AST: every JSX class attribute, and every
 * constant that holds classes, joined across its pieces (a template's
 * conditions, cx() and the strings in it). It fails on a popup drawn in
 * place, in either of the shapes a hand-rolled one takes:
 *
 *   - a panel that hangs off the box it is in and floats over the page:
 *     `absolute`, hung from the box's edge (`top-full`, `bottom-full`, or a
 *     top or bottom margin with no top, bottom or inset of its own: placed
 *     where it falls after its control), and lifted with a shadow;
 *   - in a file whose control says it opens a popup (`aria-haspopup`), an
 *     element hung off its box the same way, shadow or not.
 *
 * On the layer a popup has no place of its own: its classes are its look
 * (border, shadow, width), and LayeredPopover places it. So a popup moved
 * there drops out of this scan by itself.
 *
 * The popups still drawn in place are listed below, each with how many it
 * holds and why it is not cut off today. The list only shrinks: one moved
 * onto the layer leaves it, and a new popup is drawn on the layer from the
 * start.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

// The follow-up that moves the rest onto the layer.
const STILL_TO_MOVE_ISSUE: string = "#10162";

export const STILL_DRAWN_IN_PLACE: Record<
  string,
  { count: number; reason: string }
> = {
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardDefaultsBar.tsx":
    {
      count: 1,
      reason:
        "A dashboard's Default time range and Default auto-refresh menus, opened from the editing toolbar's row, which no box clips, and kept on a phone's screen by useMenuKeptOnScreen. To move (#10162).",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar.tsx":
    {
      count: 1,
      reason:
        "The dashboard's auto-refresh menu, opened from its toolbar, which no box clips, and lifted over the canvas by DashboardStackingLayers.toolbarPopup. To move (#10162).",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteSearchBox.tsx":
    {
      count: 1,
      reason:
        "A network site search's suggestions, under its search on the network map and the topology explorer, where no box around it clips: a field's popup (isFieldPopup) to move (#10162).",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficView.tsx":
    {
      count: 1,
      reason:
        "Find a name or an IP address's matches, under its box in the traffic page's filters, which no box clips: a field's popup (isFieldPopup) to move (#10162).",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipStyles.ts":
    {
      count: 1,
      reason:
        "The owner filter chips' panels (FilterChipButton), opened from a list's filter row above its card, which nothing clips; shared by every owner chip, so moved with all of them (#10162).",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabSwitcher.tsx":
    {
      count: 1,
      reason:
        "The player's tab picker, in the player's header, which no box clips: placed by the shared useDropdownPlacement, which slides it onto a phone's screen, with a search and a list whose keys are its own. To move (#10162).",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowScopeFilter.tsx":
    {
      count: 1,
      reason:
        "User Flows' scope filter's list, under its search in the page's header, which no box clips: a field's popup (isFieldPopup) to move (#10162).",
    },
  "packages/App/FeatureSet/StatusPage/src/Components/Header/Header.tsx": {
    count: 1,
    reason:
      "A status page's own header menu, in the public page's header, which no box clips. To move (#10162).",
  },
  "packages/Common/UI/Components/Dashboard/DashboardVariableControl.tsx": {
    count: 1,
    reason:
      "A dashboard variable's choices, opened from the variables bar above the canvas, which no box clips. To move (#10162).",
  },
  "packages/Common/UI/Components/Header/IconDropdown/IconDropdownMenu.tsx": {
    count: 1,
    reason:
      "The header's Help, profile and other icon menus (HeaderIconDropdownButton), opened from the page's header, which no box clips; shared by every app's header, so moved with all of them (#10162).",
  },
  "packages/Common/UI/Components/Header/ProjectPicker/ProjectPickerMenu.tsx": {
    count: 1,
    reason:
      "The header's project picker, opened from the page's header, which no box clips. To move with the header's other menus (#10162).",
  },
  "packages/Common/UI/Components/HeaderAlert/NotificationBell/NotificationBellDropdown.tsx":
    {
      count: 1,
      reason:
        "The header's notification bell, opened from the page's header, which no box clips. To move with the header's other menus (#10162).",
    },
  "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx": {
    count: 1,
    reason:
      "A list's label suggestions, under the search in its card's header, which does not clip (Card is overflow-visible): a field's popup (isFieldPopup) to move (#10162).",
  },
  "packages/Common/UI/Components/MoreMenu/MoreMenu.tsx": {
    count: 1,
    reason:
      "The shared ⋯ menu's in-place default. A trigger inside a box that clips (a table's row) passes isMenuPortaled, which draws the menu on the body with a placement of its own; moving every caller onto the layer is #10162.",
  },
};

export interface HandRolledPopup {
  file: string;
  line: number;
  // How its classes read, joined: for the message.
  classes: string;
}

// A JSX attribute that holds classes.
const CLASS_ATTRIBUTES: ReadonlyArray<string> = ["className", "class"];

// A control that says it opens a popup: the attribute, and the props that hand it on.
const POPUP_TRIGGER_ATTRIBUTES: ReadonlyArray<string> = [
  "aria-haspopup",
  "hasPopup",
  "ariaHasPopup",
];

// The utility a class sets, its variants (md:, dark:, max-sm:, !) dropped.
function utilityOf(token: string): string {
  const parts: Array<string> = token.split(":");

  return (parts[parts.length - 1] || "").replace(/^!/, "");
}

// Every piece of text a class list is written in: strings, templates, conditions.
function fragmentsOf(node: ts.Node): Array<string> {
  const fragments: Array<string> = [];

  const visit: (child: ts.Node) => void = (child: ts.Node): void => {
    if (
      ts.isStringLiteral(child) ||
      ts.isNoSubstitutionTemplateLiteral(child)
    ) {
      fragments.push(child.text);
      return;
    }

    if (ts.isTemplateExpression(child)) {
      fragments.push(child.head.text);

      for (const span of child.templateSpans) {
        visit(span.expression);
        fragments.push(span.literal.text);
      }

      return;
    }

    ts.forEachChild(child, visit);
  };

  visit(node);

  return fragments;
}

const HANG_FROM_EDGE: ReadonlyArray<string> = ["top-full", "bottom-full"];

// A position of its own up or down: top-2, -top-1, bottom-0, inset-0, inset-y-0.
const OWN_VERTICAL_POSITION: RegExp = /^-?(top|bottom|inset|inset-y)-/;

// A margin that sets it apart from the control it falls after.
const TOP_OR_BOTTOM_MARGIN: RegExp = /^-?(mt|mb|my)-/;

// Lifted over the page: a shadow, not its absence.
const SHADOW: RegExp = /^shadow(-(sm|md|lg|xl|2xl|inner|\[.+\]))?$/;

export interface ClassListShape {
  isAbsolute: boolean;
  // Hung off the edge of the box it is in, or placed where it falls after its control.
  hangsOffItsBox: boolean;
  hasShadow: boolean;
}

export function readClassList(text: string): ClassListShape {
  const utilities: Array<string> = text
    .split(/\s+/)
    .filter((token: string): boolean => {
      return token.length > 0;
    })
    .map(utilityOf);

  const isHungFromEdge: boolean = utilities.some((utility: string): boolean => {
    return HANG_FROM_EDGE.includes(utility);
  });
  const hasOwnVerticalPosition: boolean = utilities.some(
    (utility: string): boolean => {
      return (
        OWN_VERTICAL_POSITION.test(utility) && !HANG_FROM_EDGE.includes(utility)
      );
    },
  );
  const hasMargin: boolean = utilities.some((utility: string): boolean => {
    return TOP_OR_BOTTOM_MARGIN.test(utility);
  });

  return {
    isAbsolute: utilities.includes("absolute"),
    hangsOffItsBox: isHungFromEdge || (hasMargin && !hasOwnVerticalPosition),
    hasShadow: utilities.some((utility: string): boolean => {
      return SHADOW.test(utility);
    }),
  };
}

function hasPopupTrigger(source: ts.SourceFile): boolean {
  let found: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (
      ts.isJsxAttribute(node) &&
      POPUP_TRIGGER_ATTRIBUTES.includes(node.name.getText(source))
    ) {
      const value: string = node.initializer
        ? fragmentsOf(node.initializer).join(" ")
        : "true";

      // aria-haspopup="false" opens nothing.
      if (value.trim() !== "false") {
        found = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

export function findHandRolledPopups(
  file: string,
  text: string,
): Array<HandRolledPopup> {
  if (!text.includes("absolute")) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const opensAPopup: boolean = hasPopupTrigger(source);
  const found: Array<HandRolledPopup> = [];

  const check: (node: ts.Node) => void = (node: ts.Node): void => {
    const classes: string = fragmentsOf(node).join(" ");
    const shape: ClassListShape = readClassList(classes);

    if (
      shape.isAbsolute &&
      shape.hangsOffItsBox &&
      (shape.hasShadow || opensAPopup)
    ) {
      found.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        classes: classes.replace(/\s+/g, " ").trim(),
      });
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      CLASS_ATTRIBUTES.includes(node.name.getText(source)) &&
      node.initializer
    ) {
      check(node.initializer);
      return;
    }

    // A constant that holds classes, or a map of them.
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer: ts.Expression = node.initializer;

      if (
        ts.isStringLiteral(initializer) ||
        ts.isNoSubstitutionTemplateLiteral(initializer) ||
        ts.isTemplateExpression(initializer)
      ) {
        check(initializer);
        return;
      }

      if (ts.isObjectLiteralExpression(initializer)) {
        for (const property of initializer.properties) {
          if (ts.isPropertyAssignment(property)) {
            check(property.initializer);
          }
        }

        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

/*
 * What the guard says of a set of files: every popup drawn in place that the
 * list does not excuse, and every entry of the list that no longer holds what
 * it says.
 */
export function judgeHandRolledPopups(data: {
  foundByFile: Map<string, Array<HandRolledPopup>>;
  stillInPlace: Record<string, { count: number; reason: string }>;
  hasFile: (file: string) => boolean;
}): { unexplained: Array<string>; stale: Array<string> } {
  const unexplained: Array<string> = [];
  const stale: Array<string> = [];

  data.foundByFile.forEach(
    (found: Array<HandRolledPopup>, file: string): void => {
      const allowed: number = data.stillInPlace[file]?.count || 0;

      if (found.length > allowed) {
        for (const popup of found) {
          unexplained.push(
            `${popup.file}:${popup.line} draws a popup in place (${popup.classes}): draw it on the tooltip layer with LayeredPopover (Common/UI/Components/Tooltip/LayeredPopover), its classes its look only - isFieldPopup for a field's suggestions`,
          );
        }
      }
    },
  );

  for (const file of Object.keys(data.stillInPlace)) {
    if (!data.hasFile(file)) {
      stale.push(`${file} is gone: take it off the list`);
      continue;
    }

    const entry: { count: number; reason: string } = data.stillInPlace[file]!;
    const count: number = data.foundByFile.get(file)?.length || 0;

    if (count !== entry.count) {
      stale.push(
        `${file} draws ${count} in place, the list says ${entry.count}: the list only shrinks, so lower it as one moves onto the layer`,
      );
    }

    if (!entry.reason.trim()) {
      stale.push(`${file} gives no reason`);
    }
  }

  return { unexplained, stale };
}

describe("the guard reads the shapes it is meant to", () => {
  test("a menu hung under its control, a list above it and a panel after it are caught", () => {
    const code: string = `
      const A = () => (
        <div className="relative">
          <button aria-haspopup="menu">Export</button>
          <div className="absolute right-0 z-10 mt-2 w-56 rounded-md bg-white shadow-lg">menu</div>
        </div>
      );
      const B = (props) => (
        <div role="listbox" className={\`absolute left-0 z-50 w-72 shadow-xl \${props.isUp ? "bottom-full mb-2" : "top-full mt-2"}\`} />
      );
      const C = () => <div className="absolute left-0 right-0 top-full z-50 rounded-lg border bg-white shadow-lg" />;
    `;

    expect(
      findHandRolledPopups("Fixture.tsx", code).map(
        (popup: HandRolledPopup): number => {
          return popup.line;
        },
      ),
    ).toEqual([5, 9, 11]);
  });

  test("classes held in a constant, or a map of them, are read too", () => {
    const code: string = `
      export const MENU_CLASS_NAME: string = "absolute left-0 top-full z-20 mt-2 rounded-lg bg-white shadow-xl";
      export const PLACEMENTS: Record<string, string> = {
        left: "absolute left-0 top-full z-50 mt-1 shadow-lg",
        right: "absolute right-0 top-full z-50 mt-1 shadow-lg",
      };
    `;

    expect(findHandRolledPopups("Styles.ts", code)).toHaveLength(3);
  });

  test("beside a control that opens a popup, a panel hung after it is caught with no shadow of its own", () => {
    const code: string = `
      const A = () => (
        <div className="relative">
          <button aria-haspopup="true">Menu</button>
          <div className="animate-slide-down absolute left-0 right-0 top-full z-50 mt-1">
            <div className="rounded-lg bg-white shadow-lg">menu</div>
          </div>
        </div>
      );
    `;

    expect(findHandRolledPopups("Fixture.tsx", code)).toHaveLength(1);
  });

  test("what is not a popup drawn in place is left alone", () => {
    const code: string = `
      // A popup drawn "absolute top-full mt-2 shadow-lg" in place, in words.
      const A = () => (
        <div className="relative">
          <button aria-haspopup="menu">Bell</button>
          {/* A count on the bell. */}
          <span className="absolute -top-1 -right-1 flex h-5 w-5 rounded-full bg-red-500 ring-2 ring-white">3</span>
          {/* An icon inside a field. */}
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3" />
          {/* A chip over a chart, at its own place. */}
          <span className="absolute right-2 top-2 z-10 rounded-full border bg-white/90 shadow-sm">Refreshing</span>
          {/* A menu on the tooltip layer: its look only. */}
          <div className="w-72 max-w-[calc(100vw-1rem)] rounded-xl border bg-white shadow-lg">menu</div>
          {/* A dialog's panel, fixed to the window. */}
          <div className="fixed inset-0 z-50 shadow-xl" />
        </div>
      );
      const html: string = "<div>absolute</div>";
    `;

    expect(findHandRolledPopups("Fixture.tsx", code)).toEqual([]);
  });

  test('aria-haspopup="false" says no popup opens: a panel without a shadow beside it is left alone', () => {
    const code: string = `
      const A = () => (
        <div>
          <button aria-haspopup="false">Go</button>
          <div className="absolute left-0 top-full mt-1">note</div>
        </div>
      );
    `;

    expect(findHandRolledPopups("Fixture.tsx", code)).toEqual([]);
  });

  test("a variant does not hide a class: md:absolute and dark:shadow-lg still count", () => {
    expect(
      readClassList("md:absolute top-full dark:shadow-lg rounded-md"),
    ).toEqual({ isAbsolute: true, hangsOffItsBox: true, hasShadow: true });
    expect(readClassList("absolute mt-2 top-2 shadow-lg").hangsOffItsBox).toBe(
      false,
    );
    expect(readClassList("absolute mt-2 shadow-none").hasShadow).toBe(false);
  });

  test("a planted popup fails the guard, and a list that no longer holds what it says fails it too", () => {
    const planted: string = `
      const ExportMenu = () => (
        <div className="relative">
          <button aria-haspopup="menu" aria-expanded={true}>Export</button>
          <div role="menu" className="absolute right-0 z-20 mt-2 w-48 rounded-lg bg-white py-1 shadow-lg ring-1 ring-gray-200">
            <button role="menuitem">CSV</button>
          </div>
        </div>
      );
    `;
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Components/Planted/ExportMenu.tsx";
    const foundByFile: Map<string, Array<HandRolledPopup>> = new Map([
      [file, findHandRolledPopups(file, planted)],
    ]);

    const judged: { unexplained: Array<string>; stale: Array<string> } =
      judgeHandRolledPopups({
        foundByFile: foundByFile,
        stillInPlace: {},
        hasFile: (): boolean => {
          return true;
        },
      });

    expect(judged.unexplained).toHaveLength(1);
    expect(judged.unexplained[0]).toContain(`${file}:5 draws a popup in place`);
    expect(judged.unexplained[0]).toContain("LayeredPopover");

    // Listed, it passes; listed with one too many, or with no reason, it fails.
    expect(
      judgeHandRolledPopups({
        foundByFile: foundByFile,
        stillInPlace: {
          [file]: { count: 1, reason: "Planted for this test." },
        },
        hasFile: (): boolean => {
          return true;
        },
      }),
    ).toEqual({ unexplained: [], stale: [] });
    expect(
      judgeHandRolledPopups({
        foundByFile: foundByFile,
        stillInPlace: { [file]: { count: 2, reason: " " } },
        hasFile: (): boolean => {
          return true;
        },
      }).stale,
    ).toHaveLength(2);
  });
});

describe("a popup is drawn on the tooltip layer", () => {
  const roots: Array<string> = listScanRoots(REPOSITORY_ROOT);
  const files: Array<string> = roots.flatMap((root: string): Array<string> => {
    return listSourceFiles(root);
  });

  const foundByFile: Map<string, Array<HandRolledPopup>> = new Map();

  for (const file of files) {
    const relative: string = toRelativePath(REPOSITORY_ROOT, file);
    const found: Array<HandRolledPopup> = findHandRolledPopups(
      relative,
      fs.readFileSync(file, "utf8"),
    );

    if (found.length > 0) {
      foundByFile.set(relative, found);
    }
  }

  test("the scan reads the frontends", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  test("no popup is drawn in place outside the list, and the list only holds what is still drawn there", () => {
    const judged: { unexplained: Array<string>; stale: Array<string> } =
      judgeHandRolledPopups({
        foundByFile: foundByFile,
        stillInPlace: STILL_DRAWN_IN_PLACE,
        hasFile: (file: string): boolean => {
          // A checkout without ee/ (the Community Edition) has none of its files.
          if (
            file.startsWith("ee/") &&
            !fs.existsSync(path.join(REPOSITORY_ROOT, "ee"))
          ) {
            return true;
          }

          return fs.existsSync(path.join(REPOSITORY_ROOT, file));
        },
      });

    expect(judged.unexplained).toEqual([]);
    expect(judged.stale).toEqual([]);
  });

  test(`every entry of the list names the issue that moves it (${STILL_TO_MOVE_ISSUE})`, () => {
    for (const [file, entry] of Object.entries(STILL_DRAWN_IN_PLACE)) {
      expect({
        file,
        names: entry.reason.includes(STILL_TO_MOVE_ISSUE),
      }).toEqual({ file, names: true });
    }
  });

  /*
   * Moved onto the layer for #9909, #9910 and #9911: none may come back, and
   * none may join the list.
   */
  test("the popups this rule was written for stay on the layer", () => {
    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Components/AIChat/PermissionModePicker.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/AIChat/ProviderPicker.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Code/CodePicker.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessionsMenu.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayControls.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySearchBar.tsx",
      "packages/Common/UI/Components/TelemetryViewer/components/TelemetrySearchSuggestions.tsx",
      "packages/Common/UI/Components/TelemetryViewer/components/TelemetrySearchHelp.tsx",
      "packages/Common/UI/Components/LogsViewer/components/LogSearchHelp.tsx",
      "packages/Common/UI/Components/Calendar/Calendar.tsx",
    ]) {
      expect(STILL_DRAWN_IN_PLACE[file]).toBeUndefined();
      expect({
        file,
        found: findHandRolledPopups(
          file,
          fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
        ).length,
      }).toEqual({ file, found: 0 });
      expect(
        fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
      ).toContain("LayeredPopover");
    }

    // The logs search's copy of the explorers' suggestions, and a dropdown nothing drew.
    for (const file of [
      "packages/Common/UI/Components/LogsViewer/components/LogSearchSuggestions.tsx",
      "packages/Common/UI/Components/Button/DropdownButton.tsx",
    ]) {
      expect(fs.existsSync(path.join(REPOSITORY_ROOT, file))).toBe(false);
    }
  });
});
