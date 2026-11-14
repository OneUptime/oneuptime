// UX rule: Docs/ux/README.md#in-every-language
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { removeMarkupFromText } from "../../Types/HtmlMarkup";
import { listSourceFiles, toRelativePath } from "../ForeignHiddenRuleGuard";
import {
  LEFTWARDS_ARROW,
  RIGHTWARDS_ARROW,
  withArrowsDecoded,
} from "../Helpers/PathArrows";

/*
 * AN ARROW A COMPONENT DRAWS POINTS THE WAY ITS LINE IS READ (#7666).
 *
 * A browser never turns "→" round. The locale files write their arrows the
 * way each language reads (PathArrowsInRightToLeftSentences), but an arrow
 * a component wrote into its own markup or text - between two state names,
 * two percentages or two times, after a link's words - was "→" on an
 * Arabic or Persian page too, and pointed back at the step before. A
 * component takes its arrow from the shared helper instead: DirectionArrow
 * (Common/UI/Components/DirectionArrow) in markup, and getArrowOn,
 * getArrowBack, joinWithArrowsOn or joinWithArrowsInDirection
 * (Common/Types/DirectionArrow) in text.
 *
 * This guard reads every module of the Dashboard and of the shared UI and
 * fails on "→" or "←" - written as itself, as &rarr; or &larr;, or as an
 * escape - in JSX text or in a string, unless:
 *
 *   - the string is one the Dashboard's locale files translate (a key of
 *     en.json, or the English of a plural's form): each language writes its
 *     own arrows there, and PathArrowsInRightToLeftSentences holds them;
 *   - the arrow stands between two Latin letters of the same string, with
 *     nothing but spaces and signs between them ("Settings → Members",
 *     "**Host → Configure**", '"Upload an app" → "Upload a custom app"'):
 *     the bidi algorithm draws it from the left, between the two words it
 *     joins, on a page read either way;
 *   - the place it is written in is KEPT, with the reason its arrows are
 *     right as written: code, an arrow key's name, text that only reads
 *     arrows, a file that is not a page.
 *
 * Comments are not read. KEPT only shrinks: an entry that no longer
 * matches an arrow fails too.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");

// The modules a component draws its words from: the Dashboard's and the shared UI's.
const SCANNED_ROOTS: ReadonlyArray<string> = [
  "App/FeatureSet/Dashboard/src",
  "Common/UI",
];

const DASHBOARD_ENGLISH: string =
  "App/FeatureSet/Dashboard/src/Locales/en.json";

export interface WrittenArrow {
  // The module, from packages/.
  file: string;
  line: number;
  /*
   * Where in the module the text is: the declarations round it, outermost
   * first, and the JSX attribute it fills -
   * "getServicePortsLabel › target", "Banner › <Link to>".
   */
  place: string;
  arrow: string;
  // The text round the arrow, as the module writes it.
  context: string;
}

export interface KeptPlace {
  file: string;
  place: string;
  why: string;
}

/*
 * Places whose arrows are right as written. Each with its reason; an
 * arrow drawn in a line of a page has none.
 */
export const KEPT: ReadonlyArray<KeptPlace> = [
  {
    file: "App/FeatureSet/Dashboard/src/Components/AI/AiOffSummary.tsx",
    place: "keepMenuPathArrowsInLine",
    why: "It reads the arrows a translated menu path writes, to keep each one on the line of the step after it. It draws none of its own.",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Components/AIChat/Export/PdfText.ts",
    place: "TRANSLITERATIONS",
    why: 'The PDF export\'s table of characters its font cannot draw: it writes "->" and "<-" for the arrows an answer holds, and draws none.',
  },
  {
    file: "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView.tsx",
    place: "TREND_ARROWS",
    why: "A flat trend's arrow means a fixed side: time, which runs left to right on the tile's sparkline in every language. Icon keeps an arrow on such a timeline as it is too (isMirroredRightToLeft={false}).",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Pages/Logs/Settings/ScrubRules.tsx",
    place: "documentationMarkdown",
    why: "English Markdown help. MarkdownViewer lays it out the way most of its letters read, left to right on every page; its arrow leads from a quoted value to what it becomes.",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Pages/Traces/Settings/Pipelines.tsx",
    place: "documentationMarkdown",
    why: "English Markdown help. MarkdownViewer lays it out the way most of its letters read, left to right on every page; its arrows lead from a status code to what it becomes.",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Utils/Measurement/MeasurementSetup.ts",
    place: "getMeasurementSummaryText",
    why: "The measurements list's CSV export, in English like the rest of it: a file, not a line of a page. The page draws MeasurementSummaryElement.",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesOpenShiftResources.ts",
    place: "getServicePortsLabel › target",
    why: "A Service's port notation (443→8443/TCP), read as written: in a language read from the right it is set apart to read from the left (LRI ... PDI), as code is.",
  },
  {
    file: "Common/UI/Components/KeyboardShortcut/KeyboardKey.ts",
    place: "KeyboardKeyUtil › getDisplayKey",
    why: "The names of the ← and → arrow keys: the key is the arrow, the same on every keyboard.",
  },
];

// A value's place in a translated text: one piece, neither a word nor a sign.
const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;

/*
 * What ends the look either way from an arrow: a letter, a digit, and a
 * mark with a direction of its own (LRM, RLM, ALM, an isolate's mark).
 */
const STOP: RegExp = /^[\p{L}\p{N}\u{200E}\u{200F}\u{061C}\u{2066}-\u{2069}]$/u;

const LATIN_LETTER: RegExp = /^\p{Script=Latin}$/u;

// A template's value, where a failure shows the text round an arrow.
const TEMPLATE_VALUE: string = "${…}";

/*
 * The text as a page draws it: arrows decoded, each value one digit, and
 * the HTML tags a string may hold (Markdown, an email's template) taken out
 * through the shared walk, which keeps a "<" that starts no tag as text.
 */
const asDrawn: (text: string) => string = (text: string): string => {
  return removeMarkupFromText(
    withArrowsDecoded(text).replace(PLACEHOLDER, "0"),
  );
};

// The first thing that is not a sign, from `index` on in the direction of `step`.
const firstStopFrom: (
  characters: ReadonlyArray<string>,
  index: number,
  step: 1 | -1,
) => string = (
  characters: ReadonlyArray<string>,
  index: number,
  step: 1 | -1,
): string => {
  for (let at: number = index; at >= 0 && at < characters.length; at += step) {
    const character: string = characters[at] as string;

    if (STOP.test(character)) {
      return character;
    }
  }

  return "";
};

/*
 * Whether the arrow at `index` stands between two Latin letters, with
 * nothing but spaces and signs between: drawn from the left either way.
 */
export const isBetweenLatinWords: (
  characters: ReadonlyArray<string>,
  index: number,
) => boolean = (characters: ReadonlyArray<string>, index: number): boolean => {
  return (
    LATIN_LETTER.test(firstStopFrom(characters, index - 1, -1)) &&
    LATIN_LETTER.test(firstStopFrom(characters, index + 1, 1))
  );
};

const isArrow: (character: string) => boolean = (
  character: string,
): boolean => {
  return character === RIGHTWARDS_ARROW || character === LEFTWARDS_ARROW;
};

const collapsed: (text: string) => string = (text: string): string => {
  return text.replace(/\s+/g, " ").trim();
};

// The declarations round a node, outermost first, and the JSX attribute it fills.
const getPlace: (node: ts.Node) => string = (node: ts.Node): string => {
  const names: Array<string> = [];
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isJsxAttribute(current)) {
      const element: ts.Node = current.parent.parent;
      const tag: string =
        ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)
          ? element.tagName.getText()
          : "?";

      names.unshift(`<${tag} ${current.name.getText()}>`);
    } else if (
      (ts.isVariableDeclaration(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isClassDeclaration(current)) &&
      current.name
    ) {
      names.unshift(current.name.getText());
    }

    current = current.parent;
  }

  return names.join(" › ") || "(module)";
};

/*
 * Every arrow in a module's JSX text and strings that is neither in a text
 * the locale files translate (`translated`) nor between two Latin words.
 */
export const findWrittenArrows: (data: {
  file: string;
  source: string;
  translated: ReadonlySet<string>;
}) => Array<WrittenArrow> = (data: {
  file: string;
  source: string;
  translated: ReadonlySet<string>;
}): Array<WrittenArrow> => {
  const found: Array<WrittenArrow> = [];
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    data.file,
    data.source,
    ts.ScriptTarget.Latest,
    true,
    data.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /*
   * A piece of a template has a value before it, after it or both: it is
   * never a text the locale files hold whole, and the context shows each
   * value as ${…}.
   */
  const read: (data: {
    node: ts.Node;
    text: string;
    hasValueBefore?: boolean;
    hasValueAfter?: boolean;
  }) => void = (piece: {
    node: ts.Node;
    text: string;
    hasValueBefore?: boolean;
    hasValueAfter?: boolean;
  }): void => {
    const characters: Array<string> = Array.from(asDrawn(piece.text));

    if (!characters.some(isArrow)) {
      return;
    }

    const isTemplatePiece: boolean = Boolean(
      piece.hasValueBefore || piece.hasValueAfter,
    );

    if (
      !isTemplatePiece &&
      (data.translated.has(piece.text) ||
        data.translated.has(collapsed(piece.text)))
    ) {
      return;
    }

    characters.forEach((character: string, index: number): void => {
      if (!isArrow(character) || isBetweenLatinWords(characters, index)) {
        return;
      }

      const start: number = Math.max(0, index - 30);
      const end: number = index + 31;
      const before: string =
        piece.hasValueBefore && start === 0 ? TEMPLATE_VALUE : "";
      const after: string =
        piece.hasValueAfter && end >= characters.length ? TEMPLATE_VALUE : "";

      found.push({
        file: data.file,
        line:
          sourceFile.getLineAndCharacterOfPosition(
            piece.node.getStart(sourceFile),
          ).line + 1,
        place: getPlace(piece.node),
        arrow: character,
        context: collapsed(
          before + characters.slice(start, end).join("") + after,
        ),
      });
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      read({ node, text: node.getText(sourceFile) });
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      read({ node, text: node.text });
    } else if (ts.isTemplateHead(node)) {
      read({ node, text: node.text, hasValueAfter: true });
    } else if (ts.isTemplateMiddle(node)) {
      read({
        node,
        text: node.text,
        hasValueBefore: true,
        hasValueAfter: true,
      });
    } else if (ts.isTemplateTail(node)) {
      read({ node, text: node.text, hasValueBefore: true });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
};

const describeArrow: (arrow: WrittenArrow) => string = (
  arrow: WrittenArrow,
): string => {
  return `${arrow.file}:${arrow.line} (${arrow.place}): ${arrow.arrow} | ${arrow.context}`;
};

const isKept: (arrow: WrittenArrow, kept: KeptPlace) => boolean = (
  arrow: WrittenArrow,
  kept: KeptPlace,
): boolean => {
  return arrow.file === kept.file && arrow.place === kept.place;
};

// The texts the Dashboard's locale files translate: en.json's keys, and each plural form's English.
const readTranslatedTexts: () => Set<string> = (): Set<string> => {
  const english: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(PACKAGES, DASHBOARD_ENGLISH), "utf8"),
  ) as Record<string, string>;

  return new Set<string>([...Object.keys(english), ...Object.values(english)]);
};

const NONE: ReadonlySet<string> = new Set<string>();

const arrowsIn: (
  source: string,
  translated?: ReadonlySet<string>,
) => Array<string> = (
  source: string,
  translated?: ReadonlySet<string>,
): Array<string> => {
  return findWrittenArrows({
    file: "Example.tsx",
    source,
    translated: translated || NONE,
  }).map((arrow: WrittenArrow): string => {
    return `${arrow.line} ${arrow.place}: ${arrow.arrow} | ${arrow.context}`;
  });
};

describe("the arrow check, on small modules", () => {
  test("finds an arrow after a link's words, between two values and in a text a template builds", () => {
    expect(
      arrowsIn(
        [
          "const Link = () => {",
          "  return <a>{t('Show on map')} <span aria-hidden={true}>→</span></a>;",
          "};",
          "const Range = () => {",
          "  return <p>{start}<span>&rarr;</span>{end}</p>;",
          "};",
          "const title: string = `${from} → ${to}`;",
          'const back: string = "\\u2190 " + name;',
        ].join("\n"),
      ),
    ).toEqual([
      "2 Link: → | →",
      "5 Range: → | →",
      "7 title: → | ${…} → ${…}",
      "8 back: ← | ←",
    ]);
  });

  test("finds an arrow beside a value's place, in a text no locale file holds", () => {
    expect(
      arrowsIn('const label: string = t("{{action}} →", { action });'),
    ).toEqual(["1 label: → | 0 →"]);
  });

  test("leaves an arrow between two Latin words: drawn from the left either way", () => {
    expect(
      arrowsIn(
        [
          "const one: string = 'Open Settings → Members';",
          "const two: string = '**Host → Configure → System**';",
          'const three: string = \'Click "Upload an app" → "Upload a custom app"\';',
          "const four: string = 'oneuptime.label.<dimension>=<value>  →  becomes a label';",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("finds one beside a digit or a value: not a Latin word", () => {
    expect(
      arrowsIn(
        [
          "const one: string = 'for example `200` → Ok';",
          "const two: string = 'Severity → {{value}}';",
        ].join("\n"),
      ),
    ).toEqual(["1 one: → | for example `200` → Ok", "2 two: → | Severity → 0"]);
  });

  test("leaves a text the locale files translate, and a comment", () => {
    expect(
      arrowsIn(
        [
          "// Declared → Acknowledged",
          "/* start → end */",
          'const all: string = t("All metrics →");',
          "const Plural = () => {",
          '  return translatePlural({ one: "View all {{count}} interface →", other: "View all {{count}} interfaces →" }, count);',
          "};",
          "const Text = () => {",
          "  return <p>",
          "    View all →",
          "  </p>;",
          "};",
        ].join("\n"),
        new Set<string>([
          "All metrics →",
          "View all {{count}} interfaces →",
          "View all {{count}} interface →",
          "View all →",
        ]),
      ),
    ).toEqual([]);
  });

  test("names the place: the declarations round the text, and the JSX attribute it fills", () => {
    expect(
      arrowsIn(
        [
          "export class KeyName {",
          "  public static get(key: string): string {",
          '    return key === "ArrowRight" ? "→" : key;',
          "  }",
          "}",
          "export function ports(list: Array<number>): string {",
          "  return list.map((port: number): string => {",
          "    const target: string = `→${port}`;",
          "    return target;",
          "  }).join();",
          "}",
          "const Help = () => {",
          '  return <Banner title={"Next →"} />;',
          "};",
        ].join("\n"),
      ),
    ).toEqual([
      "3 KeyName › get: → | →",
      "8 ports › target: → | →${…}",
      "13 Help › <Banner title>: → | Next →",
    ]);
  });
});

/*
 * A module that may write an arrow: as itself, as an entity, or as an
 * escape. Only those are parsed.
 */
const MAY_WRITE_AN_ARROW: RegExp = /[→←]|&(?:r|l)arr;|&#|\\u/;

describe("an arrow written into a Dashboard or shared UI component", () => {
  const arrows: Array<WrittenArrow> = [];

  beforeAll(() => {
    const translated: Set<string> = readTranslatedTexts();

    for (const root of SCANNED_ROOTS) {
      for (const file of listSourceFiles(path.join(PACKAGES, root))) {
        const source: string = fs.readFileSync(file, "utf8");

        if (!MAY_WRITE_AN_ARROW.test(source)) {
          continue;
        }

        arrows.push(
          ...findWrittenArrows({
            file: toRelativePath(PACKAGES, file),
            source,
            translated,
          }),
        );
      }
    }
  });

  test("the scan reads the modules: the kept places' arrows are found", () => {
    // A guard that read nothing would pass: each kept place is found.
    expect(arrows.length).toBeGreaterThanOrEqual(KEPT.length);
  });

  test("every arrow a component writes is the shared helper's, or kept with its reason", () => {
    const loose: Array<string> = arrows
      .filter((arrow: WrittenArrow): boolean => {
        return !KEPT.some((kept: KeptPlace): boolean => {
          return isKept(arrow, kept);
        });
      })
      .map(describeArrow);

    expect(loose).toEqual([]);
  });

  test("every kept place still writes an arrow, in a module that exists", () => {
    const stale: Array<string> = KEPT.filter((kept: KeptPlace): boolean => {
      return !arrows.some((arrow: WrittenArrow): boolean => {
        return isKept(arrow, kept);
      });
    }).map((kept: KeptPlace): string => {
      return `${kept.file} (${kept.place})`;
    });

    expect(stale).toEqual([]);

    for (const kept of KEPT) {
      expect(fs.existsSync(path.join(PACKAGES, kept.file))).toBe(true);
      expect(kept.why.length).toBeGreaterThan(40);
    }
  });
});
