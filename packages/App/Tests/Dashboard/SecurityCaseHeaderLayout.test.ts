import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME,
  SECURITY_CASE_HEADER_BUTTON_CLASS_NAME,
  SECURITY_CASE_HEADER_CHIPS_CLASS_NAME,
  SECURITY_CASE_HEADER_CLASS_NAME,
  SECURITY_CASE_HEADER_LOCKED_WRAPPER_CLASS_NAME,
  SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME,
  SECURITY_CASE_HEADER_MORE_TRIGGER_CLASS_NAME,
  SECURITY_CASE_HEADER_NEUTRAL_BUTTON_CLASS_NAME,
  SECURITY_CASE_HEADER_PHONE_WIDTH,
  SECURITY_CASE_HEADER_PRIMARY_BUTTON_CLASS_NAME,
  SECURITY_CASE_HEADER_TEST_IDS,
  SECURITY_CASE_HEADER_TITLE_BLOCK_CLASS_NAME,
  SECURITY_CASE_HEADER_TITLE_MIN_WIDTH,
  SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME,
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
 *   - the actions on the title's line while both fit, at the right edge,
 *     and under the title, still at the right, when they do not;
 *   - on a phone, the buttons take a line of their own and grow to fill
 *     their rows, and the ⋯ sits in the header's top-right corner instead
 *     of alone on a row after them;
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
      SECURITY_CASE_HEADER_TITLE_BLOCK_CLASS_NAME,
      SECURITY_CASE_HEADER_CHIPS_CLASS_NAME,
      SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME,
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

  test("the actions share the title's line while both fit, and wrap under it at the right", () => {
    // The row wraps; the title's block grows from its least width; the actions keep theirs.
    expect(classesOf(SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME)).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "items-start"]),
    );
    expect(SECURITY_CASE_HEADER_TITLE_MIN_WIDTH).toBe("16rem");
    expect(classesOf(SECURITY_CASE_HEADER_TITLE_BLOCK_CLASS_NAME)).toEqual([
      "min-w-0",
      `flex-[1_1_${SECURITY_CASE_HEADER_TITLE_MIN_WIDTH}]`,
    ]);
    // At the right edge whether beside the title or under it.
    expect(classesOf(SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "ml-auto",
        "flex",
        "flex-wrap",
        "justify-end",
        "max-w-full",
      ]),
    );
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

  test("on a phone the ⋯ sits in the header's top-right corner, and the chips leave it room; from the phone width it ends the actions", () => {
    expect(classesOf(SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "absolute",
        "right-4",
        "top-3",
        `${PHONE_WIDTH_VARIANT}static`,
      ]),
    );
    expect(classesOf(SECURITY_CASE_HEADER_CHIPS_CLASS_NAME)).toEqual(
      expect.arrayContaining(["pr-12", `${PHONE_WIDTH_VARIANT}pr-0`]),
    );
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
    "SECURITY_CASE_HEADER_TITLE_BLOCK_CLASS_NAME",
    "SECURITY_CASE_HEADER_CHIPS_CLASS_NAME",
    "SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME",
    "SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME",
    "SECURITY_CASE_HEADER_BUTTON_CLASS_NAME",
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
