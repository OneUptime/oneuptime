import { describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import RowActionsStore, {
  RowActionDialog,
  RowActionDialogKind,
  RowActionOpener,
  RowActionsFocusOpener,
} from "../../../../UI/Components/ActionButton/RowActionsStore";
import ActionButtonSchema, {
  RowActionConfirmation,
} from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import IconProp from "../../../../Types/Icon/IconProp";

/*
 * What a table keeps of its rows' actions (RowActionsStore, #9513): the
 * dialogs they opened, which it draws itself, outside its rows; and, by
 * each row's key, whether its ⋯ menu is open, which of its actions are
 * running, and how to give the focus back to it. A row drawn again in the
 * same commit - a change of how the table fits - keeps what it had open; a
 * row taken away and not drawn again lets go of it.
 */

interface Row {
  _id: string;
  name: string;
}

const ROW: Row = { _id: "1", name: "Checkout is slow" };

const DELETE: ActionButtonSchema<Row> = {
  title: "Delete",
  icon: IconProp.Trash,
  buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
  onClick: (): void => {},
};

const QUESTION: RowActionConfirmation = {
  title: "Delete Answer",
  description: "Are you sure you want to delete Checkout is slow?",
  submitButtonText: "Delete",
};

// What the commit that took a row away leaves for the store to weigh.
const afterTheCommit: () => Promise<void> = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const openQuestion: (store: RowActionsStore<Row>, rowKey: string) => void = (
  store: RowActionsStore<Row>,
  rowKey: string,
): void => {
  store.openQuestion({
    rowKey: rowKey,
    item: ROW,
    action: { button: DELETE, index: 2 },
    confirmation: QUESTION,
    openedFrom: RowActionOpener.Menu,
  });
};

describe("a row's dialogs", () => {
  test("open in the order they are opened, each with its own id, and close by it", () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();

    openQuestion(store, "1/actions");
    store.openError({
      rowKey: "2/actions",
      message: "This answer is archived already.",
      openedFrom: RowActionOpener.Button,
    });

    const dialogs: ReadonlyArray<RowActionDialog<Row>> = store.getDialogs();

    expect(
      dialogs.map((dialog: RowActionDialog<Row>) => {
        return [dialog.kind, dialog.rowKey];
      }),
    ).toEqual([
      [RowActionDialogKind.Question, "1/actions"],
      [RowActionDialogKind.Error, "2/actions"],
    ]);
    expect(dialogs[0]!.id).not.toBe(dialogs[1]!.id);

    // The question holds the row it names and the action it asks about.
    const question: RowActionDialog<Row> = dialogs[0]!;

    expect(
      question.kind === RowActionDialogKind.Question && question.item,
    ).toBe(ROW);
    expect(
      question.kind === RowActionDialogKind.Question && question.action.index,
    ).toBe(2);

    store.closeDialog(dialogs[0]!.id);

    expect(
      store.getDialogs().map((dialog: RowActionDialog<Row>) => {
        return dialog.rowKey;
      }),
    ).toEqual(["2/actions"]);
  });

  test("tell whoever listens as one opens and as one closes, and nobody once they stop listening", () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();
    const listener: Mock<() => void> = jest.fn<() => void>();
    const stop: () => void = store.subscribe(listener);

    openQuestion(store, "1/actions");
    expect(listener).toHaveBeenCalledTimes(1);

    store.closeDialog(store.getDialogs()[0]!.id);
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    openQuestion(store, "1/actions");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("closing one that is not open changes nothing and tells nobody", () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();
    const listener: Mock<() => void> = jest.fn<() => void>();

    openQuestion(store, "1/actions");

    const before: ReadonlyArray<RowActionDialog<Row>> = store.getDialogs();

    store.subscribe(listener);
    store.closeDialog(before[0]!.id + 100);

    expect(listener).not.toHaveBeenCalled();
    expect(store.getDialogs()).toBe(before);
  });

  test("are kept apart from the rows: a row taken away leaves its question open", async () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();
    const undraw: () => void = store.drawRow("1/actions", () => {
      return true;
    });

    openQuestion(store, "1/actions");
    undraw();
    await afterTheCommit();

    expect(store.getDialogs()).toHaveLength(1);
  });
});

describe("a row's ⋯ menu", () => {
  test("is open once it is said to be, and closed once it is said to be", () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();

    store.drawRow("1/actions", () => {
      return true;
    });

    expect(store.isMenuOpen("1/actions")).toBe(false);

    store.setMenuOpen("1/actions", true);
    expect(store.isMenuOpen("1/actions")).toBe(true);
    // Another row's is its own.
    expect(store.isMenuOpen("2/actions")).toBe(false);

    store.setMenuOpen("1/actions", false);
    expect(store.isMenuOpen("1/actions")).toBe(false);
  });

  test("stays open for a row drawn again in the same commit - a change of how the table fits", async () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();
    const undrawRow: () => void = store.drawRow("1/actions", () => {
      return true;
    });

    store.setMenuOpen("1/actions", true);

    // The row as a row taken away, the row as a card drawn: one commit.
    undrawRow();
    store.drawRow("1/actions", () => {
      return true;
    });
    await afterTheCommit();

    expect(store.isMenuOpen("1/actions")).toBe(true);
  });

  test("closes for a row taken away and not drawn again - the next page, a row deleted - so it does not open by itself when the row comes back", async () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();
    const undraw: () => void = store.drawRow("1/actions", () => {
      return true;
    });

    store.setMenuOpen("1/actions", true);
    undraw();
    await afterTheCommit();

    expect(store.isMenuOpen("1/actions")).toBe(false);

    store.drawRow("1/actions", () => {
      return true;
    });

    expect(store.isMenuOpen("1/actions")).toBe(false);
  });
});

describe("a row's running actions", () => {
  test("are its own, and stay through a commit that draws it again", async () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();
    const undraw: () => void = store.drawRow("1/actions", () => {
      return true;
    });

    store.getLoadingActionIndexes("1/actions")[2] = true;

    expect(store.getLoadingActionIndexes("2/actions")[2]).toBeUndefined();

    undraw();
    store.drawRow("1/actions", () => {
      return true;
    });
    await afterTheCommit();

    expect(store.getLoadingActionIndexes("1/actions")[2]).toBe(true);
  });

  test("are forgotten with the row once it is taken away and not drawn again", async () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();
    const undraw: () => void = store.drawRow("1/actions", () => {
      return true;
    });

    store.getLoadingActionIndexes("1/actions")[2] = true;
    undraw();
    await afterTheCommit();

    expect(store.getLoadingActionIndexes("1/actions")[2]).toBeUndefined();
  });
});

describe("giving the focus back to a row", () => {
  test("asks the row's actions as they are drawn now, saying what opened the dialog", () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();
    const focus: Mock<RowActionsFocusOpener> = jest.fn<RowActionsFocusOpener>(
      () => {
        return true;
      },
    );

    store.drawRow("1/actions", focus);

    expect(store.focusOpener("1/actions", RowActionOpener.Menu)).toBe(true);
    expect(focus).toHaveBeenCalledWith(RowActionOpener.Menu);
  });

  test("goes to the row drawn again, whichever way round the old one goes and the new one comes", () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();
    const asRow: Mock<RowActionsFocusOpener> = jest.fn<RowActionsFocusOpener>(
      () => {
        return true;
      },
    );
    const asCard: Mock<RowActionsFocusOpener> = jest.fn<RowActionsFocusOpener>(
      () => {
        return true;
      },
    );
    const asRowAgain: Mock<RowActionsFocusOpener> =
      jest.fn<RowActionsFocusOpener>(() => {
        return true;
      });

    // Taken away, then drawn again.
    const undrawRow: () => void = store.drawRow("1/actions", asRow);

    undrawRow();

    const undrawCard: () => void = store.drawRow("1/actions", asCard);

    store.focusOpener("1/actions", RowActionOpener.Button);

    expect(asRow).not.toHaveBeenCalled();
    expect(asCard).toHaveBeenCalledTimes(1);

    // Drawn again first, then the old taken away.
    store.drawRow("1/actions", asRowAgain);
    undrawCard();
    store.focusOpener("1/actions", RowActionOpener.Button);

    expect(asCard).toHaveBeenCalledTimes(1);
    expect(asRowAgain).toHaveBeenCalledTimes(1);
  });

  test("is not done for a row that is not drawn, or has nothing to focus", async () => {
    const store: RowActionsStore<Row> = new RowActionsStore<Row>();

    expect(store.focusOpener("1/actions", RowActionOpener.Menu)).toBe(false);

    const undraw: () => void = store.drawRow("1/actions", () => {
      return false;
    });

    expect(store.focusOpener("1/actions", RowActionOpener.Menu)).toBe(false);

    undraw();
    await afterTheCommit();

    expect(store.focusOpener("1/actions", RowActionOpener.Menu)).toBe(false);
  });
});
