import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";

/*
 * Adding an LLM provider, end to end in a browser, on the real pages
 * (LlmProviderTest/Fixture.js): Project Settings > AI > LLM Providers, a
 * provider's own page, and the Admin Dashboard's Global LLM Providers.
 *
 * The form asked for a name first, then showed every provider's fields at
 * once: an API Key "required for OpenAI, Azure OpenAI / Microsoft Foundry,
 * Anthropic, Groq and Mistral", a Base URL whose help was about Azure and
 * whose placeholder was Ollama's. Somebody adding Ollama read about Azure
 * keys. Now it asks which provider first - a card each, saying what it is -
 * then only what that provider uses, with that provider's help under each
 * field, and names the provider after it until a name of one's own is
 * typed. What is pinned here is what a person sees and what is saved, at
 * desktop and phone width, in the dark theme and in German.
 *
 * The screenshots under output/playwright/llm-provider-test-ui are for the
 * people who review the form.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/llm-provider-test-ui",
);

// Kanji, hiragana or katakana: a name the Japanese locale translated.
const JAPANESE_SCRIPT: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

const CARDS_IN_ORDER: Array<string> = [
  "OpenAI",
  "Anthropic",
  "AzureOpenAI",
  "Groq",
  "Mistral",
  "Ollama",
  "OpenAICompatible",
];

interface SavedProvider {
  formType: string;
  name?: string;
  description?: string;
  llmType?: string;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  isDefault?: boolean;
  isGlobalLlm?: boolean;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function saves(page: Page): Promise<Array<SavedProvider>> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __llmProviderTestFixture: { state: { saves: unknown } };
          }
        ).__llmProviderTestFixture.state.saves,
      ),
    );
  });
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

function card(page: Page, type: string): Locator {
  return dialog(page).getByTestId(`card-select-option-${type}`);
}

function next(page: Page): Locator {
  return dialog(page).getByTestId("modal-footer-next-button");
}

function create(page: Page): Locator {
  return dialog(page).getByTestId("modal-footer-submit-button");
}

function nameInput(page: Page): Locator {
  return dialog(page).getByPlaceholder("e.g. Production OpenAI");
}

function hint(page: Page, field: string): Locator {
  return dialog(page).getByTestId(`llm-provider-${field}-hint`);
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
  });
}

// Opens Create LLM Provider on the project's list.
async function openCreate(page: Page, query: string = ""): Promise<void> {
  await open(page, `page=list${query}`);
  await page.getByRole("button", { name: "Create LLM Provider" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(card(page, "OpenAI")).toBeVisible();
}

// Picks a provider's card, then walks on to Connection.
async function pick(page: Page, type: string): Promise<void> {
  await card(page, type).click();
  await expect(card(page, type)).toHaveAttribute("aria-checked", "true");
  await next(page).click();
  await expect(nameInput(page)).toBeVisible();
}

// Back to the Provider step, from the steps above the form.
async function backToProvider(page: Page): Promise<void> {
  await dialog(page)
    .getByRole("navigation", { name: "Progress" })
    .getByText("Provider", { exact: true })
    .click();
  await expect(card(page, "OpenAI")).toBeVisible();
}

test.describe("Project Settings > AI > LLM Providers: adding a provider", () => {
  test("the page lists the project's providers first, then the global ones it falls back to", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The first provider left its Model Name blank.
    await open(page, "page=list&blankmodel=1");

    const titles: Array<string> = (
      await page.locator("h2, h3").allInnerTexts()
    ).map((text: string) => {
      return text.trim();
    });

    expect(titles.indexOf("LLM Providers")).toBeGreaterThan(-1);
    expect(titles.indexOf("Global LLM Providers")).toBeGreaterThan(
      titles.indexOf("LLM Providers"),
    );
    // No list of features ahead of anything to do.
    await expect(page.getByText("What Can LLM Providers Do?")).toHaveCount(0);
    // A blank Model Name is the model the server asks for, by name.
    await expect(page.getByText("gpt-5.1 (default)")).toBeVisible();
    await expect(
      page.getByText("claude-sonnet-5-5", { exact: true }).first(),
    ).toBeVisible();
    // An OpenAI-compatible server has no default: it says what happens.
    await expect(
      page.getByText("First model the server lists", { exact: true }),
    ).toBeVisible();
    await shoot(page, "form-list-page");
  });

  test("asks which provider first: a card each, saying what it is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);

    expect(
      await dialog(page)
        .getByRole("radio")
        .evaluateAll((cards: Array<Element>) => {
          return cards.map((card: Element) => {
            return card.getAttribute("data-testid");
          });
        }),
    ).toEqual(
      CARDS_IN_ORDER.map((type: string) => {
        return `card-select-option-${type}`;
      }),
    );
    await expect(card(page, "Ollama")).toContainText(
      "Open models you run yourself. No API key.",
    );
    await expect(card(page, "AzureOpenAI")).toContainText(
      "Azure OpenAI / Microsoft Foundry",
    );
    // Nothing else is asked before a provider is picked.
    await expect(nameInput(page)).toHaveCount(0);
    await shoot(page, "form-provider-step");
  });

  /*
   * "The UI looks very ugly." - two cards to a row in the dialog's column
   * squeezed every line to a few words, Azure's long name left the card
   * beside it half empty, and the seventh card stood alone. One panel of
   * ruled rows now: each as wide as the panel, one under the other, the
   * whole step in sight without scrolling.
   */
  test("the providers are one panel of rows, each as wide as the panel, all in sight", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);

    const panel: Locator = card(page, "OpenAI").locator("..");
    const panelBox: { x: number; width: number } | null =
      await panel.boundingBox();
    const boxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];

    for (const type of CARDS_IN_ORDER) {
      // Every row is a child of the one panel.
      await expect(card(page, type).locator("..")).toHaveClass(/divide-y/);

      const box: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null = await card(page, type).boundingBox();

      boxes.push(box!);
    }

    for (const [index, box] of boxes.entries()) {
      // As wide as the panel (its 1px border aside), one under the other.
      expect(Math.abs(box.x - panelBox!.x)).toBeLessThan(2);
      expect(Math.abs(box.width - panelBox!.width)).toBeLessThan(3);

      if (index > 0) {
        expect(box.y).toBeGreaterThan(boxes[index - 1]!.y);
      }
    }

    // The last row is in sight with the dialog's buttons: no scrolling.
    await expect(card(page, "OpenAICompatible")).toBeInViewport({ ratio: 1 });
    await expect(next(page)).toBeInViewport();

    // A pick fills its radio and tints its row; the others stay plain.
    await card(page, "OpenAICompatible").click();
    await expect(card(page, "OpenAICompatible")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      dialog(page)
        .getByTestId("card-select-option-OpenAICompatible-radio")
        .locator("span"),
    ).toHaveCount(1);
    await expect(
      dialog(page)
        .getByTestId("card-select-option-OpenAI-radio")
        .locator("span"),
    ).toHaveCount(0);
    await shoot(page, "form-provider-step-picked");
  });

  test("Ollama: no API key, an address it can reach, and the model a blank name gets", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);
    await pick(page, "Ollama");

    await expect(dialog(page).getByTestId("llm-provider-api-key")).toHaveCount(
      0,
    );
    await expect(hint(page, "base-url")).toHaveText(
      "An address the OneUptime server can reach, such as http://ollama:11434. Not localhost. Never put keys here.",
    );
    await expect(hint(page, "model-name")).toHaveText(
      "A model you pulled into Ollama. Leave empty for llama3.1.",
    );
    // Named after the provider until a name of one's own is typed.
    await expect(nameInput(page)).toHaveValue("Ollama");
    await shoot(page, "form-connection-ollama");
  });

  test("OpenAI: a key and where to get one; the Base URL only for a proxy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);
    await pick(page, "OpenAI");

    await expect(
      dialog(page).getByTestId("llm-provider-api-key"),
    ).toBeVisible();
    await expect(hint(page, "api-key")).toHaveText(
      "Create one at platform.openai.com, under API keys.",
    );
    await expect(hint(page, "base-url")).toHaveText(
      "Only to go through a proxy or a gateway. Leave empty for OpenAI's own API: https://api.openai.com/v1. Never put keys here.",
    );
    await expect(hint(page, "model-name")).toHaveText(
      "Leave empty for gpt-5.1.",
    );
    await shoot(page, "form-connection-openai");
  });

  test("the name follows the provider picked, until one of one's own is typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);
    await pick(page, "Ollama");
    await expect(nameInput(page)).toHaveValue("Ollama");

    await backToProvider(page);
    await pick(page, "Anthropic");
    await expect(nameInput(page)).toHaveValue("Anthropic");

    await nameInput(page).fill("Production Claude");
    await backToProvider(page);
    await pick(page, "OpenAI");
    await expect(nameInput(page)).toHaveValue("Production Claude");
  });

  test("creates the provider with what was asked: the default, its key, no Base URL", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);
    await pick(page, "OpenAI");
    await dialog(page).getByTestId("llm-provider-api-key").fill("sk-test-key");
    await create(page).click();

    await expect(dialog(page)).toHaveCount(0);

    const saved: Array<SavedProvider> = await saves(page);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: "OpenAI",
      llmType: "OpenAI",
      apiKey: "sk-test-key",
      isDefault: true,
    });
    expect(saved[0]!.baseUrl || "").toBe("");
    expect(saved[0]!.modelName || "").toBe("");
  });

  test("an OpenAI-compatible server is not saved without its address", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);
    await pick(page, "OpenAICompatible");
    await create(page).click();

    await expect(dialog(page)).toContainText("Base URL is required.");
    // Its model is left to the server when blank: never required.
    await expect(dialog(page)).not.toContainText("Model Name is required.");
    // Its key is optional, and said so.
    await expect(hint(page, "api-key")).toHaveText(
      "Only if your server asks for one.",
    );
    expect(await saves(page)).toEqual([]);
    await shoot(page, "form-connection-compatible-errors");
  });

  test("an OpenAI-compatible server is saved with only its address: a blank Model Name is the first model it lists", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);
    await pick(page, "OpenAICompatible");

    // Model Name says it is optional, and what a blank one gets.
    await expect(
      dialog(page)
        .locator("label")
        .filter({ hasText: "Model Name" })
        .filter({ hasText: "Optional" }),
    ).toHaveCount(1);
    await expect(hint(page, "model-name")).toHaveText(
      "Leave empty for the first model your server lists. To use another, type its name exactly as your server lists it.",
    );

    await dialog(page)
      .getByTestId("llm-provider-base-url")
      .fill("http://vllm:8000/v1");
    await shoot(page, "form-connection-compatible-blank-model");
    await create(page).click();
    await expect(dialog(page)).toHaveCount(0);

    const saved: Array<SavedProvider> = await saves(page);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: "OpenAI-compatible",
      llmType: "OpenAICompatible",
      baseUrl: "http://vllm:8000/v1",
      isDefault: true,
    });
    expect(saved[0]!.modelName || "").toBe("");
    expect(saved[0]!.apiKey || "").toBe("");
  });

  test("the description, the default switch and the parameters wait under More fields", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);
    await pick(page, "Mistral");

    const more: Locator = dialog(page).getByRole("button", {
      name: /More fields/,
    });

    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(dialog(page).getByText("Set as Default")).toBeVisible();
    await expect(dialog(page).getByText("Additional Parameters")).toBeVisible();
    await expect(
      dialog(page).getByPlaceholder("What this provider is for."),
    ).toBeVisible();
    await shoot(page, "form-connection-more-fields");
  });

  /*
   * "Can we make this more subtle, this needs to be done across the
   * project for more fields. Takes up too much real estate right now." -
   * the maintainer, on the More fields card: a framed box with an icon tile,
   * a bold title and a row of pills, as tall as two rows of the form. It is
   * one quiet line now. Measured here in a real browser, where jsdom can
   * only read class names.
   */
  test("More fields is one quiet line: no frame, no tile, one row of text, its fields opened in place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);
    await pick(page, "Mistral");

    const fold: Locator = dialog(page).getByTestId("folded-section");
    const more: Locator = dialog(page).getByRole("button", {
      name: "More fields",
      exact: true,
    });

    await expect(fold).toHaveAttribute("data-variant", "line");
    // What is inside, after the title, on the same line.
    await expect(more).toContainText(/^More fields\s*·\s*Description/);

    // One row of text: about 28 pixels, where the card was 74.
    const folded: { height: number } | null = await fold.boundingBox();
    expect(folded!.height).toBeLessThanOrEqual(32);

    // No frame, no ground of its own, no shadow, no icon tile.
    expect(
      await fold.evaluate((element: Element) => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return {
          border: style.borderTopWidth,
          background: style.backgroundColor,
          shadow: style.boxShadow,
        };
      }),
    ).toEqual({
      border: "0px",
      background: "rgba(0, 0, 0, 0)",
      shadow: "none",
    });
    await expect(dialog(page).getByTestId("folded-section-icon")).toHaveCount(
      0,
    );

    // It starts where the fields start, as part of the form.
    const name: { x: number; width: number } | null =
      await nameInput(page).boundingBox();
    const chevron: { x: number } | null = await dialog(page)
      .getByTestId("folded-section-chevron")
      .boundingBox();
    expect(Math.abs(chevron!.x - name!.x)).toBeLessThanOrEqual(2);

    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");

    // Open, its fields follow the line: as wide as the Name field, no box.
    const description: Locator = dialog(page).getByPlaceholder(
      "What this provider is for.",
    );
    await expect(description).toBeVisible();

    const opened: { x: number; width: number } | null =
      await description.boundingBox();
    expect(Math.abs(opened!.x - name!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(opened!.width - name!.width)).toBeLessThanOrEqual(1);
    await expect(more).toHaveText(/^More fields$/);

    await shoot(page, "form-connection-more-fields-line");
  });

  test("at phone width More fields wraps its names under its title, inside the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCreate(page);
    await pick(page, "Mistral");

    const more: Locator = dialog(page).getByRole("button", {
      name: "More fields",
      exact: true,
    });
    const box: { x: number; width: number; height: number } | null =
      await more.boundingBox();

    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    // A few short lines of text at most, never the card it was.
    expect(box!.height).toBeLessThanOrEqual(80);
    expect(
      await page.evaluate(() => {
        return document.documentElement.scrollWidth;
      }),
    ).toBeLessThanOrEqual(390);
    await shoot(page, "form-connection-more-fields-line-phone");
  });

  /*
   * The line's commas are text on screen, so they are written the way
   * Japanese writes a list: 、 with no space after it. With no space to
   * break at, the names still wrap between one another - each whole - and
   * stay inside a phone's screen.
   */
  test("in Japanese, More fields lists its names with 、 and wraps them whole at phone width", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await open(page, "page=list&lang=ja");
    await page
      .getByRole("button", { name: "LLM プロバイダーを作成" })
      .first()
      .click();
    await expect(card(page, "Mistral")).toBeVisible();
    await card(page, "Mistral").click();
    await next(page).click();

    const more: Locator = dialog(page).getByRole("button", {
      name: "その他の項目",
      exact: true,
    });
    await expect(more).toBeVisible();

    const contents: Locator = more.getByTestId("folded-section-contents");
    const names: Array<string> = (
      await more.getByTestId("folded-section-item").allTextContents()
    ).map((name: string): string => {
      return name.trim();
    });

    expect(names.length).toBeGreaterThan(1);
    // Japanese names, listed with 、 and no space after it - never ", ".
    expect(names.join("")).toMatch(JAPANESE_SCRIPT);
    expect(((await contents.textContent()) || "").trim()).toBe(
      names.join("、"),
    );

    // Each name wraps whole, its 、 with it: one line of text per entry.
    const entries: Array<{ x: number; y: number; height: number }> =
      await contents.evaluate(
        (element: Element): Array<{ x: number; y: number; height: number }> => {
          return Array.from(element.children).map((child: Element) => {
            const rect: DOMRect = child.getBoundingClientRect();
            return { x: rect.x, y: rect.y, height: rect.height };
          });
        },
      );

    expect(entries.length).toBe(names.length);

    for (const entry of entries) {
      expect(entry.height).toBeLessThanOrEqual(26);
    }

    /*
     * At this width the list takes more than one line, and starts each
     * line under the title, never off the screen.
     */
    const rows: Set<number> = new Set<number>(
      entries.map((entry: { y: number }): number => {
        return Math.round(entry.y);
      }),
    );
    expect(rows.size).toBeGreaterThan(1);

    const box: { x: number; width: number } | null = await more.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(
      await page.evaluate(() => {
        return document.documentElement.scrollWidth;
      }),
    ).toBeLessThanOrEqual(320);

    await shoot(page, "form-connection-more-fields-line-ja-phone");
  });

  test("at phone width the cards are one to a row, and the dialog fits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCreate(page);

    // In one frame: the dialog grows in as it opens (Modal, from 95%).
    const [first, second] = (await boxesInOneFrame([
      card(page, "OpenAI"),
      card(page, "Anthropic"),
    ])) as [FrameBox, FrameBox];

    expect(Math.abs(first.x - second.x)).toBeLessThan(2);
    expect(first.x + first.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => {
        return document.documentElement.scrollWidth;
      }),
    ).toBeLessThanOrEqual(390);
    await shoot(page, "form-provider-step-phone");
  });

  test("in the dark theme the cards and the help are dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "&theme=dark");

    const background: string = await card(page, "OpenAI").evaluate(
      (element: Element) => {
        return getComputedStyle(element).backgroundColor;
      },
    );

    // Not the light theme's white.
    expect(background).not.toBe("rgb(255, 255, 255)");
    await shoot(page, "form-provider-step-dark");
    await pick(page, "Ollama");
    await shoot(page, "form-connection-ollama-dark");
  });

  test("in German, the steps, the cards and the help speak German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list&lang=de");
    await page.getByRole("button", { name: "LLM-Anbieter erstellen" }).click();
    await expect(card(page, "Ollama")).toContainText(
      "Offene Modelle, die Sie selbst betreiben. Kein API-Schlüssel.",
    );

    const progress: Locator = dialog(page).getByRole("navigation", {
      name: /./,
    });

    await expect(progress.first()).toContainText("Anbieter");
    await expect(progress.first()).toContainText("Verbindung");

    await card(page, "Ollama").click();
    await next(page).click();
    await expect(hint(page, "model-name")).toHaveText(
      "Ein Modell, das Sie in Ollama geladen haben. Leer lassen für llama3.1.",
    );
    await shoot(page, "form-connection-ollama-de");
  });

  test("in Japanese, a hint's two sentences run on, with no space after the full stop", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=list&lang=ja");
    await page
      .getByRole("button", { name: "LLM プロバイダーを作成" })
      .first()
      .click();
    await expect(card(page, "Ollama")).toBeVisible();
    await card(page, "Ollama").click();
    await next(page).click();

    const text: string = (await hint(page, "base-url").textContent()) || "";

    // Two sentences, each translated: the second follows the full stop.
    expect(text).toContain("http://ollama:11434");
    expect(text).toContain("。");
    expect(text).not.toContain("。 ");
    await shoot(page, "form-connection-ollama-ja");
  });
});

test.describe("a provider's own page", () => {
  test("left blank, Model Name and Base URL say what the server uses instead", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=view&blankmodel=1");

    await expect(page.getByText("gpt-5.1 (default)")).toBeVisible();
    await expect(
      page.getByText("https://api.openai.com/v1 (default)"),
    ).toBeVisible();
    await expect(page.getByText("Not specified")).toHaveCount(0);
    await shoot(page, "form-provider-page-defaults");
  });

  test("its Edit form is the same form, its key left blank to keep it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=view");
    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(dialog(page)).toBeVisible();
    await expect(card(page, "OpenAI")).toHaveAttribute("aria-checked", "true");
    await next(page).click();
    await expect(nameInput(page)).toHaveValue("Chatgpt");
    await expect(dialog(page).getByTestId("llm-provider-api-key")).toHaveValue(
      "",
    );
    await shoot(page, "form-edit-connection");
  });
});

test.describe("Admin Dashboard > Settings > Global LLM Providers: adding one", () => {
  test("the same form, with no default switch: a global provider is every project's fallback", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=admin");
    await page
      .getByRole("button", { name: /Create/ })
      .first()
      .click();
    await expect(card(page, "OpenAI")).toBeVisible();
    await pick(page, "Groq");
    await expect(hint(page, "api-key")).toHaveText(
      "Create one at console.groq.com, under API Keys.",
    );
    await dialog(page)
      .getByRole("button", { name: /More fields/ })
      .click();
    await expect(dialog(page).getByText("Set as Default")).toHaveCount(0);
    await dialog(page).getByTestId("llm-provider-api-key").fill("gsk-test");
    await create(page).click();
    await expect(dialog(page)).toHaveCount(0);

    expect((await saves(page))[0]).toMatchObject({
      name: "Groq",
      llmType: "Groq",
      apiKey: "gsk-test",
      isGlobalLlm: true,
    });
  });

  test("the list names a blank Model by the model the server uses, as a project's list does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=admin&blankmodel=1");

    await expect(page.getByText("llama3.1 (default)")).toBeVisible();
    await expect(page.getByText("claude-sonnet-5-5")).toBeVisible();
    // The in-cluster vLLM, its model left to the server.
    await expect(
      page.getByText("First model the server lists", { exact: true }),
    ).toBeVisible();
    await shoot(page, "admin-list-default-model");
  });

  test("an OpenAI-compatible global provider is saved with only its address", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=admin");
    await page
      .getByRole("button", { name: /Create/ })
      .first()
      .click();
    await expect(card(page, "OpenAICompatible")).toBeVisible();
    await pick(page, "OpenAICompatible");
    await expect(hint(page, "model-name")).toHaveText(
      "Leave empty for the first model your server lists. To use another, type its name exactly as your server lists it.",
    );
    await dialog(page)
      .getByTestId("llm-provider-base-url")
      .fill("http://oneuptime-vllm.default.svc.cluster.local:8000/v1");
    await create(page).click();
    await expect(dialog(page)).toHaveCount(0);

    const saved: SavedProvider = (await saves(page))[0]!;

    expect(saved).toMatchObject({
      llmType: "OpenAICompatible",
      baseUrl: "http://oneuptime-vllm.default.svc.cluster.local:8000/v1",
      isGlobalLlm: true,
    });
    expect(saved.modelName || "").toBe("");
  });
});
