import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import { afterEach, describe, expect, test } from "@jest/globals";
import ejs, { IncluderResult } from "ejs";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import path from "path";

/*
 * The Copy on the developers page's terminal (Views/solutions/
 * developers.ejs), its page script run in jsdom with the page's own words
 * (every shared partial left out).
 *
 * Issue #5132's class of bug: Copy called navigator.clipboard.writeText and
 * said nothing when the browser refused. It copies through the page's copy
 * of Common/UI/Utils/Clipboard.ts now - the async clipboard, then the older
 * copy command - says Copied! only when one of them took the text, and Copy
 * failed otherwise, with the code selected to copy by hand.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";

type ClipboardMode = "accepts" | "refuses" | "missing";

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

function settle(): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, 20);
  });
}

async function openPage(
  clipboard: ClipboardMode,
  copyCommand?: boolean,
): Promise<OpenedPage> {
  const seo: PageSEOData = getPageSEO("/solutions/developers");
  const html: string = (await ejs.renderFile(
    path.join(VIEWS_ROOT, "solutions", "developers.ejs"),
    {
      homeUrl: HOME_URL,
      enableGoogleTagManager: false,
      seo: { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` },
    },
    {
      views: [VIEWS_ROOT],
      includer: (included: string): IncluderResult => {
        return { template: `<!-- ${included} -->` };
      },
    },
  )) as string;

  const copied: Array<string> = [];
  const errors: Array<string> = [];

  const virtualConsole: VirtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: Error) => {
    errors.push(`script error: ${error.message}`);
  });

  const dom: JSDOM = new JSDOM(html, {
    url: `${HOME_URL}/solutions/developers`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse: (window: DOMWindow): void => {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value:
          clipboard === "missing"
            ? undefined
            : {
                writeText: (text: string): Promise<void> => {
                  if (clipboard === "refuses") {
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
          copyCommand === undefined
            ? undefined
            : (command: string): boolean => {
                const field: HTMLTextAreaElement | null =
                  window.document.querySelector(
                    "textarea[aria-hidden='true']",
                  );
                if (command === "copy" && copyCommand && field) {
                  copied.push(
                    field.value.slice(field.selectionStart, field.selectionEnd),
                  );
                }
                return Boolean(copyCommand);
              },
      });
    },
  });

  await settle();

  opened = { window: dom.window, document: dom.window.document, copied, errors };

  return opened;
}

function copyButton(page: OpenedPage): HTMLElement {
  return page.document.querySelector(".copy-btn") as HTMLElement;
}

function codeText(page: OpenedPage): string {
  return page.document.getElementById("code-content")?.textContent || "";
}

async function pressCopy(page: OpenedPage): Promise<void> {
  copyButton(page).dispatchEvent(
    new page.window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  await settle();
}

function wordsOf(element: Element): string {
  return (element.textContent || "").trim();
}

describe("the developers page's Copy", () => {
  test("copies the snippet and says Copied!", async () => {
    const page: OpenedPage = await openPage("accepts");

    expect(codeText(page)).toContain("receivers");

    await pressCopy(page);

    expect(page.copied).toEqual([codeText(page)]);
    expect(wordsOf(copyButton(page))).toBe("Copied!");
    expect(page.errors).toEqual([]);
  });

  test("a refused write falls back to the copy command, and only then says Copied!", async () => {
    const page: OpenedPage = await openPage("refuses", true);

    await pressCopy(page);

    expect(page.copied).toEqual([codeText(page)]);
    expect(wordsOf(copyButton(page))).toBe("Copied!");
  });

  test("refused both ways it says Copy failed - it used to say nothing - and selects the code", async () => {
    const page: OpenedPage = await openPage("refuses", false);

    await pressCopy(page);

    expect(page.copied).toEqual([]);
    expect(wordsOf(copyButton(page))).toBe("Copy failed");
    expect(copyButton(page).classList.contains("copy-failed")).toBe(true);
    expect(copyButton(page).getAttribute("aria-live")).toBe("polite");
    expect(page.window.getSelection()?.toString()).toBe(codeText(page));
    expect(page.errors).toEqual([]);
  });

  test("with no clipboard API it copies through the copy command", async () => {
    const page: OpenedPage = await openPage("missing", true);

    await pressCopy(page);

    expect(page.copied).toEqual([codeText(page)]);
    expect(wordsOf(copyButton(page))).toBe("Copied!");
  });

  test("goes back to Copy after it said Copy failed", async () => {
    const page: OpenedPage = await openPage("missing");

    await pressCopy(page);
    expect(wordsOf(copyButton(page))).toBe("Copy failed");

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 4100);
    });

    expect(wordsOf(copyButton(page))).toBe("Copy");
    expect(copyButton(page).classList.contains("copy-failed")).toBe(false);
  }, 10000);
});
