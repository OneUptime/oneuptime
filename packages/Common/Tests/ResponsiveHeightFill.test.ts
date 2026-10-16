import { afterEach, describe, expect, test } from "@jest/globals";
import {
  describeBox,
  describeHeightFill,
  describeHeightFillChain,
  resolveAlignSelf,
  resolveFlexGrow,
  resolveHeight,
} from "./ResponsiveHeightFill";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
} from "./ResponsiveVisibility";

/*
 * Home's row guard (Tests/App/Dashboard/HomePage.test.tsx) leans on this
 * helper to prove that every card in the row runs to the row's bottom. A
 * helper that answered "fills" too easily would let the gap under a short
 * card come back unnoticed, so it gets its own cover: each way a box takes
 * its parent's height, and each way it does not.
 */

function box(className: string, ...children: Array<Element>): HTMLElement {
  const element: HTMLElement = document.createElement("div");
  element.setAttribute("class", className);

  for (const child of children) {
    element.appendChild(child);
  }

  return element;
}

function named(testId: string, element: HTMLElement): HTMLElement {
  element.setAttribute("data-testid", testId);
  return element;
}

// Attached, so parentElement and the structural variants work as in a page.
function mount(root: HTMLElement): HTMLElement {
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("in a grid", () => {
  test("an item takes its row's height: stretch is the default", () => {
    const item: HTMLElement = box("min-w-0");
    mount(box("grid grid-cols-1 gap-5 xl:grid-cols-3", item));

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toBeNull();
    expect(describeHeightFill(item, PHONE_WIDTH_IN_PX)).toBeNull();
  });

  test("an item aligned to the start of its row ends with its content", () => {
    const item: HTMLElement = named("cell", box("self-start"));
    mount(box("grid xl:grid-cols-3", item));

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toBe(
      '[data-testid="cell"] is aligned to flex-start (align-self), so it ends where its content ends',
    );
  });

  test("an alignment behind a screen variant applies from that width up", () => {
    const item: HTMLElement = box("xl:self-start");
    mount(box("grid xl:grid-cols-3", item));

    expect(describeHeightFill(item, TABLET_WIDTH_IN_PX)).toBeNull();
    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toContain(
      "align-self",
    );
  });

  test("self-stretch keeps the item stretched whatever the grid says", () => {
    const item: HTMLElement = box("self-stretch");
    mount(box("grid items-start", item));

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toBeNull();
  });

  test("a grid that aligns its items to the start leaves every item short", () => {
    const item: HTMLElement = box("min-w-0");
    mount(named("row", box("grid items-start xl:grid-cols-3", item)));

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toBe(
      '[data-testid="row"] aligns its items to flex-start (align-items), so <div class="min-w-0"> ends where its content ends',
    );
  });

  test("a container that is a grid only from xl up is a block below it", () => {
    const item: HTMLElement = box("min-w-0");
    mount(box("block xl:grid xl:grid-cols-3", item));

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toBeNull();
    expect(describeHeightFill(item, TABLET_WIDTH_IN_PX)).toContain(
      "is a block with an auto height",
    );
  });
});

describe("in a flex row", () => {
  test("an item takes the row's height unless the row centres it", () => {
    const item: HTMLElement = box("min-w-0");
    const row: HTMLElement = mount(box("flex", item));

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toBeNull();

    row.setAttribute("class", "flex items-center");

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toContain(
      "aligns its items to center",
    );
  });
});

describe("in a flex column", () => {
  test("an item that does not grow ends with its content", () => {
    const item: HTMLElement = named("card", box("min-w-0"));
    mount(box("flex flex-col gap-5", item, box("")));

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toBe(
      '[data-testid="card"] does not grow in its flex column (flex-1, or [&>*:last-child]:flex-1 on the column), so it ends where its content ends',
    );
  });

  test.each(["flex-1", "flex-auto", "grow"])(
    "an item with %s takes the room its siblings leave",
    (grow: string) => {
      const item: HTMLElement = box(grow);
      mount(box("flex flex-col", box(""), item));

      expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toBeNull();
      expect(resolveFlexGrow(item, LAPTOP_WIDTH_IN_PX)).toBe(1);
    },
  );

  test("grow-0 after flex-1 wins, as Tailwind emits the grow utilities later", () => {
    const item: HTMLElement = box("grow-0 flex-1");
    mount(box("flex flex-col", item, box("")));

    expect(resolveFlexGrow(item, LAPTOP_WIDTH_IN_PX)).toBe(0);
    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toContain(
      "does not grow",
    );
  });

  test("growing behind a screen variant applies from that width up", () => {
    const item: HTMLElement = box("xl:flex-1");
    mount(box("flex flex-col", item, box("")));

    expect(describeHeightFill(item, TABLET_WIDTH_IN_PX)).toContain(
      "does not grow",
    );
    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toBeNull();
  });

  test("the column's [&>*:last-child]:flex-1 grows its last child, and only that one", () => {
    const first: HTMLElement = box("");
    const last: HTMLElement = box("");
    mount(box("flex flex-col gap-5 [&>*:last-child]:flex-1", first, last));

    expect(describeHeightFill(last, LAPTOP_WIDTH_IN_PX)).toBeNull();
    expect(describeHeightFill(first, LAPTOP_WIDTH_IN_PX)).toContain(
      "does not grow",
    );
  });

  test("the last-child rule follows the children: the last one there is the one that grows", () => {
    const first: HTMLElement = box("");
    const last: HTMLElement = box("");
    const column: HTMLElement = mount(
      box("flex flex-col [&>*:last-child]:flex-1", first, last),
    );

    column.removeChild(last);

    expect(describeHeightFill(first, LAPTOP_WIDTH_IN_PX)).toBeNull();
  });

  test("a screen variant on the column's child rule applies from that width up", () => {
    const only: HTMLElement = box("");
    mount(box("flex flex-col xl:[&>*:last-child]:flex-1", box(""), only));

    expect(describeHeightFill(only, TABLET_WIDTH_IN_PX)).toContain(
      "does not grow",
    );
    expect(describeHeightFill(only, LAPTOP_WIDTH_IN_PX)).toBeNull();
  });

  test("[&>*]:flex-1 and *:flex-1 grow every child", () => {
    for (const rule of ["[&>*]:flex-1", "*:flex-1"]) {
      const first: HTMLElement = box("");
      const second: HTMLElement = box("");
      mount(box(`flex flex-col ${rule}`, first, second));

      expect([rule, describeHeightFill(first, LAPTOP_WIDTH_IN_PX)]).toEqual([
        rule,
        null,
      ]);
      expect([rule, describeHeightFill(second, LAPTOP_WIDTH_IN_PX)]).toEqual([
        rule,
        null,
      ]);
      document.body.innerHTML = "";
    }
  });

  test("[&>*:first-child]:flex-1 grows the first child only", () => {
    const first: HTMLElement = box("");
    const second: HTMLElement = box("");
    mount(box("flex flex-col [&>*:first-child]:flex-1", first, second));

    expect(describeHeightFill(first, LAPTOP_WIDTH_IN_PX)).toBeNull();
    expect(describeHeightFill(second, LAPTOP_WIDTH_IN_PX)).toContain(
      "does not grow",
    );
  });

  test("an item's own last:flex-1 applies only while it is the last child", () => {
    const item: HTMLElement = box("last:flex-1");
    const column: HTMLElement = mount(box("flex flex-col", item));

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toBeNull();

    column.appendChild(box(""));

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toContain(
      "does not grow",
    );
  });

  test("an only child as tall as the column fills it; beside a sibling it does not", () => {
    const item: HTMLElement = box("h-full");
    const column: HTMLElement = mount(box("flex flex-col", item));

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toBeNull();

    column.appendChild(box(""));

    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toContain(
      "does not grow",
    );
  });
});

describe("in a block", () => {
  test("only height: 100% takes the parent's height", () => {
    const filling: HTMLElement = box("h-full");
    const content: HTMLElement = named("body", box("mt-4"));
    mount(box("", filling));
    mount(box("", content));

    expect(describeHeightFill(filling, LAPTOP_WIDTH_IN_PX)).toBeNull();
    expect(describeHeightFill(content, LAPTOP_WIDTH_IN_PX)).toBe(
      '[data-testid="body"] is a block with an auto height inside <div class="">, so it ends where its content ends (h-full, or a flex or grid parent)',
    );
  });

  test("a fixed height never fills, in any container", () => {
    for (const parentClass of ["", "grid", "flex", "flex flex-col"]) {
      const item: HTMLElement = box("h-9 flex-1");
      mount(box(parentClass, item));

      expect([
        parentClass,
        describeHeightFill(item, LAPTOP_WIDTH_IN_PX),
      ]).toEqual([parentClass, '<div class="h-9 flex-1"> has a fixed height']);
      document.body.innerHTML = "";
    }
  });

  test("h-auto after h-full at a wider screen ends it there", () => {
    const item: HTMLElement = box("h-full xl:h-auto");
    mount(box("", item));

    expect(resolveHeight(item, TABLET_WIDTH_IN_PX)).toBe("100%");
    expect(resolveHeight(item, LAPTOP_WIDTH_IN_PX)).toBe("auto");
    expect(describeHeightFill(item, LAPTOP_WIDTH_IN_PX)).toContain(
      "is a block with an auto height",
    );
  });

  test("a box with no parent has nothing to fill", () => {
    expect(describeHeightFill(box("h-full"), LAPTOP_WIDTH_IN_PX)).toBe(
      '<div class="h-full"> has no parent to fill',
    );
  });
});

describe("resolveAlignSelf", () => {
  test("state variants say nothing about layout and are ignored", () => {
    const item: HTMLElement = box("hover:self-start dark:self-center");
    mount(box("grid", item));

    expect(resolveAlignSelf(item, LAPTOP_WIDTH_IN_PX)).toBe("auto");
  });
});

describe("describeHeightFillChain", () => {
  /*
   * Home's row, in miniature: a grid cell that stacks its cards, the card
   * wrapper the column grows, a card as tall as its wrapper, its frame a
   * column, and the body that grows in it.
   */
  function homeRow(options: { cardClassName: string }): {
    row: HTMLElement;
    body: HTMLElement;
  } {
    const body: HTMLElement = named("body", box("mt-4 flex flex-1 flex-col"));
    const content: HTMLElement = box("py-6 px-5 flex flex-1 flex-col", body);
    const frame: HTMLElement = box("border flex h-full flex-col", content);
    const card: HTMLElement = named("card", box(options.cardClassName, frame));
    const wrapper: HTMLElement = named("wrapper", box("", card));
    const cell: HTMLElement = box(
      "flex min-w-0 flex-col gap-5 [&>*:last-child]:flex-1 xl:col-span-2",
      wrapper,
    );
    const row: HTMLElement = mount(
      named("row", box("grid grid-cols-1 gap-5 xl:grid-cols-3", cell)),
    );

    return { row, body };
  }

  test("every box between the body and the row fills the next: no reason", () => {
    const { row, body } = homeRow({ cardClassName: "mb-5 !mb-0 h-full" });

    expect(describeHeightFillChain(body, row, LAPTOP_WIDTH_IN_PX)).toEqual([]);
  });

  test("one box that ends with its content is named, and only that one", () => {
    const { row, body } = homeRow({ cardClassName: "mb-5 !mb-0" });

    expect(describeHeightFillChain(body, row, LAPTOP_WIDTH_IN_PX)).toEqual([
      '[data-testid="card"] is a block with an auto height inside [data-testid="wrapper"], so it ends where its content ends (h-full, or a flex or grid parent)',
    ]);
  });

  test("a box the ancestor does not hold is an error, not a pass", () => {
    const { row } = homeRow({ cardClassName: "h-full" });
    const stray: HTMLElement = named("stray", box(""));

    expect(describeHeightFillChain(stray, row, LAPTOP_WIDTH_IN_PX)).toEqual([
      '[data-testid="row"] does not hold [data-testid="stray"]',
    ]);
    expect(describeHeightFillChain(row, row, LAPTOP_WIDTH_IN_PX)).toEqual([
      '[data-testid="row"] does not hold [data-testid="row"]',
    ]);
  });
});

describe("describeBox", () => {
  test("names a box by its test id, or by its tag and classes", () => {
    expect(describeBox(named("home-overview-row", box("grid")))).toBe(
      '[data-testid="home-overview-row"]',
    );
    expect(describeBox(box("grid gap-5"))).toBe('<div class="grid gap-5">');
  });
});
