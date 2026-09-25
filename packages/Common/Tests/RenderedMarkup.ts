import fs from "fs";
import path from "path";
import {
  LAPTOP_WIDTH_IN_PX,
  MAX_WIDTH_HIDDEN_CLASS,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  TAILWIND_BREAKPOINTS_IN_PX,
  VisibilityOptions,
  WIDE_DESKTOP_WIDTH_IN_PX,
  isDisplayUtility,
  resolveDisplay,
  splitVariants,
} from "./ResponsiveVisibility";

/*
 * Server-rendered pages under a foreign `.hidden { display: none !important }`,
 * read without a DOM.
 *
 * The Docs and the API Reference (packages/App) and the website
 * (packages/Home) render EJS on the server and load the same Tailwind Play
 * CDN as the React frontends, so they lost their desktop navigation to the
 * foreign rule the same way. Their suites render the real views and ask
 * whether an element - and every ancestor, since an element is only on screen
 * if nothing around it is hidden either - is painted at a width, with and
 * without the rule. App's and Home's jest run in node, with no DOM, so this
 * holds just enough of an HTML reader to walk up the rendered tree, and the
 * class-attribute checks the three suites share.
 *
 * Node built-ins and ./ResponsiveVisibility only: Home imports this by a
 * relative path from outside its own package, where nothing else of Common's
 * resolves.
 */

export const WITH_FOREIGN_HIDDEN_RULE: VisibilityOptions = {
  withForeignHiddenRule: true,
};

// Every breakpoint's first pixel and the pixel before it, plus real devices.
export const WIDTHS_IN_PX: Array<number> = Array.from(
  new Set<number>([
    PHONE_WIDTH_IN_PX,
    TABLET_WIDTH_IN_PX,
    LAPTOP_WIDTH_IN_PX,
    WIDE_DESKTOP_WIDTH_IN_PX,
    ...Object.values(TAILWIND_BREAKPOINTS_IN_PX).flatMap(
      (breakpointInPx: number): Array<number> => {
        return [breakpointInPx - 1, breakpointInPx];
      },
    ),
  ]),
).sort((a: number, b: number): number => {
  return a - b;
});

export function widthsFrom(breakpoint: string): Array<number> {
  return WIDTHS_IN_PX.filter((width: number): boolean => {
    return width >= TAILWIND_BREAKPOINTS_IN_PX[breakpoint]!;
  });
}

export function widthsBelow(breakpoint: string): Array<number> {
  return WIDTHS_IN_PX.filter((width: number): boolean => {
    return width < TAILWIND_BREAKPOINTS_IN_PX[breakpoint]!;
  });
}

/*
 * Just enough of the rendered tree to walk up it: opening and closing tags
 * and the stack of open elements. The contents of <script> and <style> are
 * text, not markup.
 */
export interface RenderedElement {
  tagName: string;
  // The raw attribute text of the opening tag.
  attributes: string;
  // Where its content starts and ends (equal when it was never closed).
  contentStart: number;
  contentEnd: number;
  // Every element it sits inside, nearest first.
  ancestors: Array<RenderedElement>;
}

export interface RenderedPage {
  html: string;
  elements: Array<RenderedElement>;
}

const VOID_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "script",
  "style",
  "textarea",
  "title",
]);

const TAG_PATTERN: RegExp =
  /<!--[\s\S]*?-->|<![^>]*>|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?)*)\s*(\/?)>/g;

export function parsePage(html: string): RenderedPage {
  const lowerCaseHtml: string = html.toLowerCase();
  const elements: Array<RenderedElement> = [];
  const open: Array<RenderedElement> = [];
  const pattern: RegExp = new RegExp(TAG_PATTERN.source, "g");
  let match: RegExpExecArray | null = pattern.exec(html);

  for (; match !== null; match = pattern.exec(html)) {
    const closingTagName: string | undefined = match[1];
    const openingTagName: string | undefined = match[2];

    if (closingTagName) {
      const tagName: string = closingTagName.toLowerCase();

      for (let index: number = open.length - 1; index >= 0; index--) {
        if (open[index]!.tagName === tagName) {
          open[index]!.contentEnd = match.index;
          open.length = index;
          break;
        }
      }

      continue;
    }

    if (!openingTagName) {
      // A comment or the doctype.
      continue;
    }

    const element: RenderedElement = {
      tagName: openingTagName.toLowerCase(),
      attributes: match[3] || "",
      contentStart: pattern.lastIndex,
      contentEnd: pattern.lastIndex,
      ancestors: open.slice().reverse(),
    };
    elements.push(element);

    if (RAW_TEXT_ELEMENTS.has(element.tagName)) {
      const closingTagAt: number = lowerCaseHtml.indexOf(
        `</${element.tagName}`,
        pattern.lastIndex,
      );
      element.contentEnd = closingTagAt === -1 ? html.length : closingTagAt;
      pattern.lastIndex = element.contentEnd;
      continue;
    }

    if (!VOID_ELEMENTS.has(element.tagName) && match[4] !== "/") {
      open.push(element);
    }
  }

  return { html: html, elements: elements };
}

// An attribute's value, "" for a bare boolean attribute, null when absent.
export function attributeOf(
  element: RenderedElement,
  name: string,
): string | null {
  const valued: RegExpMatchArray | null = element.attributes.match(
    new RegExp(
      `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>=\`]+))`,
    ),
  );

  if (valued) {
    return valued[1] ?? valued[2] ?? valued[3] ?? "";
  }

  return new RegExp(`(?:^|\\s)${name}(?=\\s|$)`).test(element.attributes)
    ? ""
    : null;
}

export function classOf(element: RenderedElement): string {
  return attributeOf(element, "class") || "";
}

export function textOf(page: RenderedPage, element: RenderedElement): string {
  return page.html
    .slice(element.contentStart, element.contentEnd)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasAncestor(
  element: RenderedElement,
  predicate: (ancestor: RenderedElement) => boolean,
): boolean {
  return element.ancestors.some(predicate);
}

export function describeTag(element: RenderedElement): string {
  return `<${element.tagName} class="${classOf(element)}">`;
}

/*
 * The one element a test is about; any other count is a broken selector,
 * and the error lists what it matched.
 */
export function only(
  page: RenderedPage,
  predicate: (element: RenderedElement) => boolean,
): RenderedElement {
  const matches: Array<RenderedElement> = page.elements.filter(predicate);

  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one matching element, found ${matches.length}: [${matches
        .map(describeTag)
        .join(", ")}]`,
    );
  }

  return matches[0]!;
}

// Whether the class attribute hides with `max-<bp>:hidden`, the fix's form.
export function hasMaxWidthHide(classAttribute: string): boolean {
  return classAttribute.split(/\s+/).some((token: string): boolean => {
    return MAX_WIDTH_HIDDEN_CLASS.test(token);
  });
}

/**
 * The class attribute as it was before the fix: every `max-<bp>:hidden` put
 * back to the bare `hidden` it replaced. No server-rendered view used a
 * max-width hide before, so this rebuilds the old strings exactly.
 */
export function toPreFixClassAttribute(classAttribute: string): string {
  return classAttribute
    .split(/\s+/)
    .map((token: string): string => {
      return MAX_WIDTH_HIDDEN_CLASS.test(token) ? "hidden" : token;
    })
    .join(" ");
}

export interface PaintOptions extends VisibilityOptions {
  // Resolve the pre-fix spelling of every class attribute on the way up.
  preFix?: boolean | undefined;
}

/*
 * Whether the element is painted at this width, in describeVisibility's
 * words, naming the element that takes it off the screen when it is not.
 */
export function describePainting(
  element: RenderedElement,
  widthInPx: number,
  options?: PaintOptions,
): string {
  const suffix: string = options?.withForeignHiddenRule
    ? " with a foreign .hidden rule on the page"
    : "";

  for (const node of [element, ...element.ancestors]) {
    const classAttribute: string = options?.preFix
      ? toPreFixClassAttribute(classOf(node))
      : classOf(node);

    if (resolveDisplay(classAttribute, widthInPx, options) === "hidden") {
      return `hidden at ${widthInPx}px${suffix} by <${node.tagName} class="${classAttribute}">`;
    }
  }

  return `visible at ${widthInPx}px${suffix}`;
}

export function visibleWithRule(widthInPx: number): string {
  return `visible at ${widthInPx}px with a foreign .hidden rule on the page`;
}

export function visibleOnCleanPage(widthInPx: number): string {
  return `visible at ${widthInPx}px`;
}

// The element on the way up whose class the fix rewrote.
export function convertedElementAround(
  element: RenderedElement,
): RenderedElement {
  const converted: RenderedElement | undefined = [
    element,
    ...element.ancestors,
  ].find((node: RenderedElement): boolean => {
    return hasMaxWidthHide(classOf(node));
  });

  if (!converted) {
    throw new Error(
      `nothing from ${describeTag(element)} up carries a max-<bp>:hidden`,
    );
  }

  return converted;
}

/*
 * A class attribute that carries the bare `hidden` and a variant display
 * utility that is meant to show the element again (lg:block, max-md:flex,
 * group-hover:flex ...): exactly what the foreign rule breaks. A lone
 * `hidden` that a script toggles is fine - the rule can only hide more.
 */
export function leansOnBareHidden(classAttribute: string): boolean {
  const tokens: Array<string> = classAttribute.split(/\s+/).filter(Boolean);

  return (
    tokens.includes("hidden") &&
    tokens.some((token: string): boolean => {
      const parts: Array<string> = splitVariants(token);
      const utility: string = parts[parts.length - 1]!;

      return (
        parts.length > 1 && utility !== "hidden" && isDisplayUtility(utility)
      );
    })
  );
}

/*
 * ---------------------------------------------------------------------------
 * Scripts that touch a converted element.
 *
 * The fix moved some elements' small-screen hide from the bare `hidden` to
 * `max-<bp>:hidden`. A script that still adds, removes or toggles `hidden` on
 * one of them would stop working without a sound: removing a class the
 * element no longer carries does nothing, and adding it back brings the
 * foreign rule's target with it. These find such writes by the element's id:
 * every variable the page's scripts look the element up into, and the lookup
 * expression itself.
 * ---------------------------------------------------------------------------
 */

export interface ElementScriptWrites {
  // The variables a script assigns the element to, e.g. `tocPanel`.
  variables: Array<string>;
  // Statements that add, remove, toggle or assign a bare `hidden` on it.
  bareHiddenWrites: Array<string>;
}

// A quoted JavaScript string: its content is group 2.
const STRING_LITERAL: RegExp = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whether any string literal in the code has `hidden` as a whole class token.
function namesBareHidden(code: string): boolean {
  return Array.from(code.matchAll(STRING_LITERAL)).some(
    (literal: RegExpMatchArray): boolean => {
      return literal[2]!.split(/\s+/).includes("hidden");
    },
  );
}

export function scriptWritesToElement(
  html: string,
  elementId: string,
): ElementScriptWrites {
  const id: string = escapeForPattern(elementId);
  // `document.getElementById('toc-panel')` or `document.querySelector('#toc-panel')`.
  const lookup: string = `document\\s*\\.\\s*(?:getElementById\\(\\s*["'\`]${id}["'\`]\\s*\\)|querySelector\\(\\s*["'\`]#${id}["'\`]\\s*\\))`;

  const variables: Array<string> = Array.from(
    new Set<string>(
      Array.from(
        html.matchAll(
          new RegExp(`(?<![\\w$.])([A-Za-z_$][\\w$]*)\\s*=\\s*${lookup}`, "g"),
        ),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ),
  );

  const handles: Array<string> = [
    ...variables.map((variable: string): string => {
      return `(?<![\\w$.])${escapeForPattern(variable)}`;
    }),
    lookup,
  ];

  // What follows a handle and hands class text to the element.
  const writes: Array<string> = [
    "\\s*\\.\\s*classList\\s*\\.\\s*(?:add|remove|toggle|replace)\\s*\\([^)]*\\)",
    // `=` or `+=`, not a `==` comparison.
    "\\s*\\.\\s*className\\s*\\+?=(?!=)\\s*[^;\\n]*",
    "\\s*\\.\\s*setAttribute\\s*\\(\\s*[\"'`]class[\"'`]\\s*,[^)]*\\)",
  ];

  const bareHiddenWrites: Array<string> = handles.flatMap(
    (handle: string): Array<string> => {
      return writes.flatMap((write: string): Array<string> => {
        return Array.from(
          html.matchAll(new RegExp(`${handle}${write}`, "g")),
          (match: RegExpMatchArray): string => {
            return match[0];
          },
        ).filter(namesBareHidden);
      });
    },
  );

  return { variables: variables, bareHiddenWrites: bareHiddenWrites };
}

/*
 * ---------------------------------------------------------------------------
 * The critical CSS a page carries before the Play CDN has generated its own.
 * ---------------------------------------------------------------------------
 */

/*
 * CSS rules of the form `@media <condition> { .<class> { <declarations> } }`,
 * keyed by the (unescaped) class they target.
 */
export interface MediaClassRule {
  media: string;
  declarations: string;
}

export function mediaClassRules(css: string): Map<string, MediaClassRule> {
  const rules: Map<string, MediaClassRule> = new Map<string, MediaClassRule>();
  const text: string = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const mediaPattern: RegExp = /@media\s+([^{]+)\{/g;
  let media: RegExpExecArray | null = mediaPattern.exec(text);

  for (; media !== null; media = mediaPattern.exec(text)) {
    let depth: number = 1;
    let index: number = mediaPattern.lastIndex;

    while (index < text.length && depth > 0) {
      if (text[index] === "{") {
        depth++;
      } else if (text[index] === "}") {
        depth--;
      }
      index++;
    }

    const body: string = text.slice(mediaPattern.lastIndex, index - 1);

    for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of rule[1]!.split(",")) {
        const classSelector: RegExpMatchArray | null = selector
          .trim()
          .match(/^\.((?:\\.|[\w-])+)$/);

        if (classSelector) {
          rules.set(classSelector[1]!.replace(/\\(.)/g, "$1"), {
            media: media[1]!.replace(/\s+/g, " ").trim(),
            declarations: rule[2]!.replace(/\s+/g, " ").trim(),
          });
        }
      }
    }

    mediaPattern.lastIndex = index;
  }

  return rules;
}

// Every .ejs template under a directory.
export function listTemplates(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listTemplates(entryPath);
      }

      return entry.name.endsWith(".ejs") ? [entryPath] : [];
    });
}

/*
 * A class token that hides below a screen, in any spelling: max-md:hidden,
 * max-[900px]:hidden, dark:max-lg:hidden ...
 */
export const MAX_WIDTH_HIDE_TOKEN: RegExp = /(?:^|:)max-[^:]+:(?:.*:)?hidden$/;

// Every class token in a directory's templates that hides below a breakpoint.
export function maxWidthHiddenTokensInViews(viewsRoot: string): Set<string> {
  const tokens: Set<string> = new Set<string>();

  for (const template of listTemplates(viewsRoot)) {
    for (const token of fs.readFileSync(template, "utf8").split(/[\s"'`<>]+/)) {
      if (MAX_WIDTH_HIDE_TOKEN.test(token)) {
        tokens.add(token);
      }
    }
  }

  return tokens;
}
