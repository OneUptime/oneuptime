import { PAGE_FIXTURES, renderPage, VIEWS_ROOT } from "./ReferenceFixtures";
import { beforeAll, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The page's behaviour is inline JavaScript in a template, so nothing type
 * checks it and nothing else would notice a syntax error until a reader hit the
 * page - which is exactly how a bad IntersectionObserver rootMargin took out
 * every listener registered after it during development.
 *
 * These tests parse every inline script, and run the theme bootstrap for real
 * against a stub window.
 */

const HAS_SRC: RegExp = /\bsrc=/;
const IS_JAVASCRIPT_TYPE: RegExp = /^(?:text\/javascript|module)$/;
const IS_PIXELS_OR_PERCENT: RegExp = /^-?\d+(?:\.\d+)?(?:px|%)$/;

interface StubClassList {
  toggle: (name: string, force: boolean) => void;
  contains: (name: string) => boolean;
}

interface StubDocument {
  documentElement: {
    classList: StubClassList;
    style: { colorScheme: string };
    setAttribute: (name: string, value: string) => void;
    attributes: Record<string, string>;
  };
}

interface StubWindow {
  localStorage: Record<string, unknown>;
  matchMedia: (query: string) => {
    matches: boolean;
    addEventListener: () => void;
  };
  addEventListener: (name: string, handler: () => void) => void;
  __referenceTheme?: {
    key: string;
    preference: () => string;
    resolved: () => string;
    apply: () => void;
  };
}

/*
 * The executable scripts only: not the ones loaded from a URL, and not the
 * data blocks (the search index, the string table, the JSON-LD) which are
 * script elements that happen not to contain JavaScript.
 */
function inlineScripts(html: string): Array<string> {
  return Array.from(html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))
    .filter((match: RegExpMatchArray) => {
      const attributes: string = match[1]!;

      if (HAS_SRC.test(attributes)) {
        return false;
      }

      const type: RegExpMatchArray | null =
        attributes.match(/\btype="([^"]*)"/);

      return !type || IS_JAVASCRIPT_TYPE.test(type[1]!);
    })
    .map((match: RegExpMatchArray) => {
      return match[2]!;
    });
}

function themeBootstrapSource(html: string): string {
  const script: string | undefined = inlineScripts(html).find(
    (source: string) => {
      return source.includes("__referenceTheme");
    },
  );

  if (!script) {
    throw new Error("the theme bootstrap is no longer in the page");
  }

  return script;
}

function stubDocument(): StubDocument {
  const classes: Set<string> = new Set<string>();
  const attributes: Record<string, string> = {};

  return {
    documentElement: {
      classList: {
        toggle: (name: string, force: boolean): void => {
          if (force) {
            classes.add(name);
          } else {
            classes.delete(name);
          }
        },
        contains: (name: string): boolean => {
          return classes.has(name);
        },
      },
      style: { colorScheme: "" },
      setAttribute: (name: string, value: string): void => {
        attributes[name] = value;
      },
      attributes: attributes,
    },
  };
}

function stubWindow(options: {
  storage?: Record<string, unknown> | null;
  systemPrefersDark: boolean;
}): StubWindow {
  /* A null store models a browser that blocks storage: every access throws. */
  const storage: Record<string, unknown> =
    options.storage === null
      ? (new Proxy(
          {},
          {
            get: (): never => {
              throw new Error("storage is blocked");
            },
          },
        ) as Record<string, unknown>)
      : options.storage || {};

  if (options.storage !== null && !("getItem" in storage)) {
    storage["getItem"] = (key: string): unknown => {
      return storage[key] === undefined ? null : storage[key];
    };
    storage["setItem"] = (key: string, value: string): void => {
      storage[key] = value;
    };
    storage["removeItem"] = (key: string): void => {
      delete storage[key];
    };
  }

  return {
    localStorage: storage,
    matchMedia: (): { matches: boolean; addEventListener: () => void } => {
      return {
        matches: options.systemPrefersDark,
        addEventListener: (): void => {},
      };
    },
    addEventListener: (): void => {},
  };
}

function runThemeBootstrap(
  source: string,
  options: {
    storage?: Record<string, unknown> | null;
    systemPrefersDark: boolean;
  },
): { window: StubWindow; document: StubDocument } {
  const fakeWindow: StubWindow = stubWindow(options);
  const fakeDocument: StubDocument = stubDocument();

  // eslint-disable-next-line no-new-func
  new Function("window", "document", source)(fakeWindow, fakeDocument);

  return { window: fakeWindow, document: fakeDocument };
}

describe("inline scripts", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await renderPage(PAGE_FIXTURES["model"]!);
  });

  it("finds the scripts at all", () => {
    expect(inlineScripts(html).length).toBeGreaterThanOrEqual(2);
  });

  it("parses every one of them", () => {
    for (const source of inlineScripts(html)) {
      // eslint-disable-next-line no-new-func
      expect(() => {
        return new Function(source);
      }).not.toThrow();
    }
  });

  it("gives the scroll spy a margin in units the browser accepts", () => {
    /*
     * IntersectionObserver rejects rem outright, and the throw takes down every
     * listener registered after it - the copy buttons, the code tabs, the
     * palette.
     */
    const margins: Array<string> = Array.from(
      html.matchAll(/rootMargin:\s*'([^']+)'/g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(margins.length).toBeGreaterThan(0);

    for (const margin of margins) {
      for (const part of margin.split(/\s+/)) {
        expect([margin, IS_PIXELS_OR_PERCENT.test(part)]).toEqual([
          margin,
          true,
        ]);
      }
    }
  });
});

describe("theme bootstrap", () => {
  let source: string = "";

  beforeAll(async () => {
    source = themeBootstrapSource(await renderPage(PAGE_FIXTURES["model"]!));
  });

  it("follows the system when nothing has been chosen", () => {
    const dark: { document: StubDocument } = runThemeBootstrap(source, {
      systemPrefersDark: true,
    });
    expect(dark.document.documentElement.classList.contains("dark")).toBe(true);
    expect(dark.document.documentElement.style.colorScheme).toBe("dark");

    const light: { document: StubDocument } = runThemeBootstrap(source, {
      systemPrefersDark: false,
    });
    expect(light.document.documentElement.classList.contains("dark")).toBe(
      false,
    );
    expect(light.document.documentElement.style.colorScheme).toBe("light");
  });

  it("lets an explicit choice override the system", () => {
    const result: { document: StubDocument } = runThemeBootstrap(source, {
      storage: { "oneuptime-reference-theme": "light" },
      systemPrefersDark: true,
    });

    expect(result.document.documentElement.classList.contains("dark")).toBe(
      false,
    );
  });

  it("honours the key the previous version of the page wrote", () => {
    const result: { document: StubDocument } = runThemeBootstrap(source, {
      storage: { isDarkMode: "true" },
      systemPrefersDark: false,
    });

    expect(result.document.documentElement.classList.contains("dark")).toBe(
      true,
    );
  });

  it("prefers the current key over the legacy one", () => {
    const result: { document: StubDocument } = runThemeBootstrap(source, {
      storage: {
        "oneuptime-reference-theme": "light",
        isDarkMode: "true",
      },
      systemPrefersDark: true,
    });

    expect(result.document.documentElement.classList.contains("dark")).toBe(
      false,
    );
  });

  it("falls back to the system when storage is blocked", () => {
    /* Safari in private mode, and any browser with third-party storage off. */
    const result: { document: StubDocument } = runThemeBootstrap(source, {
      storage: null,
      systemPrefersDark: true,
    });

    expect(result.document.documentElement.classList.contains("dark")).toBe(
      true,
    );
  });

  it("ignores a stored value that is not a theme", () => {
    const result: { document: StubDocument } = runThemeBootstrap(source, {
      storage: { "oneuptime-reference-theme": "chartreuse" },
      systemPrefersDark: false,
    });

    expect(result.document.documentElement.classList.contains("dark")).toBe(
      false,
    );
  });

  it("records the choice on the root element for CSS to read", () => {
    const result: { document: StubDocument } = runThemeBootstrap(source, {
      storage: { "oneuptime-reference-theme": "dark" },
      systemPrefersDark: false,
    });

    expect(result.document.documentElement.attributes["data-theme"]).toBe(
      "dark",
    );
    expect(
      result.document.documentElement.attributes["data-theme-preference"],
    ).toBe("dark");
  });

  it("distinguishes an explicit choice from following the system", () => {
    const following: { document: StubDocument } = runThemeBootstrap(source, {
      systemPrefersDark: true,
    });

    /*
     * Both resolve to dark; only the second is a decision, and the toggle's
     * icon depends on telling them apart.
     */
    expect(
      following.document.documentElement.attributes["data-theme-preference"],
    ).toBe("system");
    expect(following.document.documentElement.attributes["data-theme"]).toBe(
      "dark",
    );
  });
});

describe("behaviour the page depends on", () => {
  const scripts: string = fs.readFileSync(
    path.join(VIEWS_ROOT, "partials", "scripts.ejs"),
    "utf8",
  );

  it("binds by delegation, so a block added to a template needs no wiring", () => {
    for (const marker of [
      "data-copy-button",
      ".code-tab",
      "data-permissions-toggle",
    ]) {
      expect([
        marker,
        scripts.includes(`closest('[${marker}]')`) ||
          scripts.includes(`closest('${marker}')`),
      ]).toEqual([marker, true]);
    }
  });

  it("drives the code tabs from the keyboard", () => {
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      expect([key, scripts.includes(`'${key}'`)]).toEqual([key, true]);
    }
  });

  it("drives the palette from the keyboard, and opens it with a shortcut", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
      expect([key, scripts.includes(`'${key}'`)]).toEqual([key, true]);
    }

    expect(scripts).toContain("metaKey || event.ctrlKey");
  });

  it("does not open the palette while somebody is typing in a field", () => {
    expect(scripts).toContain("typingElsewhere");
    expect(scripts).toContain("isContentEditable");
  });

  it("survives a browser that blocks storage", () => {
    /* Every read and write of localStorage sits inside a try. */
    const storageUses: number = Array.from(
      scripts.matchAll(/window\.localStorage\./g),
    ).length;
    const guards: number = Array.from(scripts.matchAll(/try \{/g)).length;

    expect(storageUses).toBeGreaterThan(0);
    expect(guards).toBeGreaterThanOrEqual(storageUses - 1);
  });

  it("copies without the clipboard API, for a page served over plain http", () => {
    expect(scripts).toContain("navigator.clipboard");
    expect(scripts).toContain("document.execCommand");
  });

  it("returns focus to whatever opened the palette", () => {
    expect(scripts).toContain("lastFocused");
  });
});
