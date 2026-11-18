import { describe, expect, test } from "@jest/globals";
import NotesReads, {
  NotesRead,
  NotesReadKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NotesReads";

/*
 * WHICH ANSWER OF THE NOTES FEED'S READS IS DRAWN (#7707).
 *
 * The feed (EventNotes) gave every read one count, and drew an answer only
 * while no read at all had started after it. So Load more, pressed while a
 * sort's notes were on their way, dropped the sort: its answer came after
 * Load more had started, and was taken for an old one. The notes stayed in
 * the order the reader had asked to leave, and Load more's page went on in
 * it. Each kind of read gives way only to what wins over it now:
 *
 *   - a read from the top (the first, a search, the sort, a refresh), to a
 *     later read from the top;
 *   - Load more, to a later read from the top, and to the notes on screen
 *     being replaced while it reads;
 *   - the background re-read, to any later read.
 *
 * The feed locks Load more while a read from the top is on its way, too
 * (EventNotesLoadFailure): these are the rules under that, whatever order
 * the answers arrive in.
 */

// The answers of `reads`, in `order`: which were drawn, as the feed draws them.
const answerInOrder: (
  readsState: NotesReads,
  order: Array<NotesRead>,
) => Array<number> = (
  readsState: NotesReads,
  order: Array<NotesRead>,
): Array<number> => {
  const drawn: Array<number> = [];

  for (const read of order) {
    if (readsState.isCurrent(read)) {
      readsState.drawn(read);
      drawn.push(read.token);
    }
  }

  return drawn;
};

describe("a sort pressed just before Load more", () => {
  /*
   * Should a Load more start while the sort is on its way - the feed locks
   * it, so no reader can - the sort still lands, whichever answers first.
   */
  test.each([
    ["the sort's answer first", ["sort", "more"]],
    ["Load more's answer first", ["more", "sort"]],
  ])(
    "lands with %s; Load more's page goes on from the notes it was read for, or not at all",
    (_name: string, order: Array<string>) => {
      const reads: NotesReads = new NotesReads();
      const first: NotesRead = reads.start("top");
      answerInOrder(reads, [first]);

      const sort: NotesRead = reads.start("top");
      const more: NotesRead = reads.start("more");
      const byName: Record<string, NotesRead> = { sort, more };

      const drawn: Array<number> = answerInOrder(
        reads,
        order.map((name: string): NotesRead => {
          return byName[name]!;
        }),
      );

      // The sort is always drawn.
      expect(drawn).toContain(sort.token);

      if (order[0] === "sort") {
        // Load more's page was for the notes the sort has replaced.
        expect(drawn).toEqual([sort.token]);
      } else {
        // Drawn onto the notes it was read for, then the sort replaced them.
        expect(drawn).toEqual([more.token, sort.token]);
      }
    },
  );

  test("the latest read from the top is the one whose end ends the wait, though Load more started after it", () => {
    const reads: NotesReads = new NotesReads();
    const sort: NotesRead = reads.start("top");
    const more: NotesRead = reads.start("more");

    expect(reads.isLatestOfItsKind(sort)).toBe(true);
    expect(reads.isLatestOfItsKind(more)).toBe(true);
  });
});

describe("Load more pressed, then a read from the top before its page came", () => {
  test.each([
    ["Load more's answer first", ["more", "top"]],
    ["the read from the top first", ["top", "more"]],
  ])(
    "with %s, only the read from the top is drawn: Load more's page was for the notes it replaces",
    (_name: string, order: Array<string>) => {
      const reads: NotesReads = new NotesReads();
      answerInOrder(reads, [reads.start("top")]);

      const more: NotesRead = reads.start("more");
      const top: NotesRead = reads.start("top");
      const byName: Record<string, NotesRead> = { more, top };

      expect(
        answerInOrder(
          reads,
          order.map((name: string): NotesRead => {
            return byName[name]!;
          }),
        ),
      ).toEqual([top.token]);
      // Its wait still ends with it: no later Load more started.
      expect(reads.isLatestOfItsKind(more)).toBe(true);
    },
  );
});

describe("a late answer never overwrites a newer one", () => {
  test.each([["top"], ["more"], ["background"]] as Array<[NotesReadKind]>)(
    "of two reads of the kind %s, only the later is drawn, whichever answers first",
    (kind: NotesReadKind) => {
      for (const isLaterFirst of [true, false]) {
        const reads: NotesReads = new NotesReads();
        answerInOrder(reads, [reads.start("top")]);

        const earlier: NotesRead = reads.start(kind);
        const later: NotesRead = reads.start(kind);

        expect(
          answerInOrder(
            reads,
            isLaterFirst ? [later, earlier] : [earlier, later],
          ),
        ).toEqual([later.token]);
        expect(reads.isLatestOfItsKind(earlier)).toBe(false);
        expect(reads.isLatestOfItsKind(later)).toBe(true);
      }
    },
  );

  test("a search typed while a refresh was on its way: the refresh's late answer is dropped", () => {
    const reads: NotesReads = new NotesReads();
    answerInOrder(reads, [reads.start("top")]);

    const refresh: NotesRead = reads.start("top");
    const search: NotesRead = reads.start("top");

    expect(answerInOrder(reads, [search, refresh])).toEqual([search.token]);
  });
});

describe("the background re-read", () => {
  test("gives way to Load more started after it, whichever answers first", () => {
    for (const isMoreFirst of [true, false]) {
      const reads: NotesReads = new NotesReads();
      answerInOrder(reads, [reads.start("top")]);

      const background: NotesRead = reads.start("background");
      const more: NotesRead = reads.start("more");

      // Its notes were the ones on screen before Load more's page.
      expect(
        answerInOrder(
          reads,
          isMoreFirst ? [more, background] : [background, more],
        ),
      ).toEqual([more.token]);
    }
  });

  test("gives way to a read from the top started after it, and to the notes it was read for being replaced", () => {
    const reads: NotesReads = new NotesReads();
    answerInOrder(reads, [reads.start("top")]);

    const background: NotesRead = reads.start("background");
    const sort: NotesRead = reads.start("top");

    expect(answerInOrder(reads, [sort, background])).toEqual([sort.token]);
  });

  test("drawn, it puts the notes on screen: a Load more read before it is dropped", () => {
    const reads: NotesReads = new NotesReads();
    answerInOrder(reads, [reads.start("top")]);

    const more: NotesRead = reads.start("more");
    const background: NotesRead = reads.start("background");

    // The background read is the latest: drawn, it replaces the notes.
    expect(answerInOrder(reads, [background, more])).toEqual([
      background.token,
    ]);
  });
});

describe("Load more, read after read", () => {
  test("each page goes on from the notes the last one left", () => {
    const reads: NotesReads = new NotesReads();
    answerInOrder(reads, [reads.start("top")]);

    const second: NotesRead = reads.start("more");
    expect(answerInOrder(reads, [second])).toEqual([second.token]);

    const third: NotesRead = reads.start("more");
    expect(answerInOrder(reads, [third])).toEqual([third.token]);
  });

  test("after the notes were replaced, a page read for the old ones is dropped, and the next goes on from the new", () => {
    const reads: NotesReads = new NotesReads();
    answerInOrder(reads, [reads.start("top")]);

    const sort: NotesRead = reads.start("top");
    const staleMore: NotesRead = reads.start("more");

    expect(answerInOrder(reads, [sort, staleMore])).toEqual([sort.token]);

    const more: NotesRead = reads.start("more");
    expect(answerInOrder(reads, [more])).toEqual([more.token]);
  });

  test("a failed page is a failure of the notes on screen: it counts while it would have been drawn", () => {
    const reads: NotesReads = new NotesReads();
    answerInOrder(reads, [reads.start("top")]);

    const more: NotesRead = reads.start("more");

    // The failure's banner is shown (isCurrent), and nothing is drawn.
    expect(reads.isCurrent(more)).toBe(true);
    expect(reads.isLatestOfItsKind(more)).toBe(true);

    const retry: NotesRead = reads.start("more");
    expect(reads.isCurrent(more)).toBe(false);
    expect(answerInOrder(reads, [retry])).toEqual([retry.token]);
  });
});
