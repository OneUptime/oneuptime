import { Locator, Page, TestInfo, expect, test } from "@playwright/test";

/*
 * A dropdown custom field's option editor in a real browser, with the app's
 * Tailwind, theme and font (#4564: "allow administrators to edit the
 * available options for existing Select and Multi-Select custom fields ...
 * adding, renaming, removing, reordering").
 *
 * jsdom moves nothing and lays nothing out, so what only a browser can show
 * is checked here: an option dragged by its grip with a mouse and from the
 * keyboard - also inside a list that is dragged itself, as a form's
 * question is - the notes that say what a rename and a removal touch as they
 * read on screen, the dark theme, and a phone's width. The rules behind the
 * notes are pinned in Common/Tests/UI/Components/CustomFields.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type BoxOfFunction = (locator: Locator) => Promise<Box>;

const boxOf: BoxOfFunction = async (locator: Locator): Promise<Box> => {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Not on screen");
  }

  return box;
};

type OpenFunction = (page: Page, query: string) => Promise<void>;

const open: OpenFunction = async (page: Page, query: string): Promise<void> => {
  await page.goto(`/?${query}`);
  await expect(page.getByTestId("dropdown-option-value-0")).toBeVisible();
};

type OptionValuesFunction = (page: Page) => Promise<Array<string>>;

// The options as they would be saved, in order.
const savedOptions: OptionValuesFunction = async (
  page: Page,
): Promise<Array<string>> => {
  const text: string =
    (await page.getByTestId("submitted").textContent()) || "";

  if (text.trim().startsWith("[")) {
    return (JSON.parse(text) as Array<{ value: string }>).map(
      (option: { value: string }): string => {
        return option.value;
      },
    );
  }

  return text.split("\n").filter((line: string): boolean => {
    return line.trim().length > 0;
  });
};

type RenamesFunction = (
  page: Page,
) => Promise<Array<{ from: string; to: string }>>;

const renames: RenamesFunction = async (
  page: Page,
): Promise<Array<{ from: string; to: string }>> => {
  return JSON.parse(
    (await page.getByTestId("renames").textContent()) || "[]",
  ) as Array<{ from: string; to: string }>;
};

type InputValuesFunction = (page: Page) => Promise<Array<string>>;

// The rows as the editor shows them, top to bottom.
const rowTexts: InputValuesFunction = async (
  page: Page,
): Promise<Array<string>> => {
  return await page
    .locator('input[data-testid^="dropdown-option-value-"]')
    .evaluateAll((inputs: Array<Element>): Array<string> => {
      return inputs.map((input: Element): string => {
        return (input as HTMLInputElement).value;
      });
    });
};

type GripFunction = (page: Page, index: number) => Locator;

const grip: GripFunction = (page: Page, index: number): Locator => {
  return page
    .getByTestId(`dropdown-option-row-${index}`)
    .getByTestId("drag-handle");
};

type DragFunction = (page: Page, from: Locator, to: Locator) => Promise<void>;

/*
 * A drag the way a hand makes one: press, a first small move that starts it,
 * then steps to the target, and release once the list has made room.
 */
const drag: DragFunction = async (
  page: Page,
  from: Locator,
  to: Locator,
): Promise<void> => {
  const start: Box = await boxOf(from);
  const end: Box = await boxOf(to);

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2,
    start.y + start.height / 2 + 6,
    { steps: 3 },
  );
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2 - 4, {
    steps: 12,
  });
  await page.waitForTimeout(300);
  await page.mouse.up();
};

test.describe("reordering options", () => {
  test("drags an option by its grip to where it is listed, and renames nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=edit");

    await drag(page, grip(page, 2), grip(page, 0));

    await expect
      .poll(async () => {
        return await savedOptions(page);
      })
      .toEqual(["Facility C", "Facility A", "Facility B"]);

    expect(await rowTexts(page)).toEqual([
      "Facility C",
      "Facility A",
      "Facility B",
    ]);
    // Moving an option only changes the order: nothing to rename.
    expect(await renames(page)).toEqual([]);
    // Nothing was taken out either: only Old Site, no option since before.
    const retired: Locator = page.getByTestId("dropdown-options-retired");
    await expect(retired).toContainText("Old Site");
    for (const option of ["Facility A", "Facility B", "Facility C"]) {
      await expect(retired).not.toContainText(option);
    }
  });

  test("from the keyboard: Space picks the option up, the arrows move it, Space drops it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=edit");

    await grip(page, 0).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");

    await expect
      .poll(async () => {
        return await savedOptions(page);
      })
      .toEqual(["Facility B", "Facility C", "Facility A"]);

    // The grip moved with its option and keeps the focus.
    await expect(grip(page, 2)).toBeFocused();
    await expect(grip(page, 2)).toHaveAccessibleName(
      "Drag to reorder Facility A",
    );
  });

  test("inside a list that is dragged itself - a form's question - an option drags on its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=nested");

    await drag(page, grip(page, 2), grip(page, 0));

    await expect
      .poll(async () => {
        return await savedOptions(page);
      })
      .toEqual(["Facility C", "Facility A", "Facility B"]);

    // The questions stayed where they were.
    await expect(page.getByTestId("questions")).toHaveText(
      JSON.stringify(["Where?", "Since when?"]),
    );

    // And the question still drags by its own handle.
    await drag(
      page,
      page.getByTestId("question-handle-0"),
      page.getByTestId("question-1"),
    );

    await expect(page.getByTestId("questions")).toHaveText(
      JSON.stringify(["Since when?", "Where?"]),
    );
  });
});

test.describe("renaming an option", () => {
  test("says what it was renamed from and how many incidents will show the new name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=edit");

    await page.getByTestId("dropdown-option-value-0").fill("Facility Alpha");

    await expect(page.getByTestId("dropdown-option-renamed-0")).toHaveText(
      'Renamed from "Facility A": 12 incidents will show the new name.',
    );
    await expect
      .poll(async () => {
        return await renames(page);
      })
      .toEqual([{ from: "Facility A", to: "Facility Alpha" }]);
    await expect
      .poll(async () => {
        return await savedOptions(page);
      })
      .toEqual(["Facility Alpha", "Facility B", "Facility C"]);

    // Typing the old name back is no rename at all.
    await page.getByTestId("dropdown-option-value-0").fill("Facility A");
    await expect(page.getByTestId("dropdown-option-renamed-0")).toBeHidden();
    await expect
      .poll(async () => {
        return await renames(page);
      })
      .toEqual([]);
  });

  test("an option nobody chose is renamed without a count", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=edit");

    await page.getByTestId("dropdown-option-value-2").fill("Facility Gamma");

    await expect(page.getByTestId("dropdown-option-renamed-2")).toHaveText(
      'Renamed from "Facility C".',
    );
  });

  test("a renamed option keeps its color", async ({ page }: { page: Page }) => {
    await open(page, "scenario=edit");

    await page.getByTestId("dropdown-option-value-0").fill("Facility Alpha");

    await expect(
      page
        .getByTestId("dropdown-option-color-0")
        .getByTestId("color-picker-trigger"),
    ).toHaveText(/Red/);
    await expect
      .poll(async () => {
        return JSON.parse(
          (await page.getByTestId("submitted").textContent()) || "[]",
        )[0];
      })
      .toEqual({ value: "Facility Alpha", color: "#ef4444" });
  });

  test("two options of the same name are pointed out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=edit");

    await page.getByTestId("dropdown-option-value-0").fill("Facility B");

    await expect(page.getByTestId("dropdown-option-duplicate-0")).toHaveText(
      "Another option has this name. Each option needs its own.",
    );
    await expect(page.getByTestId("dropdown-option-duplicate-1")).toBeVisible();
  });
});

test.describe("taking options out", () => {
  test("an option in use is listed under No longer options with how many incidents keep it, and Undo puts it back where it was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=edit");

    await page
      .getByTestId("dropdown-option-row-1")
      .getByRole("button", { name: "Remove" })
      .click();

    const retired: Locator = page.getByTestId("dropdown-options-retired");

    await expect(retired).toBeVisible();
    await expect(retired).toContainText("No longer options");
    await expect(retired).toContainText(
      "Incidents that have these values keep them unless you pick an option for them.",
    );
    await expect(page.getByTestId("dropdown-option-retired-0")).toContainText(
      "Facility B",
    );
    await expect(
      page.getByTestId("dropdown-option-retired-count-0"),
    ).toHaveText("4 incidents have it.");
    await expect
      .poll(async () => {
        return await savedOptions(page);
      })
      .toEqual(["Facility A", "Facility C"]);
    // Kept on the incidents unless an option is picked: nothing renamed.
    expect(await renames(page)).toEqual([]);

    await page.getByTestId("dropdown-option-retired-undo-0").click();

    await expect
      .poll(async () => {
        return await rowTexts(page);
      })
      .toEqual(["Facility A", "Facility B", "Facility C"]);
    await expect
      .poll(async () => {
        return await savedOptions(page);
      })
      .toEqual(["Facility A", "Facility B", "Facility C"]);
    // Its color came back with it.
    await expect(
      page
        .getByTestId("dropdown-option-color-1")
        .getByTestId("color-picker-trigger"),
    ).toHaveText(/No color/);
    // Only Old Site, no option since before, is left.
    await expect(page.getByTestId("dropdown-option-retired-0")).toContainText(
      "Old Site",
    );
    await expect(page.getByTestId("dropdown-option-retired-1")).toHaveCount(0);
  });

  test("the incidents that have an option taken out can be moved to another option", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=edit");

    await page
      .getByTestId("dropdown-option-row-1")
      .getByRole("button", { name: "Remove" })
      .click();

    await page
      .getByRole("combobox", { name: "What happens to Facility B" })
      .click();
    await page.getByRole("option", { name: "Facility C" }).click();

    await expect
      .poll(async () => {
        return await renames(page);
      })
      .toEqual([{ from: "Facility B", to: "Facility C" }]);
  });

  test("a value that was no option before can be tidied onto one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=edit");

    const oldSite: Locator = page.getByTestId("dropdown-option-retired-0");

    await expect(oldSite).toContainText("Old Site");
    await expect(
      page.getByTestId("dropdown-option-retired-count-0"),
    ).toHaveText("3 incidents have it.");
    // It was not taken out here: there is nothing to undo.
    await expect(
      page.getByTestId("dropdown-option-retired-undo-0"),
    ).toHaveCount(0);

    await page
      .getByRole("combobox", { name: "What happens to Old Site" })
      .click();
    await page.getByRole("option", { name: "Facility A" }).click();

    await expect
      .poll(async () => {
        return await renames(page);
      })
      .toEqual([{ from: "Old Site", to: "Facility A" }]);

    // Back to keeping it.
    await page
      .getByRole("combobox", { name: "What happens to Old Site" })
      .click();
    await page.getByRole("option", { name: "Keep it as it is" }).click();

    await expect
      .poll(async () => {
        return await renames(page);
      })
      .toEqual([]);
  });

  test("taking out an option nobody chose touches nothing, so nothing is listed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=edit");

    await page
      .getByTestId("dropdown-option-row-2")
      .getByRole("button", { name: "Remove" })
      .click();

    await expect
      .poll(async () => {
        return await savedOptions(page);
      })
      .toEqual(["Facility A", "Facility B"]);
    await expect(
      page.getByTestId("dropdown-options-retired"),
    ).not.toContainText("Facility C");
  });

  test("without counts, an option taken out is still listed, as it may be held", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=edit&usage=none");

    await page
      .getByTestId("dropdown-option-row-2")
      .getByRole("button", { name: "Remove" })
      .click();

    await expect(page.getByTestId("dropdown-option-retired-0")).toContainText(
      "Facility C",
    );
    await expect(
      page.getByTestId("dropdown-option-retired-count-0"),
    ).toHaveText(
      "Incidents that have it keep it unless you pick an option for them.",
    );
  });
});

test.describe("a new field's options", () => {
  test("are a plain list: nothing is renamed or listed as no longer an option", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "scenario=create");

    await page.getByTestId("dropdown-option-value-0").fill("Low");
    await page.getByRole("button", { name: "Add Option" }).click();
    await page.getByTestId("dropdown-option-value-1").fill("High");

    await expect
      .poll(async () => {
        return await savedOptions(page);
      })
      .toEqual(["Low", "High"]);

    await page
      .getByTestId("dropdown-option-row-0")
      .getByRole("button", { name: "Remove" })
      .click();

    await expect
      .poll(async () => {
        return await savedOptions(page);
      })
      .toEqual(["High"]);
    await expect(page.getByTestId("dropdown-options-retired")).toHaveCount(0);
    expect(await renames(page)).toEqual([]);
  });
});

test.describe("fields that copy this one", () => {
  test("are named under the options", async ({ page }: { page: Page }) => {
    await open(page, "scenario=edit&copied=1");

    await expect(page.getByTestId("dropdown-options-copied-by-0")).toHaveText(
      'The incident field "Facility" copies this field: options you rename here are renamed there too, and options you add are added to it.',
    );
  });
});

test.describe("how it looks", () => {
  test("the dark theme's No longer options panel is not a light box", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await open(page, "scenario=edit&theme=dark");

    const panel: Locator = page.getByTestId("dropdown-options-retired");

    await expect(panel).toBeVisible();

    const background: string = await panel.evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );

    // Light amber would be close to white; the dark theme keeps it dark.
    const channels: Array<number> = (background.match(/\d+(\.\d+)?/g) || [])
      .slice(0, 3)
      .map(Number);

    expect(channels).toHaveLength(3);
    expect(Math.max(...channels)).toBeLessThan(140);

    await page
      .getByRole("dialog")
      .screenshot({ path: testInfo.outputPath("edit-dark.png") });
  });

  test("nothing runs off the side of the window, and every option keeps its grip, text, color and remove button on screen", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await open(page, "scenario=edit");

    await page.getByTestId("dropdown-option-value-0").fill("Facility Alpha");
    await page
      .getByTestId("dropdown-option-row-1")
      .getByRole("button", { name: "Remove" })
      .click();

    const overflow: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });

    expect(overflow).toBeLessThanOrEqual(0);

    const dialog: Box = await boxOf(page.getByRole("dialog"));

    for (const index of [0, 1]) {
      const row: Locator = page.getByTestId(`dropdown-option-row-${index}`);

      for (const part of [
        row.getByTestId("drag-handle"),
        row.getByTestId(`dropdown-option-value-${index}`),
        row.getByTestId(`dropdown-option-color-${index}`),
        row.getByRole("button", { name: "Remove" }),
      ]) {
        const box: Box = await boxOf(part);

        expect(box.x).toBeGreaterThanOrEqual(dialog.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(
          dialog.x + dialog.width + 1,
        );
      }
    }

    await page
      .getByRole("dialog")
      .screenshot({ path: testInfo.outputPath("edit-changed.png") });
  });
});
