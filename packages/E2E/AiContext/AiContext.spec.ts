import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * The AI context (issue #5198), end to end in a browser, on the real pages
 * (AiContext/Fixture/Fixture.js): what a project's team writes for
 * OneUptime AI about its own systems - which service owns which symptom,
 * what depends on what, where the logs are, the words the team uses - and
 * what a run shows of what it read.
 *
 * Project Settings -> AI -> AI Features holds it on a card of its own
 * under Enable AI, in sight rather than folded: one quiet line until it is
 * written, then the notes as they read, with how long they are and about
 * how many tokens a model reads them as. A Project Owner or Admin writes
 * it in a dialog that counts the text against its limit as it is typed,
 * with an outline to start from; everyone else reads it, the button
 * locked. A run's activity says what the run read, and its View opens the
 * notes word for word.
 *
 * What is pinned here is what a person sees and what the page sends -
 * every save is recorded by the fixture - at a laptop's and a phone's
 * width, light and dark, German and Persian. The screenshots under
 * output/playwright/ai-context-ui are for the people who review the pages.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/ai-context-ui",
);

const CARD_DESCRIPTION: string =
  "What OneUptime AI should know about your systems: what depends on what, who owns which symptom, where the logs are. It reads this in every investigation, fix, postmortem draft and Ask AI chat.";
const DIALOG_DESCRIPTION: string =
  "Leave secrets out: anyone who can see what an AI run did can read the notes it was given.";
// The outline's first heading, and a first note typed under it.
const FIRST_NOTE_UNDER_OUTLINE: RegExp =
  /^## How our systems fit together\s+- checkout-api depends on payments-db\s/;
const FIELD_TITLE: string = "What OneUptime AI should know";
// The count past its limit, in the field's red.
const TOO_LONG_CLASS: RegExp = /text-red-600/;
// The written notes' first heading, as the fixture holds them (context=set).
const WRITTEN_NOTES: RegExp = /## How our systems fit together/;
const OUTLINE_HEADINGS: Array<string> = [
  "How our systems fit together",
  "Who owns what",
  "Where the logs are",
  "Words we use",
];

interface Recorded {
  saves: Array<Record<string, unknown>>;
  switches: Array<{ id: string; data: Record<string, unknown> }>;
  unhandled: Array<string>;
}

const pageErrors: WeakMap<Page, Array<string>> = new WeakMap();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  // Every request the pages made is one the fixture answers as the API would.
  expect((await recorded(page)).unhandled).toEqual([]);
  expect(pageErrors.get(page) || []).toEqual([]);
});

async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate(() => {
    const fixture: { state: unknown } = (
      window as unknown as { __aiContextFixture: { state: unknown } }
    ).__aiContextFixture;

    return JSON.parse(JSON.stringify(fixture.state)) as Recorded;
  });
}

/*
 * The page at rest: two frames for the styles the page's newest classes
 * need (the fixture's Tailwind adds them as the DOM changes), then every
 * finite animation played out - a dialog grows in over 150ms.
 */
async function atRest(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let frame: number = 0; frame < 3; frame++) {
      await new Promise((resolve: (value: unknown) => void) => {
        requestAnimationFrame(resolve);
      });
    }
    await Promise.all(
      document
        .getAnimations()
        .filter((animation: Animation) => {
          return animation.effect?.getTiming().iterations !== Infinity;
        })
        .map((animation: Animation) => {
          return animation.finished.catch(() => {
            return undefined;
          });
        }),
    );
  });
}

async function shoot(page: Page, name: string): Promise<void> {
  await atRest(page);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
  });
}

function card(page: Page): Locator {
  return page.locator("#ai-context");
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

function submit(page: Page): Locator {
  return dialog(page).getByTestId("modal-footer-submit-button");
}

function lengthLine(scope: Locator): Locator {
  return scope.getByTestId("ai-context-length");
}

// The page as wide as the screen, or wider - nothing may stick out sideways.
async function expectNothingOffScreen(page: Page): Promise<void> {
  await atRest(page);

  const overflow: number = await page.evaluate(() => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });

  expect(overflow).toBeLessThanOrEqual(0);
}

// A box's right edge stays inside the screen.
async function expectInsideScreen(page: Page, locator: Locator): Promise<void> {
  await atRest(page);

  const box: { x: number; width: number } | null = await locator.boundingBox();
  const width: number = page.viewportSize()!.width;

  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
}

// Opens the card's dialog with its one button.
async function openDialog(
  page: Page,
  buttonName: string,
  fieldTitle: string = FIELD_TITLE,
): Promise<Locator> {
  await card(page).getByRole("button", { name: buttonName }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText(fieldTitle);
  await atRest(page);
  return dialog(page);
}

// The editor's Markdown source, where a test types.
async function sourceOf(scope: Locator): Promise<Locator> {
  const toggle: Locator = scope.getByRole("button", {
    name: "Markdown",
    exact: true,
  });

  if (await toggle.isVisible()) {
    await toggle.click();
  }

  const textarea: Locator = scope.locator("textarea").first();
  await expect(textarea).toBeVisible();
  return textarea;
}

test.describe("the AI context card on Project Settings -> AI -> AI Features", () => {
  test("with none written: one quiet line, and a button that says what it does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await expect(card(page)).toBeVisible();
    await expect(
      card(page).getByTestId("card-header").getByText("AI context", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(card(page)).toContainText(CARD_DESCRIPTION);
    await expect(card(page).getByTestId("project-ai-context-empty")).toHaveText(
      "No AI context yet.",
    );
    await expect(
      card(page).getByRole("button", { name: "Add AI context" }),
    ).toBeEnabled();
    // No size line for notes that are not there.
    await expect(lengthLine(card(page))).toHaveCount(0);

    await shoot(page, "card-empty");
  });

  test("sits under Enable AI and its notice, above the folded daily limits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const order: Array<string> = await page.evaluate(() => {
      const switchCard: Element | null = document.querySelector(
        "[data-testid^='enable-ai-switch']",
      );
      const aiContext: Element | null = document.querySelector("#ai-context");
      const moreSettings: Element | null = document.querySelector(
        "[data-testid='project-ai-advanced-section']",
      );

      const position: (element: Element | null) => number = (
        element: Element | null,
      ): number => {
        return element ? element.getBoundingClientRect().top : -1;
      };

      return [
        `switch:${position(switchCard) >= 0}`,
        `order:${position(switchCard) < position(aiContext) && position(aiContext) < position(moreSettings)}`,
      ];
    });

    expect(order).toEqual(["switch:true", "order:true"]);
    // Not folded: the card is in sight without opening anything.
    await expect(card(page)).toBeInViewport();
  });

  test("an owner writes it: the outline to start from, the count as it is typed, and what is saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const modal: Locator = await openDialog(page, "Add AI context");

    await expect(modal).toContainText("AI context");
    await expect(modal).toContainText(DIALOG_DESCRIPTION);
    // Empty is an answer of its own: not "(Optional)".
    await expect(modal).not.toContainText(`${FIELD_TITLE} (Optional)`);
    await expect(lengthLine(modal)).toHaveText("0 of 20,000 characters");

    await shoot(page, "dialog-empty");

    // The outline fills the field with a heading for each kind of note.
    await modal.getByTestId("ai-context-outline-button").click();

    for (const heading of OUTLINE_HEADINGS) {
      await expect(modal).toContainText(heading);
    }
    // It is offered only while the field is empty.
    await expect(modal.getByTestId("ai-context-outline-button")).toHaveCount(0);
    await expect(lengthLine(modal)).toContainText("of 20,000 characters ·");

    /*
     * Its button is gone, and the keyboard did not go with it: it is in the
     * editor, under the outline's first heading, so what is typed next is
     * the first note.
     */
    await expect(
      modal.getByTestId("project-ai-context-field").getByRole("textbox"),
    ).toBeFocused();
    await page.keyboard.type("checkout-api depends on payments-db");

    const source: Locator = await sourceOf(modal);
    await expect(source).toHaveValue(FIRST_NOTE_UNDER_OUTLINE);
    const notes: string =
      "## Who owns what\n\n- 502 on /checkout: the payments team. Check vm-db-07 first.";
    await source.fill(notes);

    await expect(lengthLine(modal)).toHaveText(
      `${notes.length} of 20,000 characters · about ${Math.ceil(notes.length / 4)} tokens`,
    );

    await shoot(page, "dialog-written");

    await submit(page).click();
    await expect(dialog(page)).toBeHidden();

    const saves: Array<Record<string, unknown>> = (await recorded(page)).saves;
    expect(saves).toHaveLength(1);
    expect(saves[0]!["aiContext"]).toBe(notes);

    // The card now reads the notes, and its button edits them.
    await expect(
      card(page).getByTestId("project-ai-context-view"),
    ).toContainText("502 on /checkout: the payments team.");
    await expect(
      card(page).getByRole("button", { name: "Edit", exact: true }),
    ).toBeVisible();
    await expect(lengthLine(card(page))).toHaveText(
      `${notes.length} of 20,000 characters · about ${Math.ceil(notes.length / 4)} tokens`,
    );

    await shoot(page, "card-after-save");
  });

  test("past the limit, the count turns red and the save is refused, saying what to do - nothing is sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const modal: Locator = await openDialog(page, "Add AI context");
    const source: Locator = await sourceOf(modal);

    await source.fill("a".repeat(20_001));

    await expect(lengthLine(modal)).toContainText(
      "20,001 of 20,000 characters",
    );
    await expect(lengthLine(modal)).toHaveClass(TOO_LONG_CLASS);

    await submit(page).click();

    await expect(modal).toContainText("Use 20,000 characters or fewer.");
    await expect(dialog(page)).toBeVisible();
    expect((await recorded(page)).saves).toEqual([]);

    await shoot(page, "dialog-too-long");
  });

  test("written notes read as Markdown on the card, with their size", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "context=set");

    const view: Locator = card(page).getByTestId("project-ai-context-view");
    const frame: Locator = card(page).getByTestId("project-ai-context-frame");
    const firstHeading: Locator = view.getByRole("heading", {
      name: "How our systems fit together",
    });

    await expect(firstHeading).toBeVisible();
    await expect(view.locator("strong").first()).toHaveText("checkout-api");
    await expect(lengthLine(card(page))).toContainText("of 20,000 characters");
    await expect(
      card(page).getByRole("button", { name: "Edit", exact: true }),
    ).toBeVisible();

    // The first heading starts flush with the card's body: no gap above it.
    await atRest(page);
    const frameTop: number = (await frame.boundingBox())!.y;
    expect((await firstHeading.boundingBox())!.y - frameTop).toBeLessThan(4);

    await shoot(page, "card-set");

    // Taller than the fold: its table is under Show more.
    const toggle: Locator = card(page).getByTestId("project-ai-context-toggle");
    await expect(toggle).toHaveText("Show more");
    await toggle.click();
    await expect(view.locator("table")).toContainText("502 on /checkout");
    await expect(view.getByText("PSP", { exact: true })).toBeVisible();
  });

  test("short notes show whole: no Show more, no fade", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "context=short");

    const frame: Locator = card(page).getByTestId("project-ai-context-frame");

    await expect(frame).toContainText("checkout-api");
    await atRest(page);
    await expect(
      card(page).getByTestId("project-ai-context-toggle"),
    ).toHaveCount(0);
    expect(
      await frame.evaluate((element: Element) => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return `${style.maskImage || ""}${style.webkitMaskImage || ""}`;
      }),
    ).not.toContain("gradient");

    await shoot(page, "card-short");
  });

  test("a long text is folded with Show more, and Show less folds it again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "context=long");

    const toggle: Locator = card(page).getByTestId("project-ai-context-toggle");
    const view: Locator = card(page).getByTestId("project-ai-context-view");

    await expect(toggle).toHaveText("Show more");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      view.getByText("Service 24", { exact: true }),
    ).not.toBeInViewport();

    const foldedHeight: number = (await view.boundingBox())!.height;

    await toggle.click();
    await expect(toggle).toHaveText("Show less");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await atRest(page);

    expect((await view.boundingBox())!.height).toBeGreaterThan(
      foldedHeight * 2,
    );

    await shoot(page, "card-long-open");

    await toggle.click();
    await expect(toggle).toHaveText("Show more");
  });

  test("the dialog opens on the notes as they are, and a save keeps what was changed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "context=set");

    const modal: Locator = await openDialog(page, "Edit");
    const source: Locator = await sourceOf(modal);

    await expect(source).toHaveValue(WRITTEN_NOTES);
    // No outline over notes that exist.
    await expect(modal.getByTestId("ai-context-outline-button")).toHaveCount(0);

    await source.fill("## Glossary\n\n- PSP: our payment service provider.");
    await submit(page).click();
    await expect(dialog(page)).toBeHidden();

    expect((await recorded(page)).saves[0]!["aiContext"]).toBe(
      "## Glossary\n\n- PSP: our payment service provider.",
    );
  });

  test("a Project Admin writes it too", async ({ page }: { page: Page }) => {
    await open(page, "role=admin");

    await expect(
      card(page).getByRole("button", { name: "Add AI context" }),
    ).toBeEnabled();
  });

  test("a member reads it, and the button is locked, saying who may change it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "role=member&context=set");

    await expect(
      card(page).getByTestId("project-ai-context-view"),
    ).toContainText("checkout-api");

    const button: Locator = card(page).getByRole("button", {
      name: "Edit",
      exact: true,
    });

    await expect(button).toBeDisabled();
    await button.hover({ force: true });
    await expect(page.locator("[data-tippy-root]")).toContainText(
      "Project Owner",
    );
    await expect(page.locator("[data-tippy-root]")).toContainText(
      "Project Admin",
    );

    await shoot(page, "card-member");
  });

  test.describe("at a laptop's and a phone's width, light and dark", () => {
    for (const width of [1280, 390]) {
      for (const theme of ["light", "dark"]) {
        test(`${width}px, ${theme}: the card and its dialog fit the screen`, async ({
          page,
        }: {
          page: Page;
        }) => {
          await page.setViewportSize({ width, height: 900 });
          await open(
            page,
            `context=set${theme === "dark" ? "&theme=dark" : ""}${width === 1280 ? "&layout=page" : ""}`,
          );

          await expect(card(page)).toBeVisible();
          await expectInsideScreen(page, card(page));
          await expectNothingOffScreen(page);
          await shoot(page, `card-${width}-${theme}`);

          await openDialog(page, "Edit");
          await expectInsideScreen(page, dialog(page));
          await expect(lengthLine(dialog(page))).toBeVisible();
          await shoot(page, `dialog-${width}-${theme}`);
        });
      }
    }

    /*
     * The fold fades the notes themselves out - a mask - so it fades into
     * whatever the card's colour is: no white band over a dark card.
     */
    test("dark: the fold fades into the card, not into white", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, "context=long&theme=dark");

      const frame: Locator = card(page).getByTestId("project-ai-context-frame");

      await expect(
        card(page).getByTestId("project-ai-context-toggle"),
      ).toBeVisible();

      const fade: { mask: string; overlays: number } = await frame.evaluate(
        (element: Element) => {
          const style: CSSStyleDeclaration = getComputedStyle(element);
          return {
            mask: `${style.maskImage || ""} ${style.webkitMaskImage || ""}`,
            // Nothing drawn over the notes to fade them.
            overlays: element.querySelectorAll("[class*='bg-gradient']").length,
          };
        },
      );

      expect(fade.mask).toContain("linear-gradient");
      expect(fade.overlays).toBe(0);
    });
  });

  test("German: the card, its button and the dialog in the reader's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=de");

    await expect(card(page)).toContainText("KI-Kontext");
    await expect(card(page)).toContainText("Noch kein KI-Kontext.");

    await openDialog(
      page,
      "KI-Kontext hinzufügen",
      "Was OneUptime AI wissen sollte",
    );

    await expect(lengthLine(dialog(page))).toHaveText("0 von 20.000 Zeichen");

    await shoot(page, "dialog-de");
  });
});

test.describe("what a run read, in its details", () => {
  async function openActivity(page: Page, query: string): Promise<Locator> {
    await open(page, `page=run&${query}`);
    await page.getByTestId("investigation-details-toggle").click();

    const line: Locator = page.locator("[data-ai-context='true']");
    await expect(line).toBeVisible();
    return line;
  }

  test("the project's notes: one line in the activity, and View opens them word for word", async ({
    page,
  }: {
    page: Page;
  }) => {
    const line: Locator = await openActivity(page, "read=project");

    await expect(line).toContainText("Read the project's AI context");
    await expect(line).toContainText("about");
    await expect(line).toContainText("tokens");

    /*
     * Its words start where every other step's do: a log line's dot is as
     * wide as the other steps' icons.
     */
    const starts: Array<number> = await page
      .getByTestId("activity-step-text")
      .evaluateAll((texts: Array<Element>) => {
        return texts.map((text: Element): number => {
          return Math.round(text.getBoundingClientRect().x);
        });
      });
    expect(starts.length).toBeGreaterThan(2);
    expect(new Set(starts).size).toBe(1);

    // View is read with the line it belongs to.
    await expect(
      line.getByTestId("ai-context-activity-view-button"),
    ).toHaveAccessibleDescription("Read the project's AI context");

    await shoot(page, "run-line");

    await line.getByTestId("ai-context-activity-view-button").click();

    const modal: Locator = dialog(page);
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("AI context this run read");
    await expect(modal).toContainText(
      "OneUptime AI read this first, before anything else in the run.",
    );

    const parts: Locator = modal.getByTestId("ai-context-activity-part");
    await expect(parts).toHaveCount(1);
    await expect(parts.first().getByRole("heading").first()).toHaveText(
      "Project",
    );
    await expect(parts.first().locator("table")).toContainText(
      "502 on /checkout",
    );
    await expect(parts.first()).toContainText("characters · about");
    // A run that left nothing out says nothing about it.
    await expect(modal.getByTestId("ai-context-activity-left-out")).toHaveCount(
      0,
    );

    // The notes' first heading starts flush with their box: no gap above it.
    await atRest(page);
    const noteHeading: Locator = parts
      .first()
      .getByRole("heading", { name: "How our systems fit together" });
    const box: { y: number } = (await noteHeading
      .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]")
      .boundingBox())!;
    expect((await noteHeading.boundingBox())!.y - box.y).toBeLessThan(20);

    await shoot(page, "run-dialog");

    await modal.getByRole("button", { name: "Close" }).last().click();
    await expect(dialog(page)).toBeHidden();
  });

  test("the project's notes and two rules': named in the order the run read them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const line: Locator = await openActivity(page, "read=rules");

    await expect(line).toContainText(
      "Read the AI context of the project and 2 AI rules",
    );

    await line.getByTestId("ai-context-activity-view-button").click();

    const titles: Array<string> = (
      await dialog(page)
        .getByTestId("ai-context-activity-part")
        .locator("h3")
        .allInnerTexts()
    ).map((title: string) => {
      return title.trim();
    });

    expect(titles).toEqual([
      "Project",
      "AI rule Checkout incidents",
      "AI rule Search incidents",
    ]);
    await expect(dialog(page)).toContainText("Restarting checkout-api is safe");

    // A rule's heading: its name in full weight, "AI rule" quieter.
    const ruleHeading: Locator = dialog(page)
      .getByTestId("ai-context-activity-part")
      .nth(1)
      .locator("h3");
    const weights: Array<string> = await ruleHeading.evaluate(
      (heading: Element) => {
        return [
          getComputedStyle(heading).fontWeight,
          getComputedStyle(heading.querySelector("bdi")!).fontWeight,
        ];
      },
    );
    await expect(ruleHeading.locator("bdi")).toHaveText("Checkout incidents");
    expect(weights).toEqual(["400", "600"]);

    await shoot(page, "run-dialog-rules");
  });

  test("one rule's notes alone", async ({ page }: { page: Page }) => {
    const line: Locator = await openActivity(page, "read=ruleOnly");

    await expect(line).toContainText("Read the AI context of 1 AI rule");
  });

  test("a rule's notes left out for the run's limit: a warning line says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openActivity(page, "read=leftOut");

    await expect(page.getByTestId("investigation-details")).toContainText(
      "Left out the AI context of 1 AI rule: a run reads at most 30,000 characters of AI context",
    );

    await shoot(page, "run-left-out");

    // Its View says it again, last, and names the rule it left out.
    await page.getByTestId("ai-context-activity-view-button").click();
    const leftOut: Locator = dialog(page).getByTestId(
      "ai-context-activity-left-out",
    );
    await expect(leftOut).toContainText(
      "Left out the AI context of 1 AI rule: a run reads at most 30,000 characters of AI context",
    );
    await expect(leftOut.getByRole("listitem")).toHaveText([
      "Search incidents",
    ]);
    await leftOut.scrollIntoViewIfNeeded();
    await shoot(page, "run-dialog-left-out");
  });

  /*
   * A run still working shows only its latest steps: its AI context line
   * leaves the feed as steps come in. The notes someone opened from it stay
   * open over the steps - nothing closes under the reader.
   */
  test("a live run: the notes opened from its line stay open while new steps push the line away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=live");

    const line: Locator = page.locator("[data-ai-context='true']");
    await expect(line).toContainText("Read the project's AI context");

    await line.getByTestId("ai-context-activity-view-button").click();
    await expect(dialog(page)).toContainText("AI context this run read");

    await page.evaluate(() => {
      (
        window as unknown as {
          __aiContextFixture: { addSteps: (count: number) => void };
        }
      ).__aiContextFixture.addSteps(6);
    });

    // The line has left the feed; the notes are still open, whole.
    await expect(page.getByTestId("live-steps")).toContainText("earlier step");
    await expect(line).toHaveCount(0);
    await expect(dialog(page)).toBeVisible();
    await expect(
      dialog(page).getByRole("heading", {
        name: "How our systems fit together",
      }),
    ).toBeVisible();

    await shoot(page, "run-live-dialog-open");

    await dialog(page).getByRole("button", { name: "Close" }).last().click();
    await expect(dialog(page)).toBeHidden();
  });

  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      test(`${width}px, ${theme}: the line and its dialog fit the screen`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize({ width, height: 900 });

        const line: Locator = await openActivity(
          page,
          `read=rules${theme === "dark" ? "&theme=dark" : ""}`,
        );

        await expectInsideScreen(page, line);
        await expectNothingOffScreen(page);

        await line.getByTestId("ai-context-activity-view-button").click();
        await expect(dialog(page)).toBeVisible();
        await expectInsideScreen(page, dialog(page));
        await shoot(page, `run-dialog-${width}-${theme}`);
      });
    }
  }

  test("Persian: the line and the dialog read right to left, in Persian", async ({
    page,
  }: {
    page: Page;
  }) => {
    const line: Locator = await openActivity(page, "read=rules&lang=fa");

    await expect(line).toContainText("زمینهٔ هوش مصنوعی");

    await line.getByTestId("ai-context-activity-view-button").click();
    await expect(dialog(page)).toContainText(
      "زمینهٔ هوش مصنوعی که این اجرا خواند",
    );
    await expectInsideScreen(page, dialog(page));

    // The dialog reads right to left; the team's English notes left to right.
    const directions: Array<string> = await dialog(page)
      .getByTestId("ai-context-activity-part")
      .first()
      .evaluate((part: Element) => {
        const notes: Element = part.querySelector("[dir='auto']")!;
        return [
          getComputedStyle(part).direction,
          getComputedStyle(notes).direction,
        ];
      });
    expect(directions).toEqual(["rtl", "ltr"]);

    await shoot(page, "run-dialog-fa");
  });
});
