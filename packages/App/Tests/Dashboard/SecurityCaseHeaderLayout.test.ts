import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME,
  SECURITY_CASE_HEADER_BUTTON_CLASS_NAME,
  SECURITY_CASE_HEADER_BUTTON_ICON_CLASS_NAME,
  SECURITY_CASE_HEADER_BUTTONS_CLASS_NAME,
  SECURITY_CASE_HEADER_CHIPS_CLASS_NAME,
  SECURITY_CASE_HEADER_CHIPS_MIN_WIDTH,
  SECURITY_CASE_HEADER_CLASS_NAME,
  SECURITY_CASE_HEADER_COMPACT_TITLE_CLASS_NAME,
  SECURITY_CASE_HEADER_FACTS_CLASS_NAME,
  SECURITY_CASE_HEADER_LOCKED_WRAPPER_CLASS_NAME,
  SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME,
  SECURITY_CASE_HEADER_MORE_TRIGGER_CLASS_NAME,
  SECURITY_CASE_HEADER_NEUTRAL_BUTTON_CLASS_NAME,
  SECURITY_CASE_HEADER_PHONE_WIDTH,
  SECURITY_CASE_HEADER_PRIMARY_BUTTON_CLASS_NAME,
  SECURITY_CASE_HEADER_TEST_IDS,
  SECURITY_CASE_HEADER_TITLE_CLASS_NAME,
  SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME,
  SECURITY_CASE_HEADER_WIDE_WIDTH,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseHeaderLayout";
import fs from "fs";
import path from "path";

/*
 * How a case's header lays itself out, on every page of the case: "at 390
 * px the case header's buttons go full width with the ⋯ on its own row"
 * (the review of #5237, left to this change). The rules, as classes:
 *
 *   - keyed to the header's own width (a size container), never to the
 *     window's: the header sits beside the case's side menu, so a wide
 *     window can still hold a narrow header;
 *   - on a wide header (a laptop's window), a grid: the pills and the
 *     actions on the first row, the actions at the right, and the title
 *     under both across the whole header - a long title took five lines in
 *     the half the actions left it (the UI review of this change);
 *   - on a narrower one the title right after the pills, and the actions
 *     under the title, at the right;
 *   - on the case's other pages, a title of two lines at most;
 *   - the facts under the status steps (who has it, what opened it, when)
 *     in as many columns as the header has room for, not the window;
 *   - on a phone, the buttons take a line of their own and grow to fill
 *     their rows;
 *   - the ⋯ in the header's top-right corner at every width, never alone
 *     on a row after the buttons: the end of the actions on a wide header,
 *     the corner itself below it;
 *   - buttons drawn as an incident's header draws its own, a locked one
 *     dimmed - and the case page's test ids kept.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const WHITESPACE: RegExp = /\s+/;

function classesOf(className: string): Array<string> {
  return className.split(WHITESPACE).filter((name: string): boolean => {
    return name.length > 0;
  });
}

const PHONE_WIDTH_VARIANT: string = `[@container(min-width:${SECURITY_CASE_HEADER_PHONE_WIDTH})]:`;
const WIDE_WIDTH_VARIANT: string = `[@container(min-width:${SECURITY_CASE_HEADER_WIDE_WIDTH})]:`;
const VIEWPORT_GRID_COLUMNS_CLASS: RegExp = /^(sm|md|lg|xl|2xl):grid-cols-/;

// A class that changes with the window's width rather than the header's.
const VIEWPORT_LAYOUT_CLASS: RegExp =
  /^(sm|md|lg|xl|2xl):(flex|grid|w-|max-w|basis|order|absolute|static|relative|hidden|block|inline|ml-|mr-|justify|items|self)/;

describe("the header is laid out by its own width", () => {
  test("it is a size container, drawn as a card", () => {
    expect(classesOf(SECURITY_CASE_HEADER_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "[container-type:inline-size]",
        "relative",
        "rounded-xl",
        "border",
        "bg-white",
      ]),
    );
  });

  test("nothing in its layout follows the window's breakpoints", () => {
    for (const className of [
      SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME,
      SECURITY_CASE_HEADER_TITLE_CLASS_NAME,
      SECURITY_CASE_HEADER_CHIPS_CLASS_NAME,
      SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME,
      SECURITY_CASE_HEADER_BUTTONS_CLASS_NAME,
      SECURITY_CASE_HEADER_FACTS_CLASS_NAME,
      SECURITY_CASE_HEADER_BUTTON_CLASS_NAME,
      SECURITY_CASE_HEADER_LOCKED_WRAPPER_CLASS_NAME,
    ]) {
      expect({
        className,
        viewportClasses: classesOf(className).filter((name: string) => {
          return VIEWPORT_LAYOUT_CLASS.test(name);
        }),
      }).toEqual({ className, viewportClasses: [] });
    }
  });

  test("below the wide width: a row that wraps - the pills, the title on a line of its own, then the actions at the right", () => {
    expect(classesOf(SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME)).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "items-start"]),
    );
    // The pills take their line; the title the whole of the next.
    expect(classesOf(SECURITY_CASE_HEADER_CHIPS_CLASS_NAME)).toEqual(
      expect.arrayContaining(["flex", "w-full", "min-w-0", "flex-wrap"]),
    );
    expect(classesOf(SECURITY_CASE_HEADER_TITLE_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "basis-full",
        "min-w-0",
        "break-words",
        "text-xl",
        "font-semibold",
      ]),
    );
    // At the right edge, under the title.
    expect(classesOf(SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME)).toEqual(
      expect.arrayContaining(["ml-auto", "flex", "justify-end", "max-w-full"]),
    );
    /*
     * The buttons wrap among themselves, at the right; the actions - the
     * buttons and the ⋯ - never wrap, so the ⋯ is never alone on a row.
     */
    expect(classesOf(SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME)).not.toContain(
      "flex-wrap",
    );
    expect(classesOf(SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME)).toContain(
      "items-start",
    );
    expect(classesOf(SECURITY_CASE_HEADER_BUTTONS_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "flex",
        "flex-wrap",
        "justify-end",
        "min-w-0",
        "flex-auto",
      ]),
    );
    // Nothing reorders them: the title comes before the actions, as read.
    for (const className of [
      SECURITY_CASE_HEADER_CHIPS_CLASS_NAME,
      SECURITY_CASE_HEADER_TITLE_CLASS_NAME,
      SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME,
    ]) {
      expect(
        classesOf(className).filter((name: string): boolean => {
          return name.includes("order-");
        }),
      ).toEqual([]);
    }
  });

  test("from the wide width: a grid - the pills and the actions on the first row, the title under both across the header", () => {
    // A laptop's window: the header is 940px at 1280, beside the side menu.
    expect(SECURITY_CASE_HEADER_WIDE_WIDTH).toBe("58rem");
    expect(SECURITY_CASE_HEADER_CHIPS_MIN_WIDTH).toBe("12rem");
    expect(classesOf(SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        `${WIDE_WIDTH_VARIANT}grid`,
        `${WIDE_WIDTH_VARIANT}grid-cols-[minmax(${SECURITY_CASE_HEADER_CHIPS_MIN_WIDTH},1fr)_auto]`,
      ]),
    );
    // The pills: the first row's left, as tall as the buttons beside them.
    expect(classesOf(SECURITY_CASE_HEADER_CHIPS_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        `${WIDE_WIDTH_VARIANT}col-start-1`,
        `${WIDE_WIDTH_VARIANT}row-start-1`,
        `${WIDE_WIDTH_VARIANT}min-h-9`,
      ]),
    );
    // The actions: the first row's right.
    expect(classesOf(SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        `${WIDE_WIDTH_VARIANT}col-start-2`,
        `${WIDE_WIDTH_VARIANT}row-start-1`,
      ]),
    );
    // The title: the second row, both columns.
    expect(classesOf(SECURITY_CASE_HEADER_TITLE_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        `${WIDE_WIDTH_VARIANT}col-span-2`,
        `${WIDE_WIDTH_VARIANT}row-start-2`,
      ]),
    );
  });

  test("on the case's other pages the title is two lines at most", () => {
    expect(classesOf(SECURITY_CASE_HEADER_COMPACT_TITLE_CLASS_NAME)).toEqual([
      "line-clamp-2",
    ]);
  });

  test("the facts: two to a row on a phone, three from the phone width, all five once the header has room - by the header's width", () => {
    expect(classesOf(SECURITY_CASE_HEADER_FACTS_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "grid",
        "grid-cols-2",
        `${PHONE_WIDTH_VARIANT}grid-cols-3`,
        "[@container(min-width:56rem)]:grid-cols-5",
      ]),
    );
    expect(
      classesOf(SECURITY_CASE_HEADER_FACTS_CLASS_NAME).filter(
        (name: string): boolean => {
          return VIEWPORT_GRID_COLUMNS_CLASS.test(name);
        },
      ),
    ).toEqual([]);
  });

  test("on a phone the buttons take a line of their own and fill their rows; from the phone width they keep their own width", () => {
    const actions: Array<string> = classesOf(
      SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME,
    );

    expect(actions).toContain("w-full");
    expect(actions).toContain(`${PHONE_WIDTH_VARIANT}w-auto`);

    for (const className of [
      SECURITY_CASE_HEADER_BUTTON_CLASS_NAME,
      SECURITY_CASE_HEADER_LOCKED_WRAPPER_CLASS_NAME,
    ]) {
      const classes: Array<string> = classesOf(className);

      // Grows to fill its row, never cut below a readable width.
      expect(classes).toEqual(
        expect.arrayContaining(["flex-auto", "min-w-[7rem]", "max-w-full"]),
      );
      expect(classes).toEqual(
        expect.arrayContaining([
          `${PHONE_WIDTH_VARIANT}flex-none`,
          `${PHONE_WIDTH_VARIANT}max-w-64`,
        ]),
      );
    }
  });

  test("on a phone a button leaves its icon out, so two share a row; from the phone width it has it", () => {
    /*
     * Shown by default, hidden below the phone width: never a bare `hidden`
     * a variant shows again, which a page's foreign `.hidden` rule would keep
     * hidden at every width. Just under the phone width, so the two meet.
     */
    expect(SECURITY_CASE_HEADER_PHONE_WIDTH).toBe("36rem");
    expect(classesOf(SECURITY_CASE_HEADER_BUTTON_ICON_CLASS_NAME)).toEqual([
      "inline-flex",
      "[@container(max-width:35.99rem)]:hidden",
    ]);
  });

  test("below the wide width the ⋯ sits in the header's top-right corner, and the pills leave it room; from the wide width it ends the actions", () => {
    expect(classesOf(SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "absolute",
        "right-4",
        "top-3",
        `${WIDE_WIDTH_VARIANT}static`,
        `${WIDE_WIDTH_VARIANT}shrink-0`,
      ]),
    );
    expect(classesOf(SECURITY_CASE_HEADER_CHIPS_CLASS_NAME)).toEqual(
      expect.arrayContaining(["pr-12", `${WIDE_WIDTH_VARIANT}pr-0`]),
    );
    // Not let back into the buttons' row any earlier: it was alone on a row there.
    expect(
      classesOf(SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME).filter(
        (name: string): boolean => {
          return name.startsWith(PHONE_WIDTH_VARIANT);
        },
      ),
    ).toEqual([]);
  });
});

describe("the header's buttons", () => {
  const eventStatusPanel: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, "Components", "EventView", "EventStatusPanel.tsx"),
    "utf8",
  );

  test("look like an incident's header's: the same colours for the main move and the others, and the same ⋯", () => {
    expect(eventStatusPanel).toContain(
      SECURITY_CASE_HEADER_PRIMARY_BUTTON_CLASS_NAME,
    );
    expect(eventStatusPanel).toContain(
      SECURITY_CASE_HEADER_NEUTRAL_BUTTON_CLASS_NAME,
    );
    expect(eventStatusPanel).toContain(
      SECURITY_CASE_HEADER_MORE_TRIGGER_CLASS_NAME,
    );
  });

  test("a locked one looks locked, and keeps its height and type", () => {
    expect(classesOf(SECURITY_CASE_HEADER_BUTTON_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "h-9",
        "text-sm",
        "font-semibold",
        "whitespace-nowrap",
        "disabled:opacity-50",
        "disabled:cursor-not-allowed",
        "focus-visible:ring-2",
      ]),
    );
  });

  test("keep the test ids the case page always had", () => {
    expect(SECURITY_CASE_HEADER_TEST_IDS).toEqual(
      expect.objectContaining({
        assignToMe: "security-case-assign-to-me",
        runPlaybook: "security-case-run-playbook",
        declareIncident: "security-case-declare-incident",
        close: "security-case-close",
        reopen: "security-case-reopen",
        more: "security-case-more",
      }),
    );
  });
});

describe("the header draws the layout's classes, not copies of them", () => {
  const header: string = fs.readFileSync(
    path.join(
      DASHBOARD_SRC,
      "Components",
      "SecurityCase",
      "SecurityCaseHeader.tsx",
    ),
    "utf8",
  );

  test.each([
    "SECURITY_CASE_HEADER_CLASS_NAME",
    "SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME",
    "SECURITY_CASE_HEADER_TITLE_CLASS_NAME",
    "SECURITY_CASE_HEADER_COMPACT_TITLE_CLASS_NAME",
    "SECURITY_CASE_HEADER_FACTS_CLASS_NAME",
    "SECURITY_CASE_HEADER_CHIPS_CLASS_NAME",
    "SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME",
    "SECURITY_CASE_HEADER_BUTTONS_CLASS_NAME",
    "SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME",
    "SECURITY_CASE_HEADER_BUTTON_CLASS_NAME",
    "SECURITY_CASE_HEADER_BUTTON_ICON_CLASS_NAME",
    "SECURITY_CASE_HEADER_LOCKED_WRAPPER_CLASS_NAME",
    "SECURITY_CASE_HEADER_PRIMARY_BUTTON_CLASS_NAME",
    "SECURITY_CASE_HEADER_NEUTRAL_BUTTON_CLASS_NAME",
    "SECURITY_CASE_HEADER_MORE_TRIGGER_CLASS_NAME",
  ])("%s", (constant: string) => {
    // Imported, and drawn: at least once more than the import names it.
    expect(header.split(constant).length - 1).toBeGreaterThanOrEqual(2);
  });

  test("never the shared Button, which is a full-width dialog button on a phone", () => {
    expect(header).not.toContain('from "Common/UI/Components/Button/Button"');
  });

  test("its ⋯ opens over the page, not inside the size container that would put it under the cards after it", () => {
    expect(header).toContain("isMenuPortaled={true}");
  });
});
