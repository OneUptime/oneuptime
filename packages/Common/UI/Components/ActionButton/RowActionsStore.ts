import { RowActionConfirmation } from "./ActionButtonSchema";
import { IndexedActionButton } from "./SplitActionButtons";
import GenericObject from "../../../Types/GenericObject";

/*
 * WHAT A ROW'S ACTIONS HAVE OPEN, KEPT BY THE TABLE THE ROW IS IN.
 *
 * A row's actions (RowActions) open things: an action's question
 * (getConfirmation), an action's error, the ⋯ menu. The row used to keep
 * them itself, and a table draws every row again when it changes how it
 * fits (TableFit: rows, folded, cards) - a phone turned sideways, a window
 * resized across 768px, a whole page's screenshot that lays the page out
 * again. Each row was a new one then, and a question it had open was gone
 * without an answer, with nothing to say why (#9513).
 *
 * So the table keeps them here, by each row's key, and draws the dialogs
 * itself, outside the rows (RowActionDialogs). A change of fit leaves a
 * question open, still asking about the row it named, and the answer acts
 * on that row; a ⋯ menu open on a row opens again on that row, where the
 * table draws it now. A row's actions drawn outside a table (a List's
 * card, a page's own row) keep a store of their own, as they always kept
 * their own state.
 */

// Where a dialog was opened from: the row's button, or its ⋯ menu.
export enum RowActionOpener {
  Button = "Button",
  Menu = "Menu",
}

export enum RowActionDialogKind {
  Question = "Question",
  Error = "Error",
}

interface RowActionDialogBase {
  // Each dialog's own, for as long as the store lives.
  id: number;
  // The key of the row's actions that opened it.
  rowKey: string;
  openedFrom: RowActionOpener;
}

/*
 * An action's question. It acts on the row as it was asked about - the
 * row the question names - whatever has happened to the list since: rows
 * read in above it, the list sorted again, the row gone from it. A list
 * whose rows are kept by their place would otherwise hand the answer to
 * whichever row took that place.
 */
export interface RowActionQuestion<T extends GenericObject>
  extends RowActionDialogBase {
  kind: RowActionDialogKind.Question;
  item: T;
  action: IndexedActionButton<T>;
  confirmation: RowActionConfirmation;
}

// What an action that ran at once said when it failed.
export interface RowActionError extends RowActionDialogBase {
  kind: RowActionDialogKind.Error;
  message: string;
}

export type RowActionDialog<T extends GenericObject> =
  | RowActionQuestion<T>
  | RowActionError;

/*
 * What a row's actions have open while they are drawn again: whether the
 * ⋯ menu is, which actions are running (by their index in the row's
 * actions), and how to give the focus back to what opened a dialog.
 */
interface RowActionsSlot {
  isMenuOpen: boolean;
  loadingActionIndexes: Array<boolean>;
  drawnCount: number;
  focusOpener: RowActionsFocusOpener | null;
}

/*
 * Focuses what opened a dialog - the row's button, or its ⋯ - in the row
 * as it is drawn now. False when the row has neither.
 */
export type RowActionsFocusOpener = (openedFrom: RowActionOpener) => boolean;

export default class RowActionsStore<T extends GenericObject> {
  private dialogs: ReadonlyArray<RowActionDialog<T>> = [];
  private slots: Map<string, RowActionsSlot> = new Map();
  private listeners: Set<() => void> = new Set();
  private nextDialogId: number = 1;

  // The dialogs open, in the order they opened.
  public getDialogs(): ReadonlyArray<RowActionDialog<T>> {
    return this.dialogs;
  }

  // Told whenever a dialog opens or closes (RowActionDialogs).
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  public openQuestion(data: {
    rowKey: string;
    item: T;
    action: IndexedActionButton<T>;
    confirmation: RowActionConfirmation;
    openedFrom: RowActionOpener;
  }): void {
    this.setDialogs([
      ...this.dialogs,
      {
        kind: RowActionDialogKind.Question,
        id: this.takeDialogId(),
        rowKey: data.rowKey,
        item: data.item,
        action: data.action,
        confirmation: data.confirmation,
        openedFrom: data.openedFrom,
      },
    ]);
  }

  public openError(data: {
    rowKey: string;
    message: string;
    openedFrom: RowActionOpener;
  }): void {
    this.setDialogs([
      ...this.dialogs,
      {
        kind: RowActionDialogKind.Error,
        id: this.takeDialogId(),
        rowKey: data.rowKey,
        message: data.message,
        openedFrom: data.openedFrom,
      },
    ]);
  }

  public closeDialog(id: number): void {
    const next: Array<RowActionDialog<T>> = this.dialogs.filter(
      (dialog: RowActionDialog<T>): boolean => {
        return dialog.id !== id;
      },
    );

    if (next.length !== this.dialogs.length) {
      this.setDialogs(next);
    }
  }

  // Whether a row's ⋯ menu was open when its actions were last drawn.
  public isMenuOpen(rowKey: string): boolean {
    return Boolean(this.slots.get(rowKey)?.isMenuOpen);
  }

  public setMenuOpen(rowKey: string, isOpen: boolean): void {
    if (!isOpen && !this.slots.has(rowKey)) {
      return;
    }

    this.getSlot(rowKey).isMenuOpen = isOpen;
  }

  /*
   * Which of a row's actions are running, by their index in its actions:
   * the array itself, written as an action starts and ends, and read as
   * the row is drawn - never a reason to draw it (RowActions says why).
   */
  public getLoadingActionIndexes(rowKey: string): Array<boolean> {
    return this.getSlot(rowKey).loadingActionIndexes;
  }

  /*
   * A row's actions are drawn (from a layout effect, so a row drawn again
   * by a change of fit is drawn before the old one's release is weighed),
   * with how to focus what opened a dialog. Returns what undoes it.
   *
   * A row's actions taken away and not drawn again in the same commit -
   * the row left the list, the page of rows changed - let go of what they
   * had open: the row's ⋯ menu does not open by itself when the row comes
   * back. A change of fit takes the old actions away and draws the new in
   * one commit, so they keep it.
   */
  public drawRow(
    rowKey: string,
    focusOpener: RowActionsFocusOpener,
  ): () => void {
    const slot: RowActionsSlot = this.getSlot(rowKey);

    slot.drawnCount += 1;
    slot.focusOpener = focusOpener;

    return (): void => {
      slot.drawnCount -= 1;

      if (slot.focusOpener === focusOpener) {
        slot.focusOpener = null;
      }

      /*
       * Weighed once the commit is over - a promise's turn, which comes
       * after it and which no fake timer holds back.
       */
      void Promise.resolve().then((): void => {
        if (slot.drawnCount <= 0 && this.slots.get(rowKey) === slot) {
          this.slots.delete(rowKey);
        }
      });
    };
  }

  /*
   * Gives the focus back to what opened a dialog, in the row as it is
   * drawn now. False when the row is not drawn, or has nothing to focus.
   */
  public focusOpener(rowKey: string, openedFrom: RowActionOpener): boolean {
    const focus: RowActionsFocusOpener | null | undefined =
      this.slots.get(rowKey)?.focusOpener;

    return focus ? focus(openedFrom) : false;
  }

  private getSlot(rowKey: string): RowActionsSlot {
    const existing: RowActionsSlot | undefined = this.slots.get(rowKey);

    if (existing) {
      return existing;
    }

    const slot: RowActionsSlot = {
      isMenuOpen: false,
      loadingActionIndexes: [],
      drawnCount: 0,
      focusOpener: null,
    };

    this.slots.set(rowKey, slot);

    return slot;
  }

  private takeDialogId(): number {
    const id: number = this.nextDialogId;

    this.nextDialogId += 1;

    return id;
  }

  private setDialogs(dialogs: ReadonlyArray<RowActionDialog<T>>): void {
    this.dialogs = dialogs;

    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}
