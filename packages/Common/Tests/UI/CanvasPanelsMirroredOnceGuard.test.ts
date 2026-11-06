import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";

/*
 * A CANVAS'S PANELS ARE MIRRORED ONCE, BY THE PAGE.
 *
 * React Flow places a panel - the zoom buttons (Controls), a minimap, a
 * Panel of a canvas's own - on a physical side. On a Persian page the zoom
 * buttons stayed at the bottom left, the far end of its lines. Theme.css
 * now mirrors every panel on a page read right to left, so a canvas names
 * the side a page read left to right puts it on and nothing more. A canvas
 * that also picked its side by the page's direction (the resource
 * topology's zoom buttons did) would be turned twice, back to the far end.
 *
 * This reads every frontend's source and fails on a panel whose position
 * is chosen by the reading direction, and pins the rules that mirror them.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// A run of white space: the stylesheet is read with each run as one space.
const WHITESPACE_RUN_REGEX: RegExp = /\s+/g;

const THEME_CSS: string = fs
  .readFileSync(
    path.join(REPOSITORY_ROOT, "packages/Common/UI/Styles/Theme.css"),
    "utf-8",
  )
  .replace(WHITESPACE_RUN_REGEX, " ");

// A React Flow panel's tag, opened: <Controls, <MiniMap, <Panel.
const PANEL_OPENING_REGEX: RegExp = /<(?:Controls|MiniMap|Panel)\b/g;

// A position chosen by which way the page reads, in a panel's attributes.
const DIRECTION_WORDS: Array<string> = [
  '"rtl"',
  "'rtl'",
  "RIGHT_TO_LEFT",
  "isRightToLeft",
  "direction",
];

interface PanelFinding {
  file: string;
  line: number;
  position: string;
}

// The attributes of the tag opened at `start`: up to its first ">" at depth 0.
const readAttributes: (source: string, start: number) => string = (
  source: string,
  start: number,
): string => {
  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source.charAt(index);

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
    } else if (character === ">" && depth === 0) {
      return source.slice(start, index);
    }
  }

  return source.slice(start);
};

// A panel's position attribute, as written: `position={...}` or `position="..."`.
const readPosition: (attributes: string) => string | null = (
  attributes: string,
): string | null => {
  const at: number = attributes.indexOf("position=");

  if (at === -1) {
    return null;
  }

  const value: string = attributes.slice(at + "position=".length);

  if (value.startsWith('"')) {
    return value.slice(0, value.indexOf('"', 1) + 1);
  }

  let depth: number = 0;

  for (let index: number = 0; index < value.length; index++) {
    const character: string = value.charAt(index);

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return value.slice(0, index + 1);
      }
    }
  }

  return value;
};

const findPanelsPlacedByDirection: (
  source: string,
  file: string,
) => Array<PanelFinding> = (
  source: string,
  file: string,
): Array<PanelFinding> => {
  const findings: Array<PanelFinding> = [];

  for (const match of source.matchAll(PANEL_OPENING_REGEX)) {
    const start: number = match.index ?? 0;
    const position: string | null = readPosition(readAttributes(source, start));

    if (
      position &&
      DIRECTION_WORDS.some((word: string): boolean => {
        return position.includes(word);
      })
    ) {
      findings.push({
        file,
        line: source.slice(0, start).split("\n").length,
        position,
      });
    }
  }

  return findings;
};

describe("a canvas's panels are mirrored once, by the page", () => {
  test("the guard finds a panel placed by the page's direction, and passes one named by its side", () => {
    expect(
      findPanelsPlacedByDirection(
        '<Controls showInteractive={false} position={props.direction === "rtl" ? "bottom-right" : "bottom-left"} />',
        "Example.tsx",
      ),
    ).toHaveLength(1);
    expect(
      findPanelsPlacedByDirection(
        "<MiniMap position={isRightToLeft ? 'bottom-left' : 'bottom-right'} />",
        "Example.tsx",
      ),
    ).toHaveLength(1);
    expect(
      findPanelsPlacedByDirection(
        '<Controls position="top-right" showInteractive={false} />',
        "Example.tsx",
      ),
    ).toEqual([]);
    expect(
      findPanelsPlacedByDirection(
        "<Controls showInteractive={false} onFitView={() => { fit(); }} />",
        "Example.tsx",
      ),
    ).toEqual([]);
  });

  test("no frontend picks a panel's side by the page's direction", () => {
    const findings: Array<PanelFinding> = [];

    for (const root of listScanRoots(REPOSITORY_ROOT)) {
      for (const file of listSourceFiles(root)) {
        if (!file.endsWith(".tsx")) {
          continue;
        }

        const source: string = fs.readFileSync(file, "utf-8");

        if (!source.includes("reactflow")) {
          continue;
        }

        findings.push(
          ...findPanelsPlacedByDirection(
            source,
            toRelativePath(REPOSITORY_ROOT, file),
          ),
        );
      }
    }

    expect(findings).toEqual([]);
  });

  test("Theme.css mirrors every panel on a page read right to left", () => {
    expect(THEME_CSS).toContain(
      ".react-flow__panel.left:dir(rtl) { left: auto; right: 0; }",
    );
    expect(THEME_CSS).toContain(
      ".react-flow__panel.right:dir(rtl) { right: auto; left: 0; }",
    );
  });
});
