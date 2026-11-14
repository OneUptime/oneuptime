import { expect, Locator, Page } from "@playwright/test";
import path from "path";
import { JourneyRun } from "./JourneyBudget";

/*
 * A newcomer, doing one job in the product with only what is on screen:
 * the driver every journey of Journeys.spec.ts is written with.
 *
 * Every action finds what it acts on by what the person sees - a button's
 * words, a field's label, an option's name - and waits for the page to be
 * at rest first, so the counter (Counter/InPageCounter.js) reads each step
 * as the person would meet it. The counter counts; this only acts.
 *
 * Submitting does what a person does when the form says no: a field the
 * form marks as needing a value (aria-invalid) gets one - typed, or the
 * first option picked - and the button is pressed again. So a field a
 * change makes required is filled, and counted, and the journey fails on
 * its budget with the field named, rather than stopping short of it.
 *
 * A step that cannot be done fails with the journey, the step, where the
 * person was, the dialogs open and the fields in error, and what to do.
 */

const COUNTER_SCRIPT: string = path.join(
  __dirname,
  "Counter",
  "InPageCounter.js",
);

/*
 * How long the page must stay unchanged to be at rest: longer than the
 * pauses pages wait before they read (a telemetry rule's preview waits
 * 600ms, PREVIEW_READ_DELAY_IN_MS), so a step is read as it ends up and
 * the words it shows are the same on every run.
 */
const QUIET_MS: number = 700;

const DIALOG: string =
  '[data-testid="modal"], [data-testid="side-over"], .full-page-modal';

/*
 * A name as the person reads it: words given as a string are the whole
 * name, a pattern matches as it says.
 */
function byName(name: string | RegExp): {
  name: string | RegExp;
  exact?: boolean;
} {
  return typeof name === "string" ? { name, exact: true } : { name };
}

interface CounterWindow {
  __journeyCounter: {
    reset: () => void;
    noteSubmit: () => void;
    quietFor: () => number;
    read: () => JourneyRun;
  };
}

export default class Journey {
  public readonly page: Page;
  public readonly id: string;
  private currentStep: string = "(not started)";

  public constructor(page: Page, id: string) {
    this.page = page;
    this.id = id;
  }

  // Adds the counter to every document the page opens, before its scripts.
  public static async prepare(page: Page): Promise<void> {
    await page.addInitScript({ path: COUNTER_SCRIPT });
  }

  /*
   * Opens where the journey begins, waits for the product to draw it, and
   * starts counting from there: getting to the start costs nothing.
   */
  public async begin(url: string, ready: Locator): Promise<void> {
    await this.step(`open ${url}`, async () => {
      await this.page.goto(url);
      await expect(ready).toBeVisible();
      await this.settle();
      await this.page.evaluate(() => {
        (window as unknown as CounterWindow).__journeyCounter.reset();
      });
    });
  }

  /*
   * One step of the job, by what the person means to do. A failure says
   * which journey and step it was, and what was on screen.
   */
  public async step<T>(
    description: string,
    action: () => Promise<T>,
  ): Promise<T> {
    this.currentStep = description;
    try {
      return await action();
    } catch (error) {
      const where: string = await this.describeScreen();
      const reason: string =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Journey ${this.id} could not ${description}.\n${where}\nIf the job now takes another screen, dialog or field, write it into this journey in packages/E2E/Journeys/Journeys.spec.ts and raise its budget in Tests/Ops/JourneyBudgets.json, saying why in the pull request. If it takes fewer, take the step out and lower the budget.\n\n${reason}`,
      );
    }
  }

  /*
   * Waits until nothing on the page has changed for QUIET_MS - through a
   * full page load, which some links and saves make (Navigation.reload).
   */
  public async settle(): Promise<void> {
    await expect
      .poll(
        async () => {
          try {
            return await this.page.evaluate(() => {
              const counter: CounterWindow["__journeyCounter"] | undefined = (
                window as unknown as Partial<CounterWindow>
              ).__journeyCounter;
              return counter ? counter.quietFor() : -1;
            });
          } catch {
            // The page is between two documents.
            return -1;
          }
        },
        { intervals: [100, 100, 150, 250], timeout: 20000 },
      )
      .toBeGreaterThanOrEqual(QUIET_MS);
  }

  // Where the person works now: the dialog on top, or the page's content.
  public scope(): Locator {
    return this.page
      .locator(`${DIALOG} >> visible=true`)
      .last()
      .or(this.page.locator("main"))
      .last();
  }

  private async hasDialog(): Promise<boolean> {
    return (await this.page.locator(`${DIALOG} >> visible=true`).count()) > 0;
  }

  private async workArea(): Promise<Locator> {
    if (await this.hasDialog()) {
      return this.page.locator(`${DIALOG} >> visible=true`).last();
    }
    return this.page.locator("main");
  }

  /*
   * The products menu in the bar under the header - "Products" on Home, the
   * product's own name inside one - then the product by its name.
   */
  public async openProduct(name: string): Promise<void> {
    await this.step(`open ${name} from the Products menu`, async () => {
      await this.settle();
      await this.page
        .getByTestId("nav-children")
        .locator("button")
        .first()
        .click();
      // The menu's dialog has no box of its own: its list is what shows.
      const menu: Locator = this.page
        .getByRole("dialog", { name: "Products menu" })
        .getByRole("listbox");
      await expect(menu).toBeVisible();
      await this.settle();
      const option: Locator = menu
        .getByRole("option", { name: new RegExp(`^${name}\\b`) })
        .first();
      // A product in a folded category is found by typing its name.
      if (!(await option.isVisible())) {
        await this.page
          .getByRole("dialog", { name: "Products menu" })
          .getByRole("combobox")
          .pressSequentially(name);
        await this.settle();
      }
      await option.click();
      await expect(menu).toBeHidden();
      await this.settle();
    });
  }

  // The bar under the header's own links (User Settings, a product's name).
  public async openFromBar(name: string): Promise<void> {
    await this.step(`open ${name} from the bar under the header`, async () => {
      await this.settle();
      await this.page
        .getByRole("navigation")
        .getByRole("link", { name })
        .first()
        .click();
      await this.settle();
    });
  }

  /*
   * A button or a link, by its words, where the person works now: to a
   * person they are the same thing.
   */
  public async press(name: string | RegExp): Promise<void> {
    await this.step(`press "${name}"`, async () => {
      await this.settle();
      const area: Locator = await this.workArea();
      await area
        .getByRole("button", byName(name))
        .or(area.getByRole("link", byName(name)))
        .first()
        .click();
      await this.settle();
    });
  }

  /*
   * What the person waits for the product to show - "View logs" once the
   * first logs are in - a link or a button. The product checks every few
   * seconds (FIRST_RECORD_POLL_INTERVAL_MS is ten), so this waits up to
   * `seconds`; waiting is not counted.
   */
  public async waitUntilShown(
    name: string | RegExp,
    seconds: number,
  ): Promise<void> {
    await this.step(`wait for "${name}"`, async () => {
      const area: Locator = await this.workArea();
      const target: Locator = area
        .getByRole("link", { name })
        .or(area.getByRole("button", { name }))
        .first();
      await expect(target).toBeVisible({ timeout: seconds * 1000 });
      await this.settle();
    });
  }

  /*
   * A side menu entry of the page, by its words: its section is opened
   * first when it is folded.
   */
  public async sideMenu(name: string, section?: string): Promise<void> {
    await this.step(`choose "${name}" in the side menu`, async () => {
      await this.settle();
      const menu: Locator = this.page
        .locator("main")
        .getByRole("navigation", { name: "Main navigation" })
        .first();
      const entry: Locator = menu
        .getByRole("link", { name, exact: true })
        .first();
      if (section && !(await entry.isVisible())) {
        await menu
          .getByRole("button", { name: new RegExp(`^${section}`, "i") })
          .first()
          .click();
        await this.settle();
      }
      await entry.click();
      await this.settle();
    });
  }

  // A radio card or an option, by its name.
  public async choose(name: string | RegExp): Promise<void> {
    await this.step(`choose "${name}"`, async () => {
      await this.settle();
      const area: Locator = await this.workArea();
      await area.getByRole("radio", { name }).first().click();
      await this.settle();
    });
  }

  /*
   * Closes the list open now (a people picker stays open for the next
   * pick), as a person does: Escape.
   */
  public async closeList(): Promise<void> {
    await this.step("close the open list", async () => {
      await this.settle();
      await this.page.keyboard.press("Escape");
      await expect(this.page.getByRole("listbox")).toHaveCount(0);
      await this.settle();
    });
  }

  // A checkbox, by its name: one of Home's goals, say.
  public async tick(name: string | RegExp): Promise<void> {
    await this.step(`tick "${name}"`, async () => {
      await this.settle();
      const area: Locator = await this.workArea();
      await area.getByRole("checkbox", { name }).first().click();
      await this.settle();
    });
  }

  // Types into a field, found by its label, as a person types.
  public async type(label: string | RegExp, value: string): Promise<void> {
    await this.step(`type into "${label}"`, async () => {
      await this.settle();
      const area: Locator = await this.workArea();
      const field: Locator = area.getByLabel(label).first();
      await field.click();
      await field.pressSequentially(value);
      await this.settle();
    });
  }

  // Opens a picker by its label and picks an option by its name.
  public async pick(
    label: string | RegExp,
    option: string | RegExp,
  ): Promise<void> {
    await this.step(`pick "${option}" for "${label}"`, async () => {
      await this.settle();
      const area: Locator = await this.workArea();
      await area.getByLabel(label).first().click();
      await this.settle();
      await this.page.getByRole("option", { name: option }).first().click();
      await this.settle();
    });
  }

  // An option of the list open now (a picker's, a people search's), by name.
  public async option(name: string | RegExp): Promise<void> {
    await this.step(`pick "${name}" from the open list`, async () => {
      await this.settle();
      await this.page
        .getByRole("listbox")
        .getByRole("option", { name })
        .first()
        .click();
      await this.settle();
    });
  }

  // Turns a switch, found by its words.
  public async toggle(name: string | RegExp): Promise<void> {
    await this.step(`turn "${name}"`, async () => {
      await this.settle();
      const area: Locator = await this.workArea();
      await area.getByRole("switch", { name }).first().click();
      await this.settle();
    });
  }

  /*
   * Presses a form's button (Next, Create, Save), after noting the fields
   * left at their default. If the form then marks fields as needing a
   * value, they get one, and the button is pressed again.
   */
  public async submit(name: string | RegExp): Promise<void> {
    await this.step(`submit with "${name}"`, async () => {
      await this.settle();
      for (let round: number = 0; round < 4; round++) {
        await this.page.evaluate(() => {
          (window as unknown as CounterWindow).__journeyCounter.noteSubmit();
        });
        const area: Locator = await this.workArea();
        const button: Locator = area.getByRole("button", byName(name)).last();
        await button.click();
        await this.settle();
        const invalid: number = await this.fillWhatTheFormAsksFor();
        if (invalid === 0) {
          return;
        }
      }
      throw new Error(`The form still asks for values after four tries.`);
    });
  }

  /*
   * What a person does when a form marks fields as needing a value: types
   * one, or picks the first option. Returns how many fields it filled.
   */
  private async fillWhatTheFormAsksFor(): Promise<number> {
    const area: Locator = await this.workArea();
    const invalid: Locator = area.locator(
      '[aria-invalid="true"] >> visible=true',
    );
    const count: number = await invalid.count();

    for (let index: number = 0; index < count; index++) {
      const field: Locator = invalid.nth(index);
      const role: string | null = await field.getAttribute("role");
      const type: string = (
        (await field.getAttribute("type")) || "text"
      ).toLowerCase();

      await field.click();
      if (role === "combobox") {
        await this.settle();
        await this.page.getByRole("option").first().click();
      } else {
        /*
         * What the box's example shows, as a person copies it ("587",
         * "https://example.com"), else a value of the box's kind - over
         * whatever was typed there before.
         */
        const placeholder: string = (
          (await field.getAttribute("placeholder")) || ""
        ).trim();
        await field.fill("");
        await field.pressSequentially(
          placeholder ||
            (type === "url"
              ? "https://acme-commerce.example"
              : type === "email"
                ? "someone@acme-commerce.example"
                : type === "number"
                  ? "1"
                  : "Journey value"),
        );
      }
      await this.settle();
    }

    return count;
  }

  // What the counter counted: the journey's run.
  public async finish(): Promise<JourneyRun> {
    await this.settle();
    return await this.page.evaluate(() => {
      return (window as unknown as CounterWindow).__journeyCounter.read();
    });
  }

  private async describeScreen(): Promise<string> {
    try {
      const url: string = this.page.url();
      const dialogs: Array<string> = await this.page
        .locator(`${DIALOG} >> visible=true`)
        .evaluateAll((elements: Array<Element>) => {
          return elements.map((element: Element) => {
            const heading: Element | null = element.querySelector(
              '[data-testid="modal-title"], [data-testid="side-over-title"], h1, h2, h3',
            );
            return (heading?.textContent || "Dialog").trim();
          });
        });
      const errors: Array<string> = await this.page
        .locator('[data-testid="error-message"] >> visible=true')
        .allInnerTexts();
      return [
        `Step: ${this.currentStep}`,
        `Page: ${url}`,
        `Dialogs open: ${
          dialogs.length
            ? dialogs
                .map((title: string) => {
                  return `"${title}"`;
                })
                .join(", ")
            : "none"
        }`,
        `Fields in error: ${
          errors.length
            ? errors
                .map((text: string) => {
                  return `"${text}"`;
                })
                .join(", ")
            : "none"
        }`,
      ].join("\n");
    } catch {
      return `Step: ${this.currentStep}`;
    }
  }
}
