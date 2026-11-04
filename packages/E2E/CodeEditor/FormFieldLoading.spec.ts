import { Locator, Page, Route, expect, test } from "@playwright/test";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import {
  DrawnBox,
  DrawnBoxes,
  drawnPlacesOf,
  readDrawnBoxes,
  recordDrawnBoxes,
  waitForFrames,
} from "../SuiteHelpers/DrawnBoxes";

/*
 * A form field's code editor, Markdown editor and file picker are files of
 * their own, so a page with no such field does not download them before it
 * can draw (issue #5619). Until a form's control has arrived its field draws a
 * place for it, and nothing on the form may move when it does. That is a layout
 * fact, and jsdom has no layout: FormFieldLazyControls.test.tsx pins the
 * classes and numbers that decide it, and this measures what they come to.
 *
 * Each test holds the control's real file back at the network, measures the
 * form and the Save button under the field in one frame, lets the file through,
 * and holds them to where they were: at a desktop's width, and at a phone's,
 * where the words wrap and a file's buttons take a line of their own.
 */

// The files a form's controls are in: the import() of each, in LazyCodeEditor etc.
const CONTROL_FILES: RegExp =
  /\/dist\/(?:CodeEditor|YamlEditor|MarkdownEditor|FilePicker)-[^/]*\.js(?:\?.*)?$/;

const SAVE_BUTTON_ID: string = "form-field-loading-submit-button";

// A whole page's load, for what comes after the page reloads for a control.
const AFTER_RELOAD: { timeout: number } = { timeout: 60000 };

const CODE_EDITOR: string = "code-editor-placeholder";
const YAML_EDITOR: string = "yaml-editor-placeholder";
const MARKDOWN_EDITOR: string = "markdown-editor-placeholder";
const FILE_PICKER: string = "file-picker-placeholder";

// Each of the fixture's scenarios, the place it draws, and what shows it arrived.
const SCENARIOS: Array<{ id: string; placeholder: string; control: string }> = [
  {
    id: "json-empty",
    placeholder: CODE_EDITOR,
    control: "[data-testid='code-editor-input']",
  },
  {
    id: "json-three-lines",
    placeholder: CODE_EDITOR,
    control: "[data-testid='code-editor-input']",
  },
  {
    id: "json-ten-lines",
    placeholder: CODE_EDITOR,
    control: "[data-testid='code-editor-input']",
  },
  {
    id: "json-too-long",
    placeholder: CODE_EDITOR,
    control: "[data-testid='code-editor-input']",
  },
  {
    id: "json-with-variables",
    placeholder: CODE_EDITOR,
    control: "[data-testid='code-editor-input']",
  },
  {
    id: "html-empty",
    placeholder: CODE_EDITOR,
    control: "[data-testid='code-editor-input']",
  },
  {
    id: "css-empty",
    placeholder: CODE_EDITOR,
    control: "[data-testid='code-editor-input']",
  },
  {
    id: "javascript-empty",
    placeholder: CODE_EDITOR,
    control: "[data-testid='code-editor-input']",
  },
  {
    id: "yaml-empty",
    placeholder: YAML_EDITOR,
    control: "[data-testid='yaml-editor']",
  },
  {
    id: "yaml-thirty-lines",
    placeholder: YAML_EDITOR,
    control: "[data-testid='yaml-editor']",
  },
  {
    id: "markdown-empty",
    placeholder: MARKDOWN_EDITOR,
    control: "[data-testid='markdown-editor-toolbar']",
  },
  {
    id: "markdown-short",
    placeholder: MARKDOWN_EDITOR,
    control: "[data-testid='markdown-editor-toolbar']",
  },
  {
    id: "markdown-with-variables",
    placeholder: MARKDOWN_EDITOR,
    control: "[data-testid='markdown-editor-toolbar']",
  },
  { id: "file-empty", placeholder: FILE_PICKER, control: "input[type='file']" },
  {
    id: "image-empty",
    placeholder: FILE_PICKER,
    control: "input[type='file']",
  },
  {
    id: "files-empty",
    placeholder: FILE_PICKER,
    control: "input[type='file']",
  },
  { id: "file-held", placeholder: FILE_PICKER, control: "input[type='file']" },
  { id: "files-held", placeholder: FILE_PICKER, control: "input[type='file']" },
  {
    id: "files-full",
    placeholder: FILE_PICKER,
    control: "[data-testid='file-picker-full']",
  },
];

/*
 * Where a phone's width changes what is drawn: the words of a prompt and a
 * help line wrap, and a file's buttons take a line of their own under its name.
 * The code fields are measured there once each kind, as nothing in them wraps.
 */
const PHONE_SCENARIOS: Array<string> = [
  "json-empty",
  "yaml-empty",
  "markdown-empty",
  "markdown-with-variables",
  "file-empty",
  "files-empty",
  "file-held",
  "files-held",
  "files-full",
];

const WIDTHS: Array<{
  name: string;
  width: number;
  scenarios: Array<string> | null;
}> = [
  { name: "a desktop's", width: 1280, scenarios: null },
  { name: "a phone's", width: 375, scenarios: PHONE_SCENARIOS },
];

interface HeldFiles {
  // How many of the controls' files have been asked for and held back.
  count: () => number;
  // Lets them through, and whatever is asked for after them.
  release: () => Promise<void>;
  // Refuses them, and whatever is asked for after them.
  refuse: () => Promise<void>;
}

// Holds every control's file back, from before the page loads.
const holdControlFiles: (page: Page) => Promise<HeldFiles> = async (
  page: Page,
): Promise<HeldFiles> => {
  const held: Array<Route> = [];
  let state: "holding" | "releasing" | "refusing" = "holding";

  await page.route(CONTROL_FILES, async (route: Route): Promise<void> => {
    if (state === "holding") {
      held.push(route);
    } else if (state === "releasing") {
      await route.continue();
    } else {
      await route.abort();
    }
  });

  return {
    count: (): number => {
      return held.length;
    },
    release: async (): Promise<void> => {
      state = "releasing";

      for (const route of held.splice(0)) {
        await route.continue();
      }
    },
    refuse: async (): Promise<void> => {
      state = "refusing";

      for (const route of held.splice(0)) {
        await route.abort();
      }
    },
  };
};

type GoToFormFunction = (page: Page, scenario: string) => Promise<void>;

const goToForm: GoToFormFunction = async (
  page: Page,
  scenario: string,
): Promise<void> => {
  await page.goto(`/form-field-loading?scenario=${scenario}`);
};

/*
 * Waits for the place to be drawn in full: the page's Tailwind writes the
 * stylesheet a moment after the elements it is for, and a font swaps in.
 */
type PlaceIsDrawnFunction = (page: Page, placeholder: Locator) => Promise<void>;

const placeIsDrawn: PlaceIsDrawnFunction = async (
  page: Page,
  placeholder: Locator,
): Promise<void> => {
  await expect(placeholder).toBeVisible();
  await expect(placeholder.locator(".animate-pulse").first()).toHaveCSS(
    "animation-name",
    "pulse",
  );
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
};

// The form, and the button under the field: one frame's read of where they are.
type FormBoxesFunction = (page: Page) => Promise<Array<FrameBox>>;

const formBoxes: FormBoxesFunction = async (
  page: Page,
): Promise<Array<FrameBox>> => {
  return boxesInOneFrame([
    page.getByTestId("the-form"),
    page.locator(`#${SAVE_BUTTON_ID}`),
  ]);
};

// Half a pixel either way is how a browser rounds, not a move.
type ExpectSameBoxesFunction = (
  page: Page,
  before: Array<FrameBox>,
) => Promise<void>;

const expectSameBoxes: ExpectSameBoxesFunction = async (
  page: Page,
  before: Array<FrameBox>,
): Promise<void> => {
  await expect
    .poll(async (): Promise<Array<FrameBox>> => {
      return (await formBoxes(page)).map((box: FrameBox): FrameBox => {
        return {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      });
    })
    .toEqual(
      before.map((box: FrameBox): FrameBox => {
        return {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      }),
    );
};

for (const { name, width, scenarios } of WIDTHS) {
  test.describe(`at ${name} width`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const scenario of SCENARIOS.filter(
      (candidate: { id: string }): boolean => {
        return !scenarios || scenarios.includes(candidate.id);
      },
    )) {
      test(`${scenario.id}: nothing moves when the control arrives`, async ({
        page,
      }: {
        page: Page;
      }) => {
        const files: HeldFiles = await holdControlFiles(page);

        await goToForm(page, scenario.id);

        const placeholder: Locator = page.getByTestId(scenario.placeholder);

        await placeIsDrawn(page, placeholder);

        const before: Array<FrameBox> = await formBoxes(page);

        // The file was asked for as the form was drawn, and has not arrived.
        expect(files.count()).toBeGreaterThan(0);
        await expect(page.locator(scenario.control)).toHaveCount(0);

        await files.release();

        await expect(placeholder).toHaveCount(0);
        await expect(page.locator(scenario.control)).toHaveCount(1);

        await expectSameBoxes(page, before);
      });
    }
  });
}

test.describe("the frames in between", () => {
  /*
   * A read once the page has settled sees only how it ends: the button under
   * the field is followed through every frame painted from the moment the
   * place is drawn, so a control drawn small and grown into its size fails.
   */
  for (const scenario of [
    { id: "json-empty", placeholder: CODE_EDITOR },
    { id: "markdown-empty", placeholder: MARKDOWN_EDITOR },
    { id: "file-empty", placeholder: FILE_PICKER },
  ]) {
    test(`${scenario.id}: the button under the field stays in its place in every frame`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const files: HeldFiles = await holdControlFiles(page);

      await recordDrawnBoxes(page, { selector: `#${SAVE_BUTTON_ID}` });

      await goToForm(page, scenario.id);

      await placeIsDrawn(page, page.getByTestId(scenario.placeholder));
      await waitForFrames(page, 3);

      const drawnBefore: DrawnBoxes = await readDrawnBoxes(page);
      const framesBefore: number = (drawnBefore[SAVE_BUTTON_ID] || []).length;

      await files.release();

      await expect(page.getByTestId(scenario.placeholder)).toHaveCount(0);
      await waitForFrames(page, 10);

      const boxes: Array<DrawnBox> =
        (await readDrawnBoxes(page))[SAVE_BUTTON_ID] || [];

      // The place it was drawn at before, and any it was drawn at since.
      expect(drawnPlacesOf(boxes.slice(framesBefore - 1))).toHaveLength(1);
    });
  }
});

test.describe("a control whose file will not arrive", () => {
  test("the page reloads once, which fetches it, and the control is there", async ({
    page,
  }: {
    page: Page;
  }) => {
    let refused: number = 0;

    await page.route(CONTROL_FILES, async (route: Route): Promise<void> => {
      if (refused === 0) {
        refused++;
        await route.abort();
        return;
      }

      await route.continue();
    });

    await goToForm(page, "markdown-empty");

    await expect(page.getByTestId("markdown-editor-toolbar")).toBeVisible(
      AFTER_RELOAD,
    );

    expect(refused).toBe(1);
  });

  test("still not, after reloading: the field says so, the same size, and the form stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    const files: HeldFiles = await holdControlFiles(page);

    await goToForm(page, "json-empty");

    await placeIsDrawn(page, page.getByTestId(CODE_EDITOR));

    const before: Array<FrameBox> = await formBoxes(page);

    await files.refuse();

    await expect(page.getByText("This couldn't be loaded.")).toBeVisible(
      AFTER_RELOAD,
    );
    await expect(page.getByTestId(CODE_EDITOR)).toHaveAttribute(
      "data-load-state",
      "failed",
    );
    await expect(page.getByTestId("chunk-load-recovery-reload")).toBeVisible();

    await expectSameBoxes(page, before);

    // The rest of the form is as it was, and still answers.
    await expect(page.getByLabel("Name")).toHaveValue("Database");
    await page.getByLabel("Name").fill("Primary database");
    await expect(page.getByLabel("Name")).toHaveValue("Primary database");
  });

  test("with something typed on the form, it asks before the reload that would lose it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const files: HeldFiles = await holdControlFiles(page);

    await goToForm(page, "markdown-empty");

    await placeIsDrawn(page, page.getByTestId(MARKDOWN_EDITOR));

    await page.getByLabel("Name").fill("Primary database");

    await files.refuse();

    await expect(
      page.getByText(
        "This needs the latest version. Save your changes, then reload the page.",
      ),
    ).toBeVisible();

    // No reload came: what was typed is still there.
    await expect(page.getByLabel("Name")).toHaveValue("Primary database");
  });
});
