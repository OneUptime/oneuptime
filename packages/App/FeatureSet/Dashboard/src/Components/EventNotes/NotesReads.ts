/*
 * The reads of a notes feed (EventNotes), and which answer is still the one
 * to draw. Each read takes a token, the next number, and its answer - its
 * notes, or its failure - is drawn only while no read that wins over it has
 * started since, so a slow answer never overwrites a newer one:
 *
 *   - top:        a read from the top (the first, a search, the sort, a
 *                 refresh) gives way to a later read from the top alone;
 *   - more:       Load more gives way to a later read from the top, and to
 *                 the notes on screen being replaced while it reads: its
 *                 page goes on from them;
 *   - background: the re-read while a notification is on its way gives way
 *                 to any later read, and to the notes being replaced.
 *
 * One count for every read made Load more drop a sort pressed just before
 * it: the sort's answer, come after Load more had started, was taken for an
 * old one, and the notes stayed in the order the reader had asked to leave
 * (#7707).
 */
export type NotesReadKind = "top" | "more" | "background";

export interface NotesRead {
  kind: NotesReadKind;
  token: number;
  // The read whose answer put the notes on screen, as this one started.
  readOn: number;
}

export default class NotesReads {
  private lastToken: number = 0;
  private lastFromTop: number = 0;
  private lastLoadMore: number = 0;
  // The read whose answer put the notes on screen: 0 before any.
  private notesFrom: number = 0;

  public start(kind: NotesReadKind): NotesRead {
    const token: number = ++this.lastToken;

    if (kind === "top") {
      this.lastFromTop = token;
    } else if (kind === "more") {
      this.lastLoadMore = token;
    }

    return { kind: kind, token: token, readOn: this.notesFrom };
  }

  // Whether the read's answer is still the one to draw.
  public isCurrent(read: NotesRead): boolean {
    if (read.kind === "top") {
      return read.token === this.lastFromTop;
    }

    const isSameNotes: boolean = this.notesFrom === read.readOn;

    if (read.kind === "more") {
      return (
        read.token === this.lastLoadMore &&
        this.lastFromTop < read.token &&
        isSameNotes
      );
    }

    return read.token === this.lastToken && isSameNotes;
  }

  /*
   * Whether no read of its kind has started since: the one whose end is the
   * end of its kind's wait (the feed's loading, refreshing or Load more's
   * spinner), whether its answer was drawn or not.
   */
  public isLatestOfItsKind(read: NotesRead): boolean {
    if (read.kind === "top") {
      return read.token === this.lastFromTop;
    }

    if (read.kind === "more") {
      return read.token === this.lastLoadMore;
    }

    return read.token === this.lastToken;
  }

  /*
   * The read's notes are drawn. A read from the top, or the background's,
   * puts its notes on screen in the place of the last; Load more adds to
   * them.
   */
  public drawn(read: NotesRead): void {
    if (read.kind !== "more") {
      this.notesFrom = read.token;
    }
  }
}
