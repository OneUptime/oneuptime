import { jest } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * TAILWIND'S RUNTIME, RUN IN JSDOM THE WAY A FRONTEND PAGE RUNS IT.
 *
 * Every frontend styles itself with the Play CDN build of Tailwind
 * (Common/Server/Static/Vendor/tailwind), so there is no stylesheet to
 * read in a test: this loads the vendored script into the test's document as
 * a classic <script>, optionally followed by the reading-direction config
 * every index.ejs loads after it (Common/UI/Styles/TailwindReadingDirection.js),
 * sets `tailwind.config` as index.ejs does, and hands back the CSS the
 * runtime writes for the class names put on the page.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const PLAY_CDN_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "Server",
  "Static",
  "Vendor",
  "tailwind",
  "tailwind-3.4.5.js",
);

export const READING_DIRECTION_SCRIPT_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "UI",
  "Styles",
  "TailwindReadingDirection.js",
);

export interface EmittedRule {
  order: number;
  // Enclosing at-rule preludes, outermost first: "@media (min-width: 640px)".
  atRules: Array<string>;
  selector: string;
  declarations: string;
}

interface PlayCdnGlobal {
  config: Record<string, unknown>;
}

const playCdn: () => PlayCdnGlobal | undefined = ():
  | PlayCdnGlobal
  | undefined => {
  return (window as unknown as { tailwind?: PlayCdnGlobal }).tailwind;
};

// The <style> the runtime appends to <head>, recognised by its license banner.
export const playCdnCss: () => string = (): string => {
  const style: HTMLStyleElement | undefined = Array.from(
    document.head.querySelectorAll("style"),
  ).find((element: HTMLStyleElement) => {
    return (element.textContent || "").includes("tailwindcss v");
  });

  return style?.textContent || "";
};

/*
 * A small reader for the stylesheet the runtime writes: comments dropped,
 * quoted strings and backslash escapes kept (Tailwind escapes `:`, `[` and
 * the like in class names), every style rule recorded with the at-rules
 * around it and its place in the sheet.
 */
export const parseStylesheet: (css: string) => Array<EmittedRule> = (
  css: string,
): Array<EmittedRule> => {
  const rules: Array<EmittedRule> = [];
  const atRules: Array<string> = [];
  let selector: string | null = null;
  let buffer: string = "";
  let index: number = 0;

  while (index < css.length) {
    const character: string = css[index]!;

    if (character === "\\") {
      buffer += css.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (character === "/" && css[index + 1] === "*") {
      const commentEnd: number = css.indexOf("*/", index + 2);
      index = commentEnd === -1 ? css.length : commentEnd + 2;
      continue;
    }

    if (character === '"' || character === "'") {
      let stringEnd: number = index + 1;

      while (stringEnd < css.length && css[stringEnd] !== character) {
        stringEnd += css[stringEnd] === "\\" ? 2 : 1;
      }

      buffer += css.slice(index, stringEnd + 1);
      index = stringEnd + 1;
      continue;
    }

    if (character === "{") {
      const prelude: string = buffer.trim();

      if (prelude.startsWith("@")) {
        atRules.push(prelude);
      } else {
        selector = prelude;
      }

      buffer = "";
    } else if (character === "}") {
      if (selector !== null) {
        rules.push({
          order: rules.length,
          atRules: [...atRules],
          selector: selector,
          declarations: buffer.trim(),
        });
        selector = null;
      } else {
        atRules.pop();
      }

      buffer = "";
    } else {
      buffer += character;
    }

    index++;
  }

  return rules;
};

/*
 * A rule's declarations as property -> value, in the order written; a
 * property written twice keeps its last value, as the browser would.
 */
export const declarationsOf: (rule: EmittedRule) => Record<string, string> = (
  rule: EmittedRule,
): Record<string, string> => {
  const declarations: Record<string, string> = {};

  for (const part of rule.declarations.split(";")) {
    const colon: number = part.indexOf(":");

    if (colon === -1) {
      continue;
    }

    const property: string = part.slice(0, colon).trim();
    const value: string = part.slice(colon + 1).trim();

    if (property) {
      declarations[property] = value;
    }
  }

  return declarations;
};

/*
 * Every property the rules for one class selector write, merged in sheet
 * order. `selector` is the escaped selector as the sheet writes it:
 * ".ml-3", ".md\\:pr-6", ".space-x-2 > :not([hidden]) ~ :not([hidden])".
 */
export const declarationsForSelector: (
  rules: Array<EmittedRule>,
  selector: string,
) => Record<string, string> = (
  rules: Array<EmittedRule>,
  selector: string,
): Record<string, string> => {
  const merged: Record<string, string> = {};

  for (const rule of rules) {
    if (rule.selector === selector) {
      Object.assign(merged, declarationsOf(rule));
    }
  }

  return merged;
};

const OriginalMutationObserver: typeof MutationObserver =
  window.MutationObserver;
const playCdnObservers: Array<MutationObserver> = [];

/*
 * The runtime keeps two MutationObservers on the document for the life of
 * the page and exposes neither; recording them as they are built lets
 * unloadPlayCdn disconnect them before jsdom tears the document down.
 */
class RecordingMutationObserver extends OriginalMutationObserver {
  public constructor(callback: MutationCallback) {
    super(callback);
    playCdnObservers.push(this);
  }
}

const runScript: (source: string) => void = (source: string): void => {
  const script: HTMLScriptElement = document.createElement("script");
  script.textContent = source;
  document.head.appendChild(script);
};

const waitUntil: (
  isDone: () => boolean,
  timeoutInMs: number,
) => Promise<void> = async (
  isDone: () => boolean,
  timeoutInMs: number,
): Promise<void> => {
  const startedAt: number = Date.now();

  while (!isDone()) {
    if (Date.now() - startedAt > timeoutInMs) {
      throw new Error("Tailwind's runtime did not write its stylesheet");
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
  }
};

export interface LoadPlayCdnOptions {
  // Load TailwindReadingDirection.js right after the runtime, as index.ejs does.
  withReadingDirection: boolean;
  // What the page sets as `tailwind.config`.
  config: Record<string, unknown>;
}

// Runs the runtime (and the reading-direction config) and sets the page's config.
export const loadPlayCdn: (options: LoadPlayCdnOptions) => Promise<void> =
  async (options: LoadPlayCdnOptions): Promise<void> => {
    window.MutationObserver = RecordingMutationObserver;

    // The runtime announces itself on console.warn; that is noise here.
    const warn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    try {
      runScript(fs.readFileSync(PLAY_CDN_PATH, "utf-8"));

      if (options.withReadingDirection) {
        runScript(fs.readFileSync(READING_DIRECTION_SCRIPT_PATH, "utf-8"));
      }
    } finally {
      warn.mockRestore();
    }

    const cdn: PlayCdnGlobal | undefined = playCdn();

    if (!cdn) {
      throw new Error(
        "the vendored Play CDN did not run: jest-environment-jsdom must execute <script> elements",
      );
    }

    cdn.config = options.config;

    await waitUntil((): boolean => {
      return playCdnCss() !== "";
    }, 30000);
  };

/*
 * Puts one element per class string on the page and resolves once the
 * runtime has written the sheet for them: the container's own sentinel
 * class shows up in the sheet in the same pass as the rest.
 */
export const addClassNames: (
  classNames: Array<string>,
) => Promise<Array<EmittedRule>> = async (
  classNames: Array<string>,
): Promise<Array<EmittedRule>> => {
  const sentinel: string = `isolation-auto`;
  const container: HTMLDivElement = document.createElement("div");
  container.className = sentinel;

  for (const className of classNames) {
    const element: HTMLDivElement = document.createElement("div");
    element.className = className;
    container.appendChild(element);
  }

  document.body.appendChild(container);

  await waitUntil((): boolean => {
    return (
      Object.keys(
        declarationsForSelector(parseStylesheet(playCdnCss()), `.${sentinel}`),
      ).length > 0
    );
  }, 30000);

  return parseStylesheet(playCdnCss());
};

// Disconnects the runtime's observers, so jsdom can tear the page down.
export const unloadPlayCdn: () => void = (): void => {
  for (const observer of playCdnObservers) {
    observer.disconnect();
  }

  window.MutationObserver = OriginalMutationObserver;
};
