// UX rule: Docs/ux/README.md#empty-states-and-suggestions
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";

/*
 * AN EMPTY STATE TAKES ITS ROOM FROM A SIZE PRESET (#9135).
 *
 * EmptyState used to pad itself by 13rem above and below (416px), a whole
 * page's worth, so in a card on a 390px phone "No X yet" began a quarter of
 * the way down the screen. Callers fixed it one at a time: some fifty passed
 * a padding of their own (py-4, py-8, py-12, py-16, pt-24 pb-24 and more, a
 * dozen sizes for the same thing), and two wrapped it in negative margins
 * (-my-16, -my-28) to take the padding back. The same empty card was a
 * different height on every page.
 *
 * EmptyState now takes size: Inline, Card (the default) or Page
 * (EMPTY_STATE_PADDING_CLASS_NAMES), and has no padding prop. This guard
 * reads every screen's source and fails when:
 *
 *   - an <EmptyState> is handed a padding or class of its own, which the
 *     component no longer reads (the build fails too, but ee/ is compiled
 *     only by the enterprise job);
 *   - an <EmptyState> sits directly inside a box with a negative vertical
 *     margin, which takes its room back instead of choosing a smaller size.
 *
 * Pick the preset for where the state sits: Inline in a panel, a form's
 * step or a short list inside a card; Card for a card's or list's body;
 * Page for a page with nothing else on it.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

// The opening tag of every <EmptyState ...> in a source, braces balanced.
export function listEmptyStateTags(source: string): Array<string> {
  const tags: Array<string> = [];
  const pattern: RegExp = /<EmptyState\b/g;
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    let depth: number = 0;
    let index: number = match.index + match[0].length;

    while (index < source.length) {
      const character: string = source[index] as string;

      if (character === "{") {
        depth++;
      } else if (character === "}") {
        depth--;
      } else if (character === ">" && depth === 0) {
        break;
      }

      index++;
    }

    tags.push(source.slice(match.index, index + 1));
    match = pattern.exec(source);
  }

  return tags;
}

// A prop that sizes the state by hand.
const HAND_SIZING_PROP: RegExp = /\s(paddingClassName|className)=/;

// A tag's own props: what its braces hold (a description's markup) left out.
export function getTopLevelProps(tag: string): string {
  let depth: number = 0;
  let topLevel: string = "";

  for (const character of tag) {
    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
    } else if (depth === 0) {
      topLevel += character;
    }
  }

  return topLevel;
}

export function findHandSizedEmptyStates(source: string): Array<string> {
  return listEmptyStateTags(source).filter((tag: string): boolean => {
    return HAND_SIZING_PROP.test(getTopLevelProps(tag));
  });
}

/*
 * A box whose class takes vertical room back (-my-16, -mt-8, sm:-mb-4),
 * opened right before an <EmptyState>, with at most an expression's opening
 * between them ({isX ? (). Only a margin in the box's own class attribute
 * counts.
 */
const WRAPPER_BEFORE_EMPTY_STATE: RegExp =
  /<[A-Za-z][\w.]*\s[^<>]*?className=("[^"]*"|\{[^{}]*\})[^<>]*>\s*(?:\{[^<>{}]*)?<EmptyState\b/g;

const NEGATIVE_VERTICAL_MARGIN: RegExp = /(?:^|[\s:"'`])-m[ytb]-[\w[\].]+/;

export function findNegativeMarginWrappers(source: string): Array<string> {
  const found: Array<string> = [];
  const pattern: RegExp = new RegExp(WRAPPER_BEFORE_EMPTY_STATE.source, "g");
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    if (NEGATIVE_VERTICAL_MARGIN.test(match[1] as string)) {
      found.push(match[0]);
    }
    match = pattern.exec(source);
  }

  return found;
}

describe("EmptyStateSizeGuard: the scans", () => {
  test("reads a tag whose props hold braces and arrows", () => {
    const source: string = `
      <EmptyState
        id="x"
        footer={<Button onClick={() => { go(); }} />}
        size={EmptyStateSize.Inline}
      />`;

    expect(listEmptyStateTags(source)).toHaveLength(1);
    expect(findHandSizedEmptyStates(source)).toEqual([]);
  });

  test("finds a padding or class handed to the state", () => {
    expect(
      findHandSizedEmptyStates(`<EmptyState id="x" paddingClassName="py-4" />`),
    ).toHaveLength(1);
    expect(
      findHandSizedEmptyStates(`<EmptyState id="x" className="pt-24" />`),
    ).toHaveLength(1);
    expect(
      findHandSizedEmptyStates(
        `<EmptyState id="x" paddingClassName={PADDING} />`,
      ),
    ).toHaveLength(1);
    expect(
      findHandSizedEmptyStates(`<EmptyState id="x" iconClassName="h-10" />`),
    ).toEqual([]);
    expect(
      findHandSizedEmptyStates(
        `<EmptyState id="x" description={<span className="block">Hi</span>} />`,
      ),
    ).toEqual([]);
  });

  test("finds a box that takes the state's room back", () => {
    expect(
      findNegativeMarginWrappers(
        `<div className="-my-28">\n<EmptyState id="x" />`,
      ),
    ).toHaveLength(1);
    expect(
      findNegativeMarginWrappers(
        `<div className={zoom ? "-my-16 select-none" : "-my-16"}>\n<EmptyState id="x" />`,
      ),
    ).toHaveLength(1);
    expect(
      findNegativeMarginWrappers(
        `<div className="sm:-mt-8">\n{isEmpty ? (\n<EmptyState id="x" />`,
      ),
    ).toHaveLength(1);
  });

  test("leaves a box with no negative margin, or one around something else", () => {
    expect(
      findNegativeMarginWrappers(
        `<div className="my-4 select-none">\n<EmptyState id="x" />`,
      ),
    ).toEqual([]);
    expect(
      findNegativeMarginWrappers(
        `<span className="-my-1 inline-flex">x</span>\n<div>\n<EmptyState id="x" />`,
      ),
    ).toEqual([]);
  });
});

describe("EmptyStateSizeGuard: every screen", () => {
  const sources: Array<{ file: string; source: string }> = listScanRoots(
    REPOSITORY_ROOT,
  )
    .flatMap((root: string): Array<string> => {
      return listSourceFiles(root);
    })
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    })
    .map((file: string): { file: string; source: string } => {
      return { file: relative(file), source: fs.readFileSync(file, "utf8") };
    })
    .filter((entry: { file: string; source: string }): boolean => {
      return entry.source.includes("<EmptyState");
    });

  test("finds the screens that draw an empty state", () => {
    expect(sources.length).toBeGreaterThan(40);
  });

  test("no empty state is handed a padding of its own: it takes a size", () => {
    const offenders: Array<string> = sources.flatMap(
      (entry: { file: string; source: string }): Array<string> => {
        return findHandSizedEmptyStates(entry.source).map(
          (tag: string): string => {
            return `${entry.file}: ${tag.split("\n")[0]?.trim()} ... ${
              getTopLevelProps(tag).match(HAND_SIZING_PROP)?.[1]
            }`;
          },
        );
      },
    );

    expect(offenders).toEqual([]);
  });

  test("no empty state is wrapped in a negative margin to take its room back", () => {
    const offenders: Array<string> = sources.flatMap(
      (entry: { file: string; source: string }): Array<string> => {
        return findNegativeMarginWrappers(entry.source).map(
          (wrapper: string): string => {
            return `${entry.file}: ${wrapper.split("\n")[0]?.trim()}`;
          },
        );
      },
    );

    expect(offenders).toEqual([]);
  });
});
