import EventName from "../../FeatureSet/Dashboard/src/Utils/EventName";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The command palette's behavior is spread across four files that must agree:
 * the Common NavBar must SURRENDER Cmd/Ctrl+K when asked, the Dashboard
 * NavBar must ask, the palette host must claim the chord (and clean up after
 * itself), and the header pill must open the palette through the shared
 * event. None of that is expressible as a type, and the App suite runs in
 * plain node (no renderer), so — like NetworkTopologyPanelLayering — the
 * relationships are pinned against the sources with tolerant, intent-level
 * patterns rather than exact byte strings.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");

const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

// Comments describe history, not behavior — match code only.
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readAppCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

function readCommonCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(COMMON_ROOT, ...relativeParts), "utf8"),
  );
}

/*
 * The balanced `open...close` block starting at openIndex — the same
 * structural-extraction technique HomeWaterfall.test.ts uses. The sources
 * under test keep braces balanced even inside template literals, so a depth
 * counter is sufficient and avoids pinning any exact formatting.
 */
function balancedBlock(
  source: string,
  openIndex: number,
  open: string,
  close: string,
): string {
  let depth: number = 0;

  for (let i: number = openIndex; i < source.length; i++) {
    const character: string = source.charAt(i);

    if (character === open) {
      depth++;
    } else if (character === close) {
      depth--;

      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }

  throw new Error(
    `Unbalanced ${open}${close} block at index ${openIndex} — the source under test changed shape; update CommandPaletteWiring.test.ts to match.`,
  );
}

/*
 * The index of the first top-level `:` after a top-level `?` inside a JSX
 * expression container `{cond ? consequent : alternate}` — the split between
 * the two ternary branches. "Top level" means brace/paren/bracket depth 1,
 * i.e. directly inside the container's own braces; both branches are wrapped
 * in parens in the sources under test, so their contents sit deeper. Returns
 * -1 when the container is not a ternary (an `&&` gate has no else branch).
 */
function ternaryElseIndex(block: string): number {
  let depth: number = 0;
  let sawTopLevelQuestion: boolean = false;

  for (let i: number = 0; i < block.length; i++) {
    const character: string = block.charAt(i);

    if (character === "{" || character === "(" || character === "[") {
      depth++;
    } else if (character === "}" || character === ")" || character === "]") {
      depth--;
    } else if (
      depth === 1 &&
      character === "?" &&
      block.charAt(i + 1) !== "." // optional chaining is not a ternary
    ) {
      sawTopLevelQuestion = true;
    } else if (depth === 1 && character === ":" && sawTopLevelQuestion) {
      return i;
    }
  }

  return -1;
}

const COMMON_NAVBAR: string = readCommonCode(
  "UI",
  "Components",
  "Navbar",
  "NavBar.tsx",
);

const DASHBOARD_NAVBAR: string = readAppCode(
  "Components",
  "NavBar",
  "NavBar.tsx",
);

const DASHBOARD_HEADER: string = readAppCode(
  "Components",
  "Header",
  "Header.tsx",
);

const PALETTE_HOST: string = readAppCode(
  "Components",
  "CommandPalette",
  "DashboardCommandPalette.tsx",
);

describe("command palette wiring", () => {
  test("the toggle event exists in the shared EventName enum", () => {
    /*
     * The enum is the contract between the header pill (dispatcher) and the
     * palette host (listener); a typo'd ad-hoc string on either side would
     * silently break the pill.
     */
    expect(EventName.COMMAND_PALETTE_TOGGLE).toBe("COMMAND_PALETTE_TOGGLE");
  });

  test("the Common NavBar can surrender Cmd/Ctrl+K, and the guard sits on the listener registration", () => {
    // The prop exists on the component's props contract...
    expect(COMMON_NAVBAR).toMatch(/disableCommandKShortcut\??:\s*boolean/);

    /*
     * ...and it short-circuits BEFORE the document keydown listener is added.
     * A guard inside the handler would still leave a listener registered that
     * could race the palette's. The window is sized to span the handler
     * definition that sits between the early return and the registration,
     * without reaching a keydown registration in some unrelated effect.
     */
    expect(COMMON_NAVBAR).toMatch(
      /disableCommandKShortcut[\s\S]{0,700}?document\.addEventListener\(\s*["']keydown["']/,
    );
  });

  test("the Dashboard NavBar hands the shortcut to the palette", () => {
    /*
     * Passing the prop (and not `={false}`) is what actually frees the chord
     * on the dashboard. Tolerant of `disableCommandKShortcut` shorthand and
     * of `={true}`.
     */
    expect(DASHBOARD_NAVBAR).toMatch(
      /<NavBar[\s\S]*?disableCommandKShortcut(?!\s*=\s*\{\s*false)/,
    );
  });

  test("both the NavBar and the palette read the SAME page catalog hook", () => {
    // Single source of truth: an item added to the hook reaches both surfaces.
    expect(DASHBOARD_NAVBAR).toMatch(/useDashboardNavigationItems\s*\(/);
    expect(PALETTE_HOST).toMatch(/useDashboardNavigationItems\s*\(/);

    /*
     * And the NavBar no longer builds its own inline catalog — a resurrected
     * local moreMenuItems array would drift from what the palette shows.
     */
    expect(DASHBOARD_NAVBAR).not.toMatch(
      /moreMenuItems\s*:\s*MoreMenuItem\[\]\s*=/,
    );
  });

  test("the palette host claims Cmd/Ctrl+K on document and removes the listener on unmount", () => {
    expect(PALETTE_HOST).toMatch(
      /document\.addEventListener\(\s*["']keydown["']/,
    );
    expect(PALETTE_HOST).toMatch(
      /document\.removeEventListener\(\s*["']keydown["']/,
    );
  });

  test("the palette's shortcut handler is a polite citizen: respects claimed events, then claims its own", () => {
    // Bails when another handler already took the chord...
    expect(PALETTE_HOST).toMatch(/defaultPrevented/);
    // ...and prevents the browser default once it decides to act.
    expect(PALETTE_HOST).toMatch(/preventDefault\s*\(\s*\)/);
  });

  test("the palette host subscribes to the global toggle event and unsubscribes symmetrically", () => {
    expect(PALETTE_HOST).toMatch(
      /GlobalEvents\.addEventListener\(\s*EventName\.COMMAND_PALETTE_TOGGLE/,
    );
    expect(PALETTE_HOST).toMatch(
      /GlobalEvents\.removeEventListener\(\s*EventName\.COMMAND_PALETTE_TOGGLE/,
    );
  });

  test("the header search pill dispatches the toggle event", () => {
    expect(DASHBOARD_HEADER).toMatch(
      /GlobalEvents\.dispatchEvent\(\s*EventName\.COMMAND_PALETTE_TOGGLE/,
    );
  });

  test("the header pill only renders when a project is selected", () => {
    /*
     * Without a project the palette has no project-scoped pages or entity
     * search to offer — the dispatch must sit INSIDE a JSX block gated on
     * props.selectedProject (a proximity match would also pass on an
     * unrelated `selectedProject={...}` prop pass, so the gate is extracted
     * structurally instead).
     */
    const dispatchMatch: RegExpMatchArray | null = DASHBOARD_HEADER.match(
      /GlobalEvents\.dispatchEvent\(\s*EventName\.COMMAND_PALETTE_TOGGLE/,
    );
    expect(dispatchMatch).not.toBeNull();
    const dispatchIndex: number = dispatchMatch!.index as number;

    /*
     * Every JSX expression container that CONDITIONS on the selected project
     * — `{props.selectedProject ? … : …}` or `{props.selectedProject && …}`.
     * A plain prop pass has neither operator and never matches.
     */
    const gatePattern: RegExp = /\{\s*props\.selectedProject\s*(?:\?[^.]|&&)/g;
    let gate: string | null = null;
    let gateStart: number = -1;

    let match: RegExpExecArray | null = gatePattern.exec(DASHBOARD_HEADER);
    while (match !== null) {
      const block: string = balancedBlock(
        DASHBOARD_HEADER,
        match.index,
        "{",
        "}",
      );

      if (
        dispatchIndex > match.index &&
        dispatchIndex < match.index + block.length
      ) {
        gate = block;
        gateStart = match.index;
        break;
      }

      match = gatePattern.exec(DASHBOARD_HEADER);
    }

    expect(gate).not.toBeNull();

    /*
     * And inside a ternary gate the dispatch must live in the truthy branch —
     * a pill moved to the else side would render exactly when there is NO
     * project.
     */
    const elseIndex: number = ternaryElseIndex(gate!);
    if (elseIndex >= 0) {
      expect(dispatchIndex - gateStart).toBeLessThan(elseIndex);
    }
  });

  test("the palette host guards project-scoped navigation with the ':' check", () => {
    /*
     * The palette is mounted on every page, including no-project ones where
     * populateRouteParams leaves ":projectId" in the path. The shared helper
     * is the one place that decides navigability.
     */
    expect(PALETTE_HOST).toMatch(/isRoutePathNavigable\s*\(/);
  });

  test("entity search only exists with a project, through per-model providers", () => {
    expect(PALETTE_HOST).toMatch(/getCurrentProjectId\s*\(\s*\)/);
    // Every provider goes through the isolated, try/caught factory.
    expect(PALETTE_HOST).toMatch(/createEntitySearchProvider</);
    expect(PALETTE_HOST).toMatch(/catch/);
  });
});
