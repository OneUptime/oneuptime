import { afterEach, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import path from "path";
import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";

/*
 * The docs' copy buttons - Copy on every code block, Copy page at the top of
 * a page - run in jsdom from the real page script (Views/Partials/
 * Scripts.ejs), over a code block as the docs' Markdown renderer writes it.
 *
 * Issue #5132's class of bug, on the docs a self-hosted install serves: on a
 * docs page served over plain http there is no navigator.clipboard, and a
 * code block's Copy did nothing at all - no copy, no word - while a refused
 * write was silent too. The page copies through its own copy of
 * Common/UI/Utils/Clipboard.ts now: the async clipboard, then the browser's
 * older copy command. Copied only when one of them took the text; Copy
 * failed (in the reader's language) otherwise, with the code selected to
 * copy by hand.
 */

const DOCS_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Docs",
);

const SCRIPTS_TEMPLATE: string = path.join(
  DOCS_ROOT,
  "Views",
  "Partials",
  "Scripts.ejs",
);

const MARKDOWN_URL: string = "/docs/as-markdown/en/monitor/website-monitor";
const PAGE_MARKDOWN: string = "# Website monitor\n\nWatches a page.\n";
const COMMAND: string = "npm install -g @oneuptime/cli";

type LocaleStrings = Record<string, Record<string, unknown>>;

function stringsIn(lang: string): LocaleStrings {
  return JSON.parse(
    fs.readFileSync(path.join(DOCS_ROOT, "Locales", `${lang}.json`), "utf8"),
  ) as LocaleStrings;
}

function uiString(lang: string, name: string): string {
  return stringsIn(lang)["ui"]?.[name] as string;
}

function renderScripts(lang: string): string {
  const strings: LocaleStrings = stringsIn(lang);

  return ejs.render(
    fs.readFileSync(SCRIPTS_TEMPLATE, "utf8"),
    {
      t: (key: string): string => {
        const [section, name] = key.split(".");
        const value: unknown =
          section && name ? strings[section]?.[name] : undefined;
        return typeof value === "string" ? value : key;
      },
      nav: [],
      lang,
    },
    { filename: SCRIPTS_TEMPLATE },
  );
}

type ClipboardMode =
  // A secure page: the async clipboard takes the text.
  | "accepts"
  // A secure page whose clipboard refuses (document not focused).
  | "refuses"
  // A page served over plain http: no navigator.clipboard at all.
  | "missing";

interface PageOptions {
  lang?: string;
  clipboard: ClipboardMode;
  // What document.execCommand("copy") answers; undefined: no such command.
  copyCommand?: boolean | undefined;
  // Copy page's fetch of the Markdown.
  markdownFetch?: "ok" | "fails";
}

interface OpenedPage {
  window: DOMWindow;
  document: Document;
  // What reached the clipboard, by either way.
  copied: Array<string>;
  errors: Array<string>;
}

let opened: OpenedPage | null = null;

afterEach(() => {
  opened?.window.close();
  opened = null;
});

async function settle(window: DOMWindow): Promise<void> {
  for (let round: number = 0; round < 5; round++) {
    await new Promise<void>((resolve: () => void) => {
      window.setTimeout(resolve, 0);
    });
  }
}

async function openPage(options: PageOptions): Promise<OpenedPage> {
  const lang: string = options.lang || "en";
  const codeBlock: string = await Markdown.convertToHTML(
    "```bash\n" + COMMAND + "\n```",
    MarkdownContentType.Docs,
  );

  const html: string = `<!doctype html><html lang="${lang}"><head></head><body>
    <article id="docs-content">
      <div class="docs-page-actions">
        <button type="button" class="docs-page-action" data-copy-page data-markdown-url="${MARKDOWN_URL}" hidden>
          <span class="docs-page-action__label">${uiString(lang, "copyPage")}</span>
        </button>
      </div>
      ${codeBlock}
    </article>
    ${renderScripts(lang)}
  </body></html>`;

  const copied: Array<string> = [];
  const errors: Array<string> = [];

  const virtualConsole: VirtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: Error) => {
    errors.push(`script error: ${error.message}`);
  });

  const dom: JSDOM = new JSDOM(html, {
    url: "http://docs.example.lan/docs/en/monitor/website-monitor",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse: (window: DOMWindow): void => {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value:
          options.clipboard === "missing"
            ? undefined
            : {
                writeText: (text: string): Promise<void> => {
                  if (options.clipboard === "refuses") {
                    return Promise.reject(
                      new window.DOMException(
                        "Document is not focused.",
                        "NotAllowedError",
                      ),
                    );
                  }
                  copied.push(text);
                  return Promise.resolve();
                },
              },
      });

      Object.defineProperty(window.document, "execCommand", {
        configurable: true,
        writable: true,
        value:
          options.copyCommand === undefined
            ? undefined
            : (command: string): boolean => {
                const field: HTMLTextAreaElement | null =
                  window.document.querySelector("textarea[aria-hidden='true']");
                if (command === "copy" && options.copyCommand && field) {
                  copied.push(
                    field.value.slice(field.selectionStart, field.selectionEnd),
                  );
                }
                return Boolean(options.copyCommand);
              },
      });

      Object.defineProperty(window, "fetch", {
        configurable: true,
        value: (url: string): Promise<unknown> => {
          if (options.markdownFetch === "fails" || url !== MARKDOWN_URL) {
            return Promise.reject(new Error("offline"));
          }
          return Promise.resolve({
            ok: true,
            text: (): Promise<string> => {
              return Promise.resolve(PAGE_MARKDOWN);
            },
          });
        },
      });
    },
  });

  await settle(dom.window);

  opened = {
    window: dom.window,
    document: dom.window.document,
    copied,
    errors,
  };

  return opened;
}

function copyCodeButton(page: OpenedPage): HTMLButtonElement {
  return page.document.querySelector("[data-copy-code]") as HTMLButtonElement;
}

function copyPageButton(page: OpenedPage): HTMLButtonElement {
  return page.document.querySelector("[data-copy-page]") as HTMLButtonElement;
}

async function click(page: OpenedPage, button: HTMLElement): Promise<void> {
  button.dispatchEvent(
    new page.window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  await settle(page.window);
}

describe("a docs code block's Copy", () => {
  test("is offered once the script has wired it, named and labelled in the page's language", async () => {
    const page: OpenedPage = await openPage({ clipboard: "accepts" });

    expect(copyCodeButton(page).hidden).toBe(false);
    expect(copyCodeButton(page).getAttribute("aria-label")).toBe("Copy code");
    expect(copyCodeButton(page).textContent?.trim()).toBe("Copy");
    expect(copyCodeButton(page).getAttribute("aria-live")).toBe("polite");
    expect(page.errors).toEqual([]);
  });

  test("copies the code and says Copied, for two seconds", async () => {
    const page: OpenedPage = await openPage({ clipboard: "accepts" });

    await click(page, copyCodeButton(page));

    expect(page.copied).toEqual([COMMAND]);
    expect(copyCodeButton(page).textContent?.trim()).toBe(
      uiString("en", "copied"),
    );
    expect(copyCodeButton(page).classList.contains("is-copied")).toBe(true);
    expect(page.errors).toEqual([]);
  });

  test("the bug: on a plain-http page (no clipboard API) it copies through the browser's copy command", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "missing",
      copyCommand: true,
    });

    await click(page, copyCodeButton(page));

    expect(page.copied).toEqual([COMMAND]);
    expect(copyCodeButton(page).textContent?.trim()).toBe("Copied");
    // The scratch field it copied from is gone again.
    expect(page.document.querySelector("textarea")).toBeNull();
  });

  test("a refused write falls back to the copy command", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "refuses",
      copyCommand: true,
    });

    await click(page, copyCodeButton(page));

    expect(page.copied).toEqual([COMMAND]);
    expect(copyCodeButton(page).textContent?.trim()).toBe("Copied");
  });

  test("refused both ways it says Copy failed - never Copied - and selects the code to copy by hand", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "refuses",
      copyCommand: false,
    });

    await click(page, copyCodeButton(page));

    expect(page.copied).toEqual([]);
    expect(copyCodeButton(page).textContent?.trim()).toBe("Copy failed");
    expect(copyCodeButton(page).classList.contains("is-copy-failed")).toBe(
      true,
    );
    expect(copyCodeButton(page).classList.contains("is-copied")).toBe(false);
    expect(page.window.getSelection()?.toString()).toBe(COMMAND);
  });

  test("with no clipboard API and no copy command it says Copy failed, not nothing", async () => {
    const page: OpenedPage = await openPage({ clipboard: "missing" });

    await click(page, copyCodeButton(page));

    expect(copyCodeButton(page).textContent?.trim()).toBe("Copy failed");
    expect(page.errors).toEqual([]);
  });

  test.each([
    ["de", "Kopieren fehlgeschlagen"],
    ["ja", "コピーに失敗しました"],
    ["fa", "کپی ناموفق بود"],
  ])("says Copy failed in %s", async (lang: string, failed: string) => {
    const page: OpenedPage = await openPage({ lang, clipboard: "missing" });

    await click(page, copyCodeButton(page));

    expect(copyCodeButton(page).textContent?.trim()).toBe(failed);
  });

  test("Copy failed goes back to Copy after four seconds", async () => {
    const page: OpenedPage = await openPage({ clipboard: "missing" });

    await click(page, copyCodeButton(page));
    await new Promise<void>((resolve: () => void) => {
      page.window.setTimeout(resolve, 4100);
    });

    expect(copyCodeButton(page).textContent?.trim()).toBe("Copy");
    expect(copyCodeButton(page).classList.contains("is-copy-failed")).toBe(
      false,
    );
  }, 10000);
});

describe("a docs page's Copy page", () => {
  test("copies the page's Markdown and says Copied", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "accepts",
      markdownFetch: "ok",
    });

    expect(copyPageButton(page).hidden).toBe(false);

    await click(page, copyPageButton(page));

    expect(page.copied).toEqual([PAGE_MARKDOWN]);
    expect(copyPageButton(page).textContent?.trim()).toBe("Copied");
  });

  test("a refused write that the copy command takes still copies", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "refuses",
      copyCommand: true,
      markdownFetch: "ok",
    });

    await click(page, copyPageButton(page));

    expect(page.copied).toEqual([PAGE_MARKDOWN]);
    expect(copyPageButton(page).textContent?.trim()).toBe("Copied");
  });

  test("says Copy failed when the copy is refused - it used to say nothing", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "refuses",
      copyCommand: false,
      markdownFetch: "ok",
    });

    await click(page, copyPageButton(page));

    expect(copyPageButton(page).textContent?.trim()).toBe("Copy failed");
    expect(copyPageButton(page).classList.contains("is-copy-failed")).toBe(
      true,
    );
  });

  test("says Copy failed when the Markdown cannot be fetched", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "accepts",
      markdownFetch: "fails",
    });

    await click(page, copyPageButton(page));

    expect(page.copied).toEqual([]);
    expect(copyPageButton(page).textContent?.trim()).toBe("Copy failed");
  });

  test("is not offered on a page with no clipboard API, where it could not copy after its fetch", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "missing",
      copyCommand: true,
    });

    expect(copyPageButton(page).hidden).toBe(true);
  });
});

describe("every docs language has the words", () => {
  const LOCALES_DIR: string = path.join(DOCS_ROOT, "Locales");
  const files: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  test("there are seventeen of them", () => {
    expect(files).toHaveLength(17);
  });

  test.each(files)("%s says Copy failed in its own words", (file: string) => {
    const lang: string = file.replace(".json", "");
    const failed: string = uiString(lang, "copyFailed");

    expect(typeof failed).toBe("string");
    expect(failed.trim().length).toBeGreaterThan(0);

    if (lang !== "en") {
      expect(failed).not.toBe(uiString("en", "copyFailed"));
    }
  });
});
