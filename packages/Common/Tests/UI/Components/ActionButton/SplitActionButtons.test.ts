import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import splitActionButtons, {
  IndexedActionButton,
  isActionButtonVisible,
  isDestructiveActionButton,
  SplitActionButtonsResult,
} from "../../../../UI/Components/ActionButton/SplitActionButtons";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import { describe, expect, test } from "@jest/globals";

/*
 * A table row shows one of its actions as a button and folds the rest into a ⋯
 * menu. These tests pin down which action gets the button and the order of the
 * menu, because that decision is made once here for every table in the
 * product - a regression in it rearranges all of them at once.
 */

interface Row {
  id: string;
  isVerified?: boolean | undefined;
}

const ROW: Row = { id: "row-1" };

type ActionFunction = (
  title: string,
  buttonStyleType: ButtonStyleType,
  extra?: Partial<ActionButtonSchema<Row>>,
) => ActionButtonSchema<Row>;

const action: ActionFunction = (
  title: string,
  buttonStyleType: ButtonStyleType,
  extra?: Partial<ActionButtonSchema<Row>>,
): ActionButtonSchema<Row> => {
  return {
    title,
    buttonStyleType,
    onClick: () => {},
    ...extra,
  };
};

/*
 * The actions BaseModelTable builds, in the order it builds them: Show ID,
 * then the table's own actions, then View, Edit and Delete.
 */
const SHOW_ID: ActionButtonSchema<Row> = action(
  "Show ID",
  ButtonStyleType.OUTLINE,
  { hideOnMobile: true, placement: ActionButtonPlacement.MoreMenu },
);
const VIEW: ActionButtonSchema<Row> = action(
  "View User",
  ButtonStyleType.NORMAL,
  {
    placement: ActionButtonPlacement.Primary,
  },
);
const EDIT: ActionButtonSchema<Row> = action("Edit", ButtonStyleType.OUTLINE);
const DELETE: ActionButtonSchema<Row> = action(
  "Remove from Project",
  ButtonStyleType.DANGER_OUTLINE,
);

type SplitFunction = (
  actionButtons: Array<ActionButtonSchema<Row>> | undefined,
  options?: { item?: Row; isMobile?: boolean },
) => SplitActionButtonsResult<Row>;

const split: SplitFunction = (
  actionButtons: Array<ActionButtonSchema<Row>> | undefined,
  options?: { item?: Row; isMobile?: boolean },
): SplitActionButtonsResult<Row> => {
  return splitActionButtons<Row>({
    actionButtons,
    item: options?.item || ROW,
    isMobile: options?.isMobile,
  });
};

type TitlesFunction = (
  entries: Array<IndexedActionButton<Row>>,
) => Array<string>;

const titles: TitlesFunction = (
  entries: Array<IndexedActionButton<Row>>,
): Array<string> => {
  return entries.map((entry: IndexedActionButton<Row>) => {
    return entry.button.title;
  });
};

describe("splitActionButtons", () => {
  describe("a row with nothing to do", () => {
    test("undefined actions give no button and an empty menu", () => {
      const result: SplitActionButtonsResult<Row> = split(undefined);

      expect(result.primary).toBeNull();
      expect(result.moreMenu).toEqual([]);
    });

    test("an empty list gives no button and an empty menu", () => {
      const result: SplitActionButtonsResult<Row> = split([]);

      expect(result.primary).toBeNull();
      expect(result.moreMenu).toEqual([]);
    });

    test("actions that are all hidden for this row give nothing", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Verify", ButtonStyleType.NORMAL, {
          isVisible: () => {
            return false;
          },
        }),
      ]);

      expect(result.primary).toBeNull();
      expect(result.moreMenu).toEqual([]);
    });
  });

  describe("the examples the layout was designed around", () => {
    /*
     * The Members table from the original request: "View User" stays on the
     * row and "Remove from Project" moves into the menu.
     */
    test("View User stays on the row and Remove from Project goes in the menu", () => {
      const result: SplitActionButtonsResult<Row> = split([VIEW, DELETE]);

      expect(result.primary?.button.title).toBe("View User");
      expect(titles(result.moreMenu)).toEqual(["Remove from Project"]);
    });

    /*
     * A table whose only action is Show ID shows just the ⋯ menu, with Show ID
     * inside it - never a lone "Show ID" button.
     */
    test("a Show ID only row has no button, only the menu", () => {
      const result: SplitActionButtonsResult<Row> = split([SHOW_ID]);

      expect(result.primary).toBeNull();
      expect(titles(result.moreMenu)).toEqual(["Show ID"]);
    });

    test("the full ModelTable set keeps View and folds the rest in order", () => {
      const result: SplitActionButtonsResult<Row> = split([
        SHOW_ID,
        VIEW,
        EDIT,
        DELETE,
      ]);

      expect(result.primary?.button.title).toBe("View User");
      expect(titles(result.moreMenu)).toEqual([
        "Show ID",
        "Edit",
        "Remove from Project",
      ]);
    });

    test("without View, Edit is the button and Delete is in the menu", () => {
      const result: SplitActionButtonsResult<Row> = split([EDIT, DELETE]);

      expect(result.primary?.button.title).toBe("Edit");
      expect(titles(result.moreMenu)).toEqual(["Remove from Project"]);
    });

    test("Show ID and Delete alone are both in the menu", () => {
      const result: SplitActionButtonsResult<Row> = split([SHOW_ID, DELETE]);

      expect(result.primary).toBeNull();
      expect(titles(result.moreMenu)).toEqual([
        "Show ID",
        "Remove from Project",
      ]);
    });
  });

  describe("choosing the button", () => {
    test("an explicit Primary beats a call-to-action style listed before it", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Send Test Email", ButtonStyleType.NORMAL),
        VIEW,
      ]);

      expect(result.primary?.button.title).toBe("View User");
      expect(titles(result.moreMenu)).toEqual(["Send Test Email"]);
    });

    test("the first visible Primary wins when there are several", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Verify", ButtonStyleType.OUTLINE, {
          placement: ActionButtonPlacement.Primary,
        }),
        VIEW,
      ]);

      expect(result.primary?.button.title).toBe("Verify");
      expect(titles(result.moreMenu)).toEqual(["View User"]);
    });

    test("a Primary that is hidden for this row hands the button on", () => {
      const verify: ActionButtonSchema<Row> = action(
        "Verify",
        ButtonStyleType.OUTLINE,
        {
          placement: ActionButtonPlacement.Primary,
          isVisible: (item: Row) => {
            return !item.isVerified;
          },
        },
      );

      const unverified: SplitActionButtonsResult<Row> = split([verify, VIEW], {
        item: { id: "a", isVerified: false },
      });
      const verified: SplitActionButtonsResult<Row> = split([verify, VIEW], {
        item: { id: "b", isVerified: true },
      });

      expect(unverified.primary?.button.title).toBe("Verify");
      expect(titles(unverified.moreMenu)).toEqual(["View User"]);
      expect(verified.primary?.button.title).toBe("View User");
      expect(verified.moreMenu).toEqual([]);
    });

    test.each([
      ["NORMAL", ButtonStyleType.NORMAL],
      ["PRIMARY", ButtonStyleType.PRIMARY],
      ["SUCCESS", ButtonStyleType.SUCCESS],
      ["WARNING", ButtonStyleType.WARNING],
    ])(
      "a %s action beats an outlined action listed before it",
      (_label: string, style: ButtonStyleType) => {
        const result: SplitActionButtonsResult<Row> = split([
          action("Test", ButtonStyleType.OUTLINE),
          action("Run Now", style),
          EDIT,
        ]);

        expect(result.primary?.button.title).toBe("Run Now");
        expect(titles(result.moreMenu)).toEqual(["Test", "Edit"]);
      },
    );

    test.each([
      ["OUTLINE", ButtonStyleType.OUTLINE],
      ["SUCCESS_OUTLINE", ButtonStyleType.SUCCESS_OUTLINE],
      ["WARNING_OUTLINE", ButtonStyleType.WARNING_OUTLINE],
      ["SECONDARY", ButtonStyleType.SECONDARY],
      ["LINK", ButtonStyleType.LINK],
    ])(
      "without a call to action the first non-destructive %s action is the button",
      (_label: string, style: ButtonStyleType) => {
        const result: SplitActionButtonsResult<Row> = split([
          DELETE,
          action("Open", style),
          EDIT,
        ]);

        expect(result.primary?.button.title).toBe("Open");
        expect(titles(result.moreMenu)).toEqual([
          "Edit",
          "Remove from Project",
        ]);
      },
    );

    test("a lone destructive action stays a button rather than a menu of one", () => {
      const result: SplitActionButtonsResult<Row> = split([DELETE]);

      expect(result.primary?.button.title).toBe("Remove from Project");
      expect(result.moreMenu).toEqual([]);
    });

    test("a lone non-destructive action is the button with no menu", () => {
      const result: SplitActionButtonsResult<Row> = split([EDIT]);

      expect(result.primary?.button.title).toBe("Edit");
      expect(result.moreMenu).toEqual([]);
    });

    test("two destructive actions are both in the menu", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Revoke", ButtonStyleType.DANGER),
        DELETE,
      ]);

      expect(result.primary).toBeNull();
      expect(titles(result.moreMenu)).toEqual([
        "Revoke",
        "Remove from Project",
      ]);
    });

    test("a destructive action is promoted only when explicitly marked Primary", () => {
      const result: SplitActionButtonsResult<Row> = split([
        EDIT,
        action("Leave Team", ButtonStyleType.DANGER_OUTLINE, {
          placement: ActionButtonPlacement.Primary,
        }),
      ]);

      expect(result.primary?.button.title).toBe("Leave Team");
      expect(titles(result.moreMenu)).toEqual(["Edit"]);
    });

    test("a MoreMenu action is never the button, even with a call-to-action style", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Show ID and Key", ButtonStyleType.NORMAL, {
          placement: ActionButtonPlacement.MoreMenu,
        }),
        EDIT,
      ]);

      expect(result.primary?.button.title).toBe("Edit");
      expect(titles(result.moreMenu)).toEqual(["Show ID and Key"]);
    });

    test("a disabled action is the button only when nothing on the row is usable", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Edit", ButtonStyleType.OUTLINE, {
          disabled: true,
          tooltip: "You cannot edit this",
        }),
        DELETE,
      ]);

      expect(result.primary?.button.title).toBe("Edit");
      expect(result.primary?.button.disabled).toBe(true);
    });

    /*
     * A read-only member on a security-event connection: Test connection and
     * Run now are locked for them, Diagnostics is not. The one button on the
     * row should be the one they can press.
     */
    test("a usable action beats a locked one listed before it", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Test connection", ButtonStyleType.OUTLINE, { disabled: true }),
        action("Run now", ButtonStyleType.OUTLINE, { disabled: true }),
        action("Diagnostics", ButtonStyleType.OUTLINE),
        action("Edit", ButtonStyleType.OUTLINE, { disabled: true }),
      ]);

      expect(result.primary?.button.title).toBe("Diagnostics");
      expect(titles(result.moreMenu)).toEqual([
        "Test connection",
        "Run now",
        "Edit",
      ]);
    });

    test("a usable outlined action beats a locked call to action", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Run Now", ButtonStyleType.NORMAL, { disabled: true }),
        action("Diagnostics", ButtonStyleType.OUTLINE),
      ]);

      expect(result.primary?.button.title).toBe("Diagnostics");
      expect(titles(result.moreMenu)).toEqual(["Run Now"]);
    });

    test("among usable actions the call-to-action style still wins", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Diagnostics", ButtonStyleType.OUTLINE),
        action("Run Now", ButtonStyleType.NORMAL),
      ]);

      expect(result.primary?.button.title).toBe("Run Now");
    });

    test("when everything is locked, the call-to-action style still wins", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Diagnostics", ButtonStyleType.OUTLINE, { disabled: true }),
        action("Run Now", ButtonStyleType.NORMAL, { disabled: true }),
      ]);

      expect(result.primary?.button.title).toBe("Run Now");
      expect(result.primary?.button.disabled).toBe(true);
    });

    test("an explicit Primary stays the button even when it is locked", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Edit", ButtonStyleType.OUTLINE),
        action("Verify", ButtonStyleType.SUCCESS_OUTLINE, {
          placement: ActionButtonPlacement.Primary,
          disabled: true,
        }),
      ]);

      expect(result.primary?.button.title).toBe("Verify");
    });

    test("a usable destructive action is not promoted over a locked everyday one", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Edit", ButtonStyleType.OUTLINE, { disabled: true }),
        DELETE,
      ]);

      expect(result.primary?.button.title).toBe("Edit");
      expect(titles(result.moreMenu)).toEqual(["Remove from Project"]);
    });
  });

  describe("the menu", () => {
    test("keeps the authored order but sinks destructive actions to the bottom", () => {
      const result: SplitActionButtonsResult<Row> = split([
        VIEW,
        action("Revoke", ButtonStyleType.DANGER),
        action("Copy", ButtonStyleType.OUTLINE),
        DELETE,
        action("Rename", ButtonStyleType.OUTLINE),
        action("Archive", ButtonStyleType.HOVER_DANGER_OUTLINE),
      ]);

      expect(titles(result.moreMenu)).toEqual([
        "Copy",
        "Rename",
        "Revoke",
        "Remove from Project",
        "Archive",
      ]);
    });

    test("reports each action's index in the array the caller passed", () => {
      const result: SplitActionButtonsResult<Row> = split([
        SHOW_ID,
        action("Hidden", ButtonStyleType.OUTLINE, {
          isVisible: () => {
            return false;
          },
        }),
        VIEW,
        DELETE,
        EDIT,
      ]);

      expect(result.primary?.index).toBe(2);
      expect(
        result.moreMenu.map((entry: IndexedActionButton<Row>) => {
          return [entry.button.title, entry.index];
        }),
      ).toEqual([
        ["Show ID", 0],
        ["Edit", 4],
        ["Remove from Project", 3],
      ]);
    });

    test("never lists the button's action again in the menu", () => {
      const result: SplitActionButtonsResult<Row> = split([
        SHOW_ID,
        VIEW,
        EDIT,
        DELETE,
      ]);

      expect(titles(result.moreMenu)).not.toContain(
        result.primary?.button.title,
      );
      expect(result.moreMenu.length + 1).toBe(4);
    });
  });

  describe("visibility", () => {
    test("isVisible is evaluated against the row it is splitting", () => {
      const onlyForVerified: ActionButtonSchema<Row> = action(
        "Send Test",
        ButtonStyleType.OUTLINE,
        {
          isVisible: (item: Row) => {
            return Boolean(item.isVerified);
          },
        },
      );

      expect(
        titles(
          split([VIEW, onlyForVerified], {
            item: { id: "v", isVerified: true },
          }).moreMenu,
        ),
      ).toEqual(["Send Test"]);
      expect(
        split([VIEW, onlyForVerified], {
          item: { id: "u", isVerified: false },
        }).moreMenu,
      ).toEqual([]);
    });

    test("hideOnMobile actions are dropped on mobile only", () => {
      expect(
        titles(split([SHOW_ID, VIEW], { isMobile: false }).moreMenu),
      ).toEqual(["Show ID"]);
      expect(split([SHOW_ID, VIEW], { isMobile: true }).moreMenu).toEqual([]);
    });

    /*
     * The rows have always read a falsy isVisible as "hide", undefined
     * included; the split keeps that rather than quietly showing actions that
     * used to be hidden.
     */
    test("an isVisible that returns undefined hides the action, as it always has", () => {
      const result: SplitActionButtonsResult<Row> = split([
        action("Edit", ButtonStyleType.OUTLINE, {
          isVisible: () => {
            return undefined;
          },
        }),
      ]);

      expect(result.primary).toBeNull();
      expect(result.moreMenu).toEqual([]);
    });
  });
});

describe("isDestructiveActionButton", () => {
  test.each([
    ["DANGER", ButtonStyleType.DANGER, true],
    ["DANGER_OUTLINE", ButtonStyleType.DANGER_OUTLINE, true],
    ["HOVER_DANGER_OUTLINE", ButtonStyleType.HOVER_DANGER_OUTLINE, true],
    ["NORMAL", ButtonStyleType.NORMAL, false],
    ["OUTLINE", ButtonStyleType.OUTLINE, false],
    ["PRIMARY", ButtonStyleType.PRIMARY, false],
    ["SUCCESS_OUTLINE", ButtonStyleType.SUCCESS_OUTLINE, false],
    ["WARNING", ButtonStyleType.WARNING, false],
  ])(
    "%s is destructive: %s",
    (_label: string, style: ButtonStyleType, expected: boolean) => {
      expect(isDestructiveActionButton(action("Action", style))).toBe(expected);
    },
  );
});

describe("isActionButtonVisible", () => {
  test("visible by default on both layouts", () => {
    expect(isActionButtonVisible(EDIT, ROW, false)).toBe(true);
    expect(isActionButtonVisible(EDIT, ROW, true)).toBe(true);
  });

  test("hideOnMobile only hides on mobile", () => {
    expect(isActionButtonVisible(SHOW_ID, ROW, false)).toBe(true);
    expect(isActionButtonVisible(SHOW_ID, ROW, true)).toBe(false);
  });

  test("isVisible returning false hides the action", () => {
    const hidden: ActionButtonSchema<Row> = action(
      "X",
      ButtonStyleType.OUTLINE,
      {
        isVisible: () => {
          return false;
        },
      },
    );

    expect(isActionButtonVisible(hidden, ROW, false)).toBe(false);
  });
});
