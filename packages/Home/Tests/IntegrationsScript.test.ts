import {
  OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  getOpenTelemetryGuidePath,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import { getGuidePageContent } from "../Utils/Integrations/OpenTelemetry/GuidePage";
import { getIntegrationsIndexContent } from "../Utils/Integrations/OpenTelemetry/IntegrationsIndex";
import { HOME_URL, renderView, seoFor } from "./Helpers/TailwindPages";
import { describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * Static/js/integrations.js on the pages it serves, run in a browser-like
 * window: the guides' Copy buttons, their tabs (a choice made once holds on
 * every set of its group, on this guide and the next) and the index's
 * search. Without the script each page still works - every code block is
 * there, the first tab of each set is open, every guide is listed - so the
 * tests also hold what the page shows before the script runs.
 */

const SCRIPT: string = fs.readFileSync(
  path.join(__dirname, "..", "Static", "js", "integrations.js"),
  "utf8",
);

interface Page {
  window: JSDOM["window"];
  document: Document;
  writeText: Mock<(text: string) => Promise<void>>;
}

async function openPage(
  template: string,
  locals: Record<string, unknown>,
  url: string,
  storage: Record<string, string> = {},
): Promise<Page> {
  const html: string = await renderView(template, {
    enableGoogleTagManager: false,
    integrationsScript: "/js/integrations.js",
    ...locals,
  });
  const dom: JSDOM = new JSDOM(html, { url: url, runScripts: "outside-only" });
  const writeText: Mock<(text: string) => Promise<void>> = jest.fn(
    (_text: string): Promise<void> => {
      return Promise.resolve();
    },
  );

  Object.defineProperty(dom.window.navigator, "clipboard", {
    value: { writeText: writeText },
    configurable: true,
  });
  for (const [key, value] of Object.entries(storage)) {
    dom.window.localStorage.setItem(key, value);
  }
  dom.window.eval(SCRIPT);

  return {
    window: dom.window,
    document: dom.window.document,
    writeText: writeText,
  };
}

function openGuide(
  slug: string,
  storage?: Record<string, string>,
): Promise<Page> {
  return openPage(
    "integrations/opentelemetry-guide.ejs",
    {
      seo: seoFor(getOpenTelemetryGuidePath(slug)),
      guide: getGuidePageContent(slug, HOME_URL),
    },
    `${HOME_URL}${getOpenTelemetryGuidePath(slug)}`,
    storage,
  );
}

function openIndex(): Promise<Page> {
  return openPage(
    "integrations/index.ejs",
    {
      seo: seoFor(OPEN_TELEMETRY_GUIDES_INDEX_PATH),
      integrations: getIntegrationsIndexContent(HOME_URL),
    },
    `${HOME_URL}${OPEN_TELEMETRY_GUIDES_INDEX_PATH}`,
  );
}

function selectedTabs(document: Document, group: string): Array<string> {
  return Array.from(document.querySelectorAll(`[data-tabs="${group}"]`)).map(
    (tabs: Element): string => {
      return (
        tabs
          .querySelector('[role="tab"][aria-selected="true"]')
          ?.getAttribute("data-tab-value") || ""
      );
    },
  );
}

function shownPanels(document: Document, group: string): Array<string> {
  return Array.from(
    document.querySelectorAll(`[data-tabs="${group}"] [data-tab-panel]`),
  )
    .filter((panel: Element): boolean => {
      return !(panel as HTMLElement).hidden;
    })
    .map((panel: Element): string => {
      return panel.getAttribute("data-tab-value") || "";
    });
}

function shownCards(document: Document): Array<string> {
  return Array.from(document.querySelectorAll("[data-integration-card]"))
    .filter((card: Element): boolean => {
      return !(card as HTMLElement).hidden;
    })
    .map((card: Element): string => {
      return card.querySelector("a")?.getAttribute("href") || "";
    });
}

function search(page: Page, text: string): void {
  const input: HTMLInputElement = page.document.querySelector(
    "[data-integrations-search]",
  ) as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new page.window.Event("input"));
}

async function settle(): Promise<void> {
  await new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
}

describe("a guide's code blocks", () => {
  test("hide their Copy button until the script can copy, then show it", async () => {
    const html: string = await renderView(
      "integrations/opentelemetry-guide.ejs",
      {
        enableGoogleTagManager: false,
        integrationsScript: "/js/integrations.js",
        seo: seoFor(getOpenTelemetryGuidePath("express")),
        guide: getGuidePageContent("express", HOME_URL),
      },
    );
    const before: Document = new JSDOM(html).window.document;
    const after: Page = await openGuide("express");

    for (const button of Array.from(
      before.querySelectorAll("[data-copy-button]"),
    )) {
      expect(button.hasAttribute("hidden")).toBe(true);
    }
    for (const button of Array.from(
      after.document.querySelectorAll("[data-copy-button]"),
    )) {
      expect((button as HTMLButtonElement).hidden).toBe(false);
    }
  });

  test("copy the code as written and say so", async () => {
    const page: Page = await openGuide("express");
    const block: Element = page.document.querySelector(
      '[data-snippet="install"]',
    )!;
    const button: HTMLButtonElement =
      block.querySelector("[data-copy-button]")!;

    button.click();
    await settle();

    expect(page.writeText).toHaveBeenCalledWith(
      block.querySelector("code")!.textContent,
    );
    expect(button.querySelector("[data-copy-label]")!.textContent).toBe(
      "Copied",
    );
    expect(button.getAttribute("data-copy-state")).toBe("copied");
  });

  test("say so when the clipboard refuses, and select the code to copy by hand", async () => {
    const page: Page = await openGuide("express");
    page.writeText.mockImplementation((): Promise<void> => {
      return Promise.reject(new Error("refused"));
    });
    const button: HTMLButtonElement = page.document.querySelector(
      '[data-snippet="install"] [data-copy-button]',
    )!;

    button.click();
    await settle();

    expect(button.querySelector("[data-copy-label]")!.textContent).toBe(
      "Copy failed",
    );
    expect(button.getAttribute("data-copy-state")).toBe("failed");
  });
});

describe("a guide's tabs", () => {
  test("open the first choice of each set before the reader picks", async () => {
    const page: Page = await openGuide("fastify");

    expect(selectedTabs(page.document, "deployment")).toEqual([
      "OneUptime Cloud",
    ]);
    expect(shownPanels(page.document, "deployment")).toEqual([
      "OneUptime Cloud",
    ]);
  });

  test("open the one the reader picks, and remember it for the next guide", async () => {
    const page: Page = await openGuide("fastify");
    const selfHosted: HTMLButtonElement = page.document.querySelector(
      '[data-tabs="deployment"] [data-tab-value="Self-hosted"][role="tab"]',
    )!;

    selfHosted.click();

    expect(selectedTabs(page.document, "deployment")).toEqual(["Self-hosted"]);
    expect(shownPanels(page.document, "deployment")).toEqual(["Self-hosted"]);

    const next: Page = await openGuide("koa", {
      "oneuptime-integrations-tab-deployment": "Self-hosted",
    });
    expect(selectedTabs(next.document, "deployment")).toEqual(["Self-hosted"]);
    expect(
      page.window.localStorage.getItem("oneuptime-integrations-tab-deployment"),
    ).toBe("Self-hosted");
  });

  test("move with the arrow keys, as a tab list does", async () => {
    const page: Page = await openGuide("hapi");
    const cloud: HTMLButtonElement = page.document.querySelector(
      '[data-tabs="deployment"] [role="tab"]',
    )!;

    cloud.dispatchEvent(
      new page.window.KeyboardEvent("keydown", { key: "ArrowRight" }),
    );

    expect(selectedTabs(page.document, "deployment")).toEqual(["Self-hosted"]);
    expect(page.document.activeElement?.getAttribute("data-tab-value")).toBe(
      "Self-hosted",
    );
  });

  test("ignore a remembered choice the set does not offer", async () => {
    const page: Page = await openGuide("bun", {
      "oneuptime-integrations-tab-deployment": "Somewhere else",
    });

    expect(selectedTabs(page.document, "deployment")).toEqual([
      "OneUptime Cloud",
    ]);
  });
});

describe("the index's search", () => {
  test("lists every guide until something is typed", async () => {
    const page: Page = await openIndex();

    expect(shownCards(page.document).length).toBe(
      page.document.querySelectorAll("[data-integration-card]").length,
    );
    expect(
      page.document.querySelector("[data-integrations-count]")!.textContent,
    ).toBe("");
  });

  test("finds a guide by its name, its words, or both", async () => {
    const page: Page = await openIndex();

    // Next.js is React on the server too.
    search(page, "react");
    expect(shownCards(page.document)).toEqual([
      "/integrations/opentelemetry/nextjs",
      "/integrations/opentelemetry/react",
    ]);
    expect(
      page.document.querySelector("[data-integrations-count]")!.textContent,
    ).toBe("2 guides");

    search(page, "spa vite");
    expect(shownCards(page.document)).toEqual([
      "/integrations/opentelemetry/react",
    ]);
    expect(
      page.document.querySelector("[data-integrations-count]")!.textContent,
    ).toBe("1 guide");

    search(page, "rum");
    expect(shownCards(page.document)).toEqual([
      "/integrations/opentelemetry/browser",
      "/integrations/opentelemetry/react",
      "/integrations/opentelemetry/angular",
    ]);

    search(page, "  Winston  ");
    expect(shownCards(page.document)).toEqual([
      "/integrations/opentelemetry/koa",
    ]);
  });

  test("matches the start of a word, never its middle", async () => {
    const page: Page = await openIndex();

    // "rum" starts no word of the Python or .NET guides: "instrument" only holds it.
    search(page, "rum");
    expect(shownCards(page.document)).not.toContain(
      "/integrations/opentelemetry/python",
    );
    expect(shownCards(page.document)).not.toContain(
      "/integrations/opentelemetry/dotnet",
    );

    // Each part of a dotted or hyphenated name is a word of its own.
    search(page, "fast");
    expect(shownCards(page.document)).toEqual([
      "/integrations/opentelemetry/fastify",
      "/integrations/opentelemetry/fastapi",
    ]);
    search(page, "instrument");
    expect(shownCards(page.document)).toContain(
      "/integrations/opentelemetry/python",
    );
    search(page, ".NET");
    expect(shownCards(page.document)).toEqual([
      "/integrations/opentelemetry/dotnet",
      "/integrations/opentelemetry/aspnet-core",
      "/integrations/opentelemetry/dotnet-worker-service",
    ]);
    search(page, "spring boot");
    expect(shownCards(page.document)).toEqual([
      "/integrations/opentelemetry/spring-boot",
    ]);
  });

  test("finds every guide of a language by the other names people type for it", async () => {
    const page: Page = await openIndex();
    const dotNet: Array<string> = [
      "/integrations/opentelemetry/dotnet",
      "/integrations/opentelemetry/aspnet-core",
      "/integrations/opentelemetry/dotnet-worker-service",
    ];
    // Every card of a group, as the index lists it.
    const groupCards: (language: string) => Array<string> = (
      language: string,
    ): Array<string> => {
      return Array.from(
        page.document.querySelectorAll(
          `#${language}[data-integrations-group] [data-integration-card] a`,
        ),
      ).map((link: Element): string => {
        return link.getAttribute("href") || "";
      });
    };

    // The guides' own words named none of these for the worker before.
    for (const name of ["dotnet", "c#", "csharp", "C#"]) {
      search(page, name);
      expect([name, shownCards(page.document)]).toEqual([name, dotNet]);
    }

    search(page, "jvm");
    expect(shownCards(page.document)).toEqual([
      ...groupCards("java"),
      ...groupCards("kotlin"),
    ]);
    expect(shownCards(page.document)).toContain(
      "/integrations/opentelemetry/ktor",
    );

    for (const name of ["js", "ts"]) {
      search(page, name);
      expect([name, shownCards(page.document)]).toEqual([
        name,
        groupCards("javascript"),
      ]);
    }

    // A language's other name narrows with the guide's own words.
    search(page, "dotnet worker");
    expect(shownCards(page.document)).toEqual([
      "/integrations/opentelemetry/dotnet-worker-service",
    ]);
  });

  test("says when nothing matches, and points at the docs", async () => {
    const page: Page = await openIndex();

    search(page, "cobol");

    expect(shownCards(page.document)).toEqual([]);
    const empty: HTMLElement = page.document.querySelector(
      "[data-integrations-empty]",
    )!;
    expect(empty.hidden).toBe(false);
    expect(empty.querySelector("a")!.getAttribute("href")).toBe(
      "/docs/telemetry/open-telemetry",
    );
    for (const group of Array.from(
      page.document.querySelectorAll("[data-integrations-group]"),
    )) {
      expect((group as HTMLElement).hidden).toBe(true);
    }
  });
});
