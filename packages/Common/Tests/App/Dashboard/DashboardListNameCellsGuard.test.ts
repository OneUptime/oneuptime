// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY NAME A LIST WIDGET CUTS SHORT IS DRAWN IN ITS NAME CELL (#6927).
 *
 * A list widget cuts the words in its cells where their column ends
 * (truncate), and on an Arabic or Persian board a line is cut at its left,
 * where an English name starts: "checkout-api-production" read
 * "...api-production". Every list widget now draws its names - a row's
 * name, an image, a namespace, a host, a cluster - in ResourceListNameCell
 * (DashboardResourceListBase), which reads the way its name is written, so
 * an English name is cut at its own end.
 *
 * DashboardListWidgetNameCells renders every list widget and reads its
 * cells. This guard reads their source, so that a column added to a list
 * later cannot draw a name in a plain cut cell: a <td> that cuts its line
 * short is one of the figures written for their reader already (a share, a
 * size, a time), named here, or the list draws a name in it the old way.
 */

const COMPONENTS_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Dashboard",
  "Components",
);

// The cells a list cuts short that hold a figure, not a name: by file, what each draws.
const FIGURE_CELLS: ReadonlyArray<string> = [
  "DashboardHostListComponent.tsx: {cpuMem}",
  "DashboardHostListComponent.tsx: {formatRelative(lastSeenAt)}",
  "DashboardStorageArrayVolumeListComponent.tsx: {formatUsedOfProvisioned(r)}",
];

const LIST_WIDGET_FILE_REGEX: RegExp = /^Dashboard\w*ListComponent\.tsx$/;

// A <td> opening tag: "<td" and then a space, a line's end or its ">".
const CELL_OPENING_REGEX: RegExp = /<td(?=[\s>])/g;

const CUT_SHORT_REGEX: RegExp = /\btruncate\b/;

const WHITESPACE_REGEX: RegExp = /\s+/g;

// Every list widget: each Dashboard...ListComponent, and the network map, drawn as its list.
function listWidgetFiles(): Array<string> {
  return fs
    .readdirSync(COMPONENTS_DIR)
    .filter((file: string): boolean => {
      return (
        LIST_WIDGET_FILE_REGEX.test(file) ||
        file === "DashboardNetworkMapComponent.tsx"
      );
    })
    .sort();
}

/*
 * Where an opening tag that starts at `from` ends: its ">", passing over
 * what its attributes hold in braces (an arrow function's "=>") and in
 * quotes. -1 for a tag that never ends.
 */
function endOfTag(source: string, from: number): number {
  let depth: number = 0;
  let quote: string | null = null;

  for (let at: number = from; at < source.length; at++) {
    const character: string = source[at] as string;

    if (quote) {
      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (depth === 0 && (character === '"' || character === "'")) {
      quote = character;
    } else if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
    } else if (character === ">" && depth === 0) {
      return at;
    }
  }

  return -1;
}

interface PlainCutCell {
  line: number;
  // What the cell draws, its whitespace made one space: "{cpuMem}".
  content: string;
}

// Every plain <td> in `source` whose classes cut its line short.
function findPlainCutCells(source: string): Array<PlainCutCell> {
  const cells: Array<PlainCutCell> = [];

  for (const match of source.matchAll(CELL_OPENING_REGEX)) {
    const start: number = match.index as number;
    const end: number = endOfTag(source, start + 3);

    if (end < 0) {
      continue;
    }

    if (!CUT_SHORT_REGEX.test(source.slice(start + 3, end))) {
      continue;
    }

    const close: number = source.indexOf("</td>", end);

    cells.push({
      line: source.slice(0, start).split("\n").length,
      content:
        close < 0
          ? ""
          : source
              .slice(end + 1, close)
              .replace(WHITESPACE_REGEX, " ")
              .trim(),
    });
  }

  return cells;
}

describe("the scan for a list's plain cells that cut their line short", () => {
  const EXAMPLE: string = [
    "<tr>",
    '  <td className="px-3 py-2 text-xs text-gray-700 truncate">',
    "    {name}",
    "  </td>",
    "  <td",
    '    className="px-3 py-2 text-xs text-gray-500 tabular-nums truncate"',
    "    onClick={(): void => { open(); }}",
    '    title="a > b"',
    "  >",
    "    {formatRelative(lastSeenAt)}",
    "  </td>",
    '  <td className="px-3 py-2">{status}</td>',
    '  <ResourceListNameCell name={host} className="px-3 py-2 truncate" />',
    "  <tdx truncate />",
    "</tr>",
  ].join("\n");

  test("finds each plain cut cell and what it draws, past an arrow function's '>' and a quoted one", () => {
    expect(findPlainCutCells(EXAMPLE)).toEqual([
      { line: 2, content: "{name}" },
      { line: 5, content: "{formatRelative(lastSeenAt)}" },
    ]);
  });

  test("leaves out a cell that is not cut short, a name cell and a tag that is not a cell", () => {
    const contents: Array<string> = findPlainCutCells(EXAMPLE).map(
      (cell: PlainCutCell): string => {
        return cell.content;
      },
    );

    expect(contents).not.toContain("{status}");
    expect(contents).toHaveLength(2);
  });

  test("a tag that never ends is passed over", () => {
    expect(findPlainCutCells('<td className="truncate"')).toEqual([]);
  });
});

describe("the list widgets' name cells", () => {
  test("every list widget is read: thirty-five lists and the network map's", () => {
    const files: Array<string> = listWidgetFiles();

    expect(files.length).toBeGreaterThanOrEqual(36);
    expect(files).toContain("DashboardNetworkMapComponent.tsx");
    expect(files).toContain("DashboardSloListComponent.tsx");
  });

  test("every list widget draws its names in ResourceListNameCell", () => {
    const withoutNameCell: Array<string> = listWidgetFiles().filter(
      (file: string): boolean => {
        return !fs
          .readFileSync(path.join(COMPONENTS_DIR, file), "utf8")
          .includes("<ResourceListNameCell");
      },
    );

    expect(withoutNameCell).toEqual([]);
  });

  test("a plain cell a list cuts short holds a figure written for its reader, never a name", () => {
    const plainCutCells: Array<string> = [];

    for (const file of listWidgetFiles()) {
      const source: string = fs.readFileSync(
        path.join(COMPONENTS_DIR, file),
        "utf8",
      );

      for (const cell of findPlainCutCells(source)) {
        plainCutCells.push(`${file}: ${cell.content}`);
      }
    }

    /*
     * A name here is drawn the old way: draw it in ResourceListNameCell.
     * A figure here is named in FIGURE_CELLS.
     */
    expect(plainCutCells.sort()).toEqual([...FIGURE_CELLS].sort());
  });
});
