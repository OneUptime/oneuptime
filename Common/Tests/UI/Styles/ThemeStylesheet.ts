import fs from "fs";
import path from "path";

/*
 * A reader for Common/UI/Styles/Theme.css, shared by the suites that hold the
 * stylesheet to a contract.
 *
 * jsdom's CSS engine is not used for this on purpose. Theme.css is written for
 * a real browser -- :is(), color-mix(), space-separated rgb() with a percent
 * alpha -- and jsdom's parser drops what it cannot model, silently, which
 * would turn a missing rule and an unparsed one into the same green test.
 * Reading the file directly keeps a failure meaning what it says.
 */

const THEME_STYLESHEET_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "UI",
  "Styles",
  "Theme.css",
);

export interface StyleRule {
  /** Normalised, one entry per comma-separated selector in the prelude. */
  selectors: Array<string>;
  declarations: Record<string, string>;
  /** Source order, which decides the winner between equal specificities. */
  index: number;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseDeclarations(body: string): Record<string, string> {
  const declarations: Record<string, string> = {};

  for (const declaration of body.split(";")) {
    const separatorAt: number = declaration.indexOf(":");

    if (separatorAt === -1) {
      continue;
    }

    const property: string = normalizeWhitespace(
      declaration.slice(0, separatorAt),
    );
    const value: string = normalizeWhitespace(
      declaration.slice(separatorAt + 1),
    );

    if (property) {
      declarations[property] = value;
    }
  }

  return declarations;
}

/*
 * Only top-level rules are collected. Everything asserted against this lives
 * at the top level of the sheet; at-rules (@media, @keyframes) are skipped
 * whole so their inner blocks cannot be mistaken for one.
 */
export function parseTopLevelRules(css: string): Array<StyleRule> {
  const withoutComments: string = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Array<StyleRule> = [];

  let prelude: string = "";
  let body: string = "";
  let depth: number = 0;

  for (const character of withoutComments) {
    if (character === "{") {
      depth++;

      if (depth === 1) {
        continue;
      }
    }

    if (character === "}") {
      depth--;

      if (depth === 0) {
        const selectorText: string = normalizeWhitespace(prelude);

        if (selectorText && !selectorText.startsWith("@")) {
          rules.push({
            selectors: selectorText.split(",").map(normalizeWhitespace),
            declarations: parseDeclarations(body),
            index: rules.length,
          });
        }

        prelude = "";
        body = "";
        continue;
      }
    }

    if (depth === 0) {
      prelude += character;
    } else {
      body += character;
    }
  }

  return rules;
}

export const THEME_RULES: Array<StyleRule> = parseTopLevelRules(
  fs.readFileSync(THEME_STYLESHEET_PATH, "utf8"),
);

export function rulesFor(selector: string): Array<StyleRule> {
  return THEME_RULES.filter((rule: StyleRule): boolean => {
    return rule.selectors.includes(selector);
  });
}

/*
 * The last declaration wins. Every rule these suites reach for carries no
 * !important and no specificity beyond one class plus one pseudo-class, so
 * source order is the whole tiebreak.
 */
export function declaredValue(
  selector: string,
  property: string,
): string | undefined {
  const matching: Array<StyleRule> = rulesFor(selector).filter(
    (rule: StyleRule): boolean => {
      return rule.declarations[property] !== undefined;
    },
  );

  return matching[matching.length - 1]?.declarations[property];
}

/**
 * Every selector in the sheet that gives `property` exactly `value` -- the way
 * a suite asks the shipped stylesheet what it actually covers, rather than
 * restating the answer as a literal and testing itself.
 */
export function selectorsDeclaring(
  property: string,
  value: string,
): Array<string> {
  const selectors: Array<string> = [];

  for (const rule of THEME_RULES) {
    if (rule.declarations[property] !== value) {
      continue;
    }

    selectors.push(...rule.selectors);
  }

  return selectors;
}
