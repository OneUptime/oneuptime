/*
 * Undo and redo for the reference editor.
 *
 * The browser keeps an undo stack for what it types itself, but the editor
 * also changes its content directly - a picked value, a paste, a line break -
 * and the browser's stack cannot undo those; worse, undoing past one replays
 * typing into a document that no longer looks the way it remembers. So the
 * editor keeps its own: a snapshot of the value and caret per change, with a
 * run of typing collapsed into one step the way every text box does it.
 *
 * Pure: no DOM.
 */

export interface TemplateTextSnapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export enum TemplateTextChangeKind {
  /** Characters typed one after another: merged into one undo step. */
  Typing = "Typing",
  /** Characters deleted one after another: merged too. */
  Deleting = "Deleting",
  /** Everything else - a picked value, a paste, a line break: its own step. */
  Other = "Other",
}

// A pause this long ends a run of typing.
export const TYPING_MERGE_WINDOW_MS: number = 1000;
const MAX_HISTORY: number = 200;

export default class TemplateTextHistory {
  private past: Array<TemplateTextSnapshot> = [];
  private future: Array<TemplateTextSnapshot> = [];
  private lastKind: TemplateTextChangeKind | null = null;
  private lastAt: number = 0;

  public constructor(initial: TemplateTextSnapshot) {
    this.past = [initial];
  }

  public get current(): TemplateTextSnapshot {
    return this.past[this.past.length - 1]!;
  }

  public canUndo(): boolean {
    return this.past.length > 1;
  }

  public canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * Record a change. A change of the same kind as the last, within the merge
   * window, replaces it rather than adding a step.
   *
   * `selectionBefore` is where the caret was just before the change. Undo
   * puts it back there - where the change happened - rather than wherever it
   * was when the previous step was recorded.
   */
  public record(
    snapshot: TemplateTextSnapshot,
    kind: TemplateTextChangeKind,
    now: number = Date.now(),
    selectionBefore?: { start: number; end: number } | undefined,
  ): void {
    if (snapshot.value === this.current.value) {
      // Only the caret moved: keep where it is, for redo to come back to.
      this.past[this.past.length - 1] = snapshot;
      return;
    }

    const merges: boolean =
      kind !== TemplateTextChangeKind.Other &&
      kind === this.lastKind &&
      now - this.lastAt <= TYPING_MERGE_WINDOW_MS &&
      this.past.length > 1;

    if (merges) {
      this.past[this.past.length - 1] = snapshot;
    } else {
      if (selectionBefore) {
        this.past[this.past.length - 1] = {
          ...this.current,
          selectionStart: selectionBefore.start,
          selectionEnd: selectionBefore.end,
        };
      }

      this.past.push(snapshot);

      if (this.past.length > MAX_HISTORY) {
        this.past.shift();
      }
    }

    this.future = [];
    this.lastKind = kind;
    this.lastAt = now;
  }

  /**
   * The value changed from outside the editor (the form set it). It becomes
   * the starting point, and nothing before it can be undone into.
   */
  public reset(snapshot: TemplateTextSnapshot): void {
    this.past = [snapshot];
    this.future = [];
    this.lastKind = null;
    this.lastAt = 0;
  }

  public undo(): TemplateTextSnapshot | null {
    if (!this.canUndo()) {
      return null;
    }

    this.future.push(this.past.pop()!);
    this.lastKind = null;

    return this.current;
  }

  public redo(): TemplateTextSnapshot | null {
    const next: TemplateTextSnapshot | undefined = this.future.pop();

    if (!next) {
      return null;
    }

    this.past.push(next);
    this.lastKind = null;

    return next;
  }
}
