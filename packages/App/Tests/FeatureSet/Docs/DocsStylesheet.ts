import fs from "fs";
import path from "path";

/*
 * The docs' stylesheet (Static/css/style.css), read as its rules: what
 * RightToLeftDocsLayout pins about a right-to-left page, and what
 * DiagramReadingDirection's model of how a diagram's lines are laid out
 * rests on. One reader, so the two read the stylesheet the same way.
 */

export const DOCS_STYLESHEET: string = fs.readFileSync(
  path.resolve(__dirname, "../../../FeatureSet/Docs/Static/css/style.css"),
  "utf8",
);

export interface CssRule {
  selectors: Array<string>;
  declarations: Array<[string, string]>;
}

const CSS_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const CSS_RULE: RegExp = /([^{}]+)\{([^{}]*)\}/g;
const WHITESPACE_RUN: RegExp = /\s+/g;

// Every rule with a declaration block, those inside @media and @supports too.
export function readCssRules(css: string): Array<CssRule> {
  return Array.from(css.replace(CSS_COMMENT, "").matchAll(CSS_RULE)).map(
    (match: RegExpMatchArray): CssRule => {
      return {
        selectors: (match[1] as string)
          .split(",")
          .map((selector: string): string => {
            return selector.trim().replace(WHITESPACE_RUN, " ");
          }),
        declarations: (match[2] as string)
          .split(";")
          .map((declaration: string): string => {
            return declaration.trim();
          })
          .filter((declaration: string): boolean => {
            return declaration.length > 0;
          })
          .map((declaration: string): [string, string] => {
            const colon: number = declaration.indexOf(":");

            return [
              declaration.slice(0, colon).trim(),
              declaration
                .slice(colon + 1)
                .trim()
                .replace(WHITESPACE_RUN, " "),
            ];
          }),
      };
    },
  );
}

// What the last of these rules for a selector sets a property to.
export function declaredIn(
  rules: Array<CssRule>,
  selector: string,
  property: string,
): string | undefined {
  let value: string | undefined = undefined;

  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) {
      continue;
    }

    for (const [name, declaredValue] of rule.declarations) {
      if (name === property) {
        value = declaredValue;
      }
    }
  }

  return value;
}
