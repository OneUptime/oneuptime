import { afterEach, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import path from "path";

/*
 * The API Reference's copy buttons - Copy on a code block, the copy icon on
 * an endpoint's path - run in jsdom from the real templates (views/
 * partials/scripts.ejs, code.ejs, endpoint.ejs). The reference is served by
 * every self-hosted install, so over plain http too.
 *
 * Issue #5132's class of bug: the button said "Copied!" whenever the older
 * copy command did not throw - even when it returned false, having copied
 * nothing - and a refused async write said nothing at all. The page writes
 * through its own copy of Common/UI/Utils/Clipboard.ts now: the async
 * clipboard, then the copy command, each result checked. "Copied!" only
 * when one of them took the text; "Copy failed" otherwise, said to a screen
 * reader as well, with the text selected to copy by hand.
 */

const REFERENCE_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "APIReference",
);

const PARTIALS: string = path.join(REFERENCE_ROOT, "views", "partials");

const CODE: string = '{\n  "_id": "3a000000-0000-4000-8000-0000000000a1"\n}';
const ENDPOINT_PATH: string = "/api/incident/:id/get-item";

type LocaleStrings = Record<string, Record<string, unknown>>;

function stringsIn(lang: string): LocaleStrings {
  return JSON.parse(
    fs.readFileSync(
      path.join(REFERENCE_ROOT, "Locales", `${lang}.json`),
      "utf8",
    ),
  ) as LocaleStrings;
}

function translator(lang: string): (key: string) => string {
  const strings: LocaleStrings = stringsIn(lang);

  return (key: string): string => {
    const parts: Array<string> = key.split(".");
    let node: unknown = strings;

    for (const part of parts) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    return typeof node === "string" ? node : key;
  };
}

function renderPartial(name: string, locals: Record<string, unknown>): string {
  const file: string = path.join(PARTIALS, `${name}.ejs`);

  return ejs.render(fs.readFileSync(file, "utf8"), locals, {
    filename: file,
  });
}

type ClipboardMode = "accepts" | "refuses" | "missing";

interface PageOptions {
  lang?: string;
  clipboard: ClipboardMode;
  copyCommand?: boolean | undefined;
}

interface OpenedPage {
  window: DOMWindow;
  document: Document;
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
  const t: (key: string) => string = translator(lang);

  const html: string = `<!doctype html><html lang="${lang}"><head></head><body>
    ${renderPartial("endpoint", { t, methods: ["POST"], path: ENDPOINT_PATH })}
    ${renderPartial("code", { t, title: "Response", code: CODE, requestType: null, requestUrl: null })}
    ${renderPartial("scripts", { t, lang })}
  </body></html>`;

  const copied: Array<string> = [];
  const errors: Array<string> = [];

  const virtualConsole: VirtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: Error) => {
    errors.push(`script error: ${error.message}`);
  });

  const dom: JSDOM = new JSDOM(html, {
    url: "http://oneuptime.example.lan/reference/en/incident",
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
                        "Write permission denied.",
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

function codeCopyButton(page: OpenedPage): HTMLButtonElement {
  return page.document.querySelector(
    ".code-block-wrapper [data-copy-button]",
  ) as HTMLButtonElement;
}

function pathCopyButton(page: OpenedPage): HTMLButtonElement {
  return page.document.querySelector(
    "[data-copy-scope]:not(.code-block-wrapper) [data-copy-button]",
  ) as HTMLButtonElement;
}

function labelOf(button: HTMLElement): string {
  return button.querySelector(".copy-text")?.textContent?.trim() || "";
}

function announced(page: OpenedPage): string {
  return page.document.querySelector("[data-copy-status]")?.textContent || "";
}

async function click(page: OpenedPage, button: HTMLElement): Promise<void> {
  button.dispatchEvent(
    new page.window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  await settle(page.window);
}

describe("an API Reference code block's Copy", () => {
  test("copies the code and says Copied!, and a screen reader hears it", async () => {
    const page: OpenedPage = await openPage({ clipboard: "accepts" });

    await click(page, codeCopyButton(page));

    expect(page.copied).toEqual([CODE]);
    expect(labelOf(codeCopyButton(page))).toBe("Copied!");
    expect(codeCopyButton(page).classList.contains("copied")).toBe(true);
    expect(announced(page)).toBe("Copied!");
    expect(
      page.document.querySelector("[data-copy-status]")?.getAttribute("role"),
    ).toBe("status");
    expect(page.errors).toEqual([]);
  });

  test("on a plain-http page (no clipboard API) it copies through the browser's copy command", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "missing",
      copyCommand: true,
    });

    await click(page, codeCopyButton(page));

    expect(page.copied).toEqual([CODE]);
    expect(labelOf(codeCopyButton(page))).toBe("Copied!");
    expect(page.document.querySelector("textarea")).toBeNull();
  });

  test("the bug: a copy command that copies nothing is not Copied! - it says Copy failed", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "missing",
      copyCommand: false,
    });

    await click(page, codeCopyButton(page));

    expect(page.copied).toEqual([]);
    expect(labelOf(codeCopyButton(page))).toBe("Copy failed");
    expect(codeCopyButton(page).classList.contains("copied")).toBe(false);
    expect(codeCopyButton(page).classList.contains("copy-failed")).toBe(true);
    expect(codeCopyButton(page).getAttribute("data-copy-state")).toBe("failed");
    expect(announced(page)).toBe("Copy failed");
  });

  test("a refused async write falls back to the copy command, instead of saying nothing", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "refuses",
      copyCommand: true,
    });

    await click(page, codeCopyButton(page));

    expect(page.copied).toEqual([CODE]);
    expect(labelOf(codeCopyButton(page))).toBe("Copied!");
  });

  test("refused both ways: Copy failed, and the code is selected to copy by hand", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "refuses",
      copyCommand: false,
    });

    await click(page, codeCopyButton(page));

    expect(labelOf(codeCopyButton(page))).toBe("Copy failed");
    expect(page.window.getSelection()?.toString()).toBe(CODE);
  });

  test("Copy failed is said in the reader's language", async () => {
    const page: OpenedPage = await openPage({
      lang: "de",
      clipboard: "missing",
    });

    await click(page, codeCopyButton(page));

    expect(labelOf(codeCopyButton(page))).toBe("Kopieren fehlgeschlagen");
  });

  test("Copy failed goes back to Copy after four seconds", async () => {
    const page: OpenedPage = await openPage({ clipboard: "missing" });

    await click(page, codeCopyButton(page));
    await new Promise<void>((resolve: () => void) => {
      page.window.setTimeout(resolve, 4100);
    });

    expect(labelOf(codeCopyButton(page))).toBe("Copy");
    expect(codeCopyButton(page).classList.contains("copy-failed")).toBe(false);
    expect(codeCopyButton(page).hasAttribute("data-copy-state")).toBe(false);
  }, 10000);
});

describe("an endpoint path's copy icon", () => {
  test("copies the path, and says Copied! on hover and to a screen reader", async () => {
    const page: OpenedPage = await openPage({ clipboard: "accepts" });

    await click(page, pathCopyButton(page));

    expect(page.copied).toEqual([ENDPOINT_PATH]);
    expect(pathCopyButton(page).getAttribute("title")).toBe("Copied!");
    expect(announced(page)).toBe("Copied!");
  });

  test("refused both ways: Copy failed, in red, and the path is selected", async () => {
    const page: OpenedPage = await openPage({
      clipboard: "refuses",
      copyCommand: false,
    });

    await click(page, pathCopyButton(page));

    expect(pathCopyButton(page).getAttribute("title")).toBe("Copy failed");
    expect(pathCopyButton(page).classList.contains("copy-failed")).toBe(true);
    expect(announced(page)).toBe("Copy failed");
    expect(page.window.getSelection()?.toString()).toBe(ENDPOINT_PATH);
  });
});

describe("every API Reference language has the words", () => {
  const LOCALES_DIR: string = path.join(REFERENCE_ROOT, "Locales");
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
    const failed: string = translator(lang)("ui.copyFailed");

    expect(failed).not.toBe("ui.copyFailed");
    expect(failed.trim().length).toBeGreaterThan(0);

    if (lang !== "en") {
      expect(failed).not.toBe(translator("en")("ui.copyFailed"));
    }
  });
});
