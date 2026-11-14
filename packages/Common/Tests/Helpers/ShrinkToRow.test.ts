import { getBoxesThatCannotShrink } from "./ShrinkToRow";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The check tells a label that can be cut short from one that cannot: the
 * suites that lean on it (the Logs explorer's toolbar, a table's header)
 * pass only when it does.
 */

function mount(html: string): { label: Element; row: Element } {
  document.body.innerHTML = html;

  return {
    label: document.querySelector("[data-label]") as Element,
    row: document.querySelector("[data-row]") as Element,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("getBoxesThatCannotShrink", () => {
  test("a label every box around which may shrink has nothing to report", () => {
    expect(
      getBoxesThatCannotShrink(
        mount(
          `<div data-row class="flex flex-wrap">` +
            `<div class="flex min-w-0 max-w-full flex-wrap">` +
            `<div class="relative min-w-0 max-w-full">` +
            `<button class="inline-flex max-w-full items-center">` +
            `<span data-label class="min-w-0 truncate">Nov 12, 2025 – Nov 12, 2026</span>` +
            `</button></div></div></div>`,
        ),
      ),
    ).toEqual([]);
  });

  test("a box in a flex row without min-w-0 is reported", () => {
    const boxes: Array<string> = getBoxesThatCannotShrink(
      mount(
        `<div data-row class="flex flex-wrap">` +
          `<div data-testid="group" class="flex max-w-full flex-wrap">` +
          `<span data-label class="min-w-0 truncate">Nov 12, 2025 – Nov 12, 2026</span>` +
          `</div></div>`,
      ),
    );

    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toContain(`div[data-testid="group"]`);
    expect(boxes[0]).toContain("without min-w-0");
  });

  test("a grid row asks the same of its boxes", () => {
    expect(
      getBoxesThatCannotShrink(
        mount(
          `<div data-row class="grid">` +
            `<span data-label class="truncate">Nov 12, 2025 – Nov 12, 2026</span>` +
            `</div>`,
        ),
      ),
    ).toHaveLength(1);
  });

  test("a button in a line of text without max-w-full is reported, and a block box is not", () => {
    const boxes: Array<string> = getBoxesThatCannotShrink(
      mount(
        `<div data-row class="flex">` +
          `<div class="relative min-w-0">` +
          `<div class="px-2">` +
          `<button class="inline-flex items-center">` +
          `<span data-label class="min-w-0 truncate">Nov 12, 2025 – Nov 12, 2026</span>` +
          `</button></div></div></div>`,
      ),
    );

    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toContain("button");
    expect(boxes[0]).toContain("without max-w-full");
  });

  test("a box that may shrink from md up alone is reported: it still runs off a phone", () => {
    expect(
      getBoxesThatCannotShrink(
        mount(
          `<div data-row class="flex">` +
            `<span data-label class="md:min-w-0 truncate">Nov 12, 2025 – Nov 12, 2026</span>` +
            `</div>`,
        ),
      ),
    ).toHaveLength(1);
  });

  test("a label outside the row is a mistake in the test, not a pass", () => {
    document.body.innerHTML = `<div data-row class="flex"></div><span data-label class="truncate">x</span>`;

    expect(() => {
      getBoxesThatCannotShrink({
        label: document.querySelector("[data-label]") as Element,
        row: document.querySelector("[data-row]") as Element,
      });
    }).toThrow("The label is not inside the row.");
  });
});
