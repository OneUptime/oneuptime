/*
 * Undo and redo for the edits the visual editor makes to its DOM itself.
 *
 * Typing, and the edits the editor hands to document.execCommand, are on the
 * browser's own undo stack. Some edits cannot be: moving list items for Tab
 * and Shift+Tab (execCommand("indent") nests a <ul> straight inside a <ul>,
 * which the serializer drops) and inserting what execCommand would put in
 * the wrong place (a block in the middle of a line, formatted words). The
 * browser never hears of those, so Ctrl+Z after Tab undid the typing before
 * it and left the indent in place.
 *
 * Each such edit is recorded here as the DOM mutations it made
 * (MutationObserver records), and undone by reverting them, newest first:
 * the nodes that moved go back where they were and changed text gets its
 * old value back. The editor's HTML is never reset from a copy -- the
 * browser's undo entries for earlier typing point at these same nodes, so
 * once one Ctrl+Z has undone an indent, the next undoes the typing before
 * it, as in any editor.
 *
 * A record is only applied while the editor is exactly as the edit left it,
 * which is checked against its HTML. Anything else that changes the editor
 * -- typing, a paste the browser makes, an execCommand -- is newer history
 * in the browser's own stack, so Ctrl+Z is the browser's until its undo has
 * taken all of that back. Then the editor is as the edit left it again, and
 * the next Ctrl+Z takes the edit back: typing "npm ci" into the code block
 * the Code Block button inserted after "Run:", Ctrl+Z undoes the typing,
 * then the block, then "Run:". The records used to be dropped at the first
 * keystroke, and the second Ctrl+Z went to the browser's next entry -- the
 * typing before the block, "Run:" -- with the block left in.
 */

interface SavedSelection {
  anchorNode: Node;
  anchorOffset: number;
  focusNode: Node;
  focusOffset: number;
}

interface HistoryEntry {
  // What the edit did to the DOM, oldest first.
  records: Array<MutationRecord>;
  // The editor's HTML once the edit was made.
  html: string;
  selectionBefore: SavedSelection | null;
  selectionAfter: SavedSelection | null;
}

// Plenty for a burst of Tab presses, without holding on to old nodes forever.
const MAX_ENTRIES: number = 100;

const OBSERVED: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
  characterDataOldValue: true,
  attributes: true,
  attributeOldValue: true,
};

const saveSelection: (root: HTMLElement) => SavedSelection | null = (
  root: HTMLElement,
): SavedSelection | null => {
  const selection: Selection | null = root.ownerDocument.getSelection();
  if (
    !selection ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  ) {
    return null;
  }
  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
  };
};

const nodeLength: (node: Node) => number = (node: Node): number => {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) {
    return (node as CharacterData).length;
  }
  return node.childNodes.length;
};

const restoreSelection: (
  root: HTMLElement,
  saved: SavedSelection | null,
) => void = (root: HTMLElement, saved: SavedSelection | null): void => {
  const selection: Selection | null = root.ownerDocument.getSelection();
  if (
    !selection ||
    !saved ||
    !root.contains(saved.anchorNode) ||
    !root.contains(saved.focusNode)
  ) {
    return;
  }
  try {
    selection.setBaseAndExtent(
      saved.anchorNode,
      Math.min(saved.anchorOffset, nodeLength(saved.anchorNode)),
      saved.focusNode,
      Math.min(saved.focusOffset, nodeLength(saved.focusNode)),
    );
  } catch {
    // Leave the selection where it is rather than fail the undo.
  }
};

/*
 * Puts the DOM back as it was before `records` were made, newest first.
 * Each record is reverted against the DOM exactly as the record left it,
 * where its target was inside `root` (the mutation would not have been
 * seen otherwise). A node that is not where the record says -- something
 * else moved it, or replaced the editor's content with copies -- throws
 * rather than going somewhere else.
 */
const revertRecords: (
  root: HTMLElement,
  records: Array<MutationRecord>,
) => void = (root: HTMLElement, records: Array<MutationRecord>): void => {
  for (let index: number = records.length - 1; index >= 0; index--) {
    const record: MutationRecord = records[index] as MutationRecord;
    if (!root.contains(record.target)) {
      throw new Error("The editor changed since this edit was made.");
    }
    if (record.type === "childList") {
      const added: Array<Node> = Array.from(record.addedNodes).reverse();
      for (const node of added) {
        if (node.parentNode !== record.target) {
          throw new Error("The editor changed since this edit was made.");
        }
        record.target.removeChild(node);
      }
      for (const node of Array.from(record.removedNodes)) {
        record.target.insertBefore(node, record.nextSibling);
      }
    } else if (record.type === "characterData") {
      (record.target as CharacterData).data = record.oldValue ?? "";
    } else if (record.type === "attributes" && record.attributeName) {
      const element: Element = record.target as Element;
      if (record.oldValue === null) {
        element.removeAttributeNS(
          record.attributeNamespace,
          record.attributeName,
        );
      } else {
        element.setAttributeNS(
          record.attributeNamespace,
          record.attributeName,
          record.oldValue,
        );
      }
    }
  }
};

export default class MarkdownEditorHistory {
  private undoEntries: Array<HistoryEntry> = [];
  private redoEntries: Array<HistoryEntry> = [];

  /*
   * Makes an edit to `root` by hand, recording it so undo can take it back.
   * `edit` returns whether it changed anything, and so does this.
   *
   * The edit must change only nodes that are in `root` at the time. Text
   * trimmed from a node it has taken out, or nodes moved into an element it
   * has not yet put in, are changes the undo or the redo cannot check the
   * editor against, and it is refused -- so a split line's second half goes
   * into the editor before the text after the caret goes into it, and its
   * space is trimmed after that (MarkdownVisualEditing).
   */
  public record(root: HTMLElement, edit: () => boolean): boolean {
    const selectionBefore: SavedSelection | null = saveSelection(root);
    const observer: MutationObserver = new MutationObserver((): void => {
      // Records are taken synchronously below; nothing to do as they come.
    });
    observer.observe(root, OBSERVED);
    let changed: boolean = false;
    let records: Array<MutationRecord> = [];
    try {
      changed = edit();
    } finally {
      records = observer.takeRecords();
      observer.disconnect();
    }
    if (records.length > 0) {
      this.undoEntries.push({
        records,
        html: root.innerHTML,
        selectionBefore,
        selectionAfter: saveSelection(root),
      });
      if (this.undoEntries.length > MAX_ENTRIES) {
        this.undoEntries.shift();
      }
      this.redoEntries = [];
    }
    return changed;
  }

  // Takes back the last edit made by hand; false when there is none to take back.
  public undo(root: HTMLElement): boolean {
    return this.step(root, this.undoEntries, this.redoEntries);
  }

  // Makes the last undone edit again; false when there is none.
  public redo(root: HTMLElement): boolean {
    return this.step(root, this.redoEntries, this.undoEntries);
  }

  /*
   * Forgets every record: the editor's content was replaced -- a new
   * editable, markdown set from outside -- and the nodes they move are gone.
   */
  public clear(): void {
    this.undoEntries = [];
    this.redoEntries = [];
  }

  /*
   * Forgets what could be redone. Called when the editor is edited some
   * other way -- typing, a paste the browser makes -- as the browser's own
   * redo goes then. What can be undone stays, for when the browser's undo
   * has taken that newer edit back.
   */
  public clearRedo(): void {
    this.redoEntries = [];
  }

  private step(
    root: HTMLElement,
    from: Array<HistoryEntry>,
    to: Array<HistoryEntry>,
  ): boolean {
    const entry: HistoryEntry | undefined = from[from.length - 1];
    /*
     * Not as the edit left it: newer edits are the browser's to take back
     * first. The record stays, and applies once they are.
     */
    if (!entry || root.innerHTML !== entry.html) {
      return false;
    }
    from.pop();
    const observer: MutationObserver = new MutationObserver((): void => {
      // Records are taken synchronously below; nothing to do as they come.
    });
    observer.observe(root, OBSERVED);
    let reverted: boolean = true;
    try {
      revertRecords(root, entry.records);
    } catch {
      reverted = false;
    }
    const records: Array<MutationRecord> = observer.takeRecords();
    observer.disconnect();
    if (!reverted) {
      /*
       * The editor no longer matches the record (a node was moved behind
       * its back, with the HTML the same). What was reverted is put back so
       * the editor is as it was, and the history that no longer fits goes.
       */
      try {
        revertRecords(root, records);
      } catch {
        // Nothing more can be done; the editor keeps what it has.
      }
      this.clear();
      return false;
    }
    // The revert is itself an edit, which redo (or undo) reverts in turn.
    to.push({
      records,
      html: root.innerHTML,
      selectionBefore: entry.selectionAfter,
      selectionAfter: entry.selectionBefore,
    });
    restoreSelection(root, entry.selectionBefore);
    return true;
  }
}
