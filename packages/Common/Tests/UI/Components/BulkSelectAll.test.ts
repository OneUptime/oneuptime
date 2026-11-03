import { describe, expect, test } from "@jest/globals";
import {
  BULK_ACROSS_PAGES_QUESTION,
  BULK_SELECT_ALL_LIMIT,
  BULK_SELECT_ALL_MATCHING,
  BULK_SELECT_ALL_PAGE_SIZE,
  BULK_SELECT_FIRST_MATCHING,
  BULK_SELECTING_MATCHING,
  EveryMatch,
  MatchingPage,
  SelectAllMatchingOffer,
  SelectAllMatchingOfferKind,
  askBeforeActingAcrossPages,
  getSelectAllMatchingOffer,
  getSelectAllMatchingWords,
  readEveryMatch,
} from "../../../UI/Components/BulkUpdate/BulkSelectAll";
import { BULK_SELECT_ALL_PAGE_SIZE as TABLE_SELECT_ALL_PAGE_SIZE } from "../../../UI/Components/ModelTable/BaseModelTable";
import { BulkActionButtonSchema } from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * SELECTING EVERY ROW THAT MATCHES, NOT ONLY THE PAGE'S (BulkSelectAll).
 *
 * "Select every matching exception across pages, not just the page shown:
 * the list has no read-all path yet" - the maintainer's follow-up to #5344.
 * A table's Select All already read every match, a page at a time, up to a
 * ceiling; that read is now one shared function a telemetry list uses too,
 * and the list's header line offers it in the reader's words - how many,
 * and past the ceiling that it takes the first of them - before anything
 * is read. Over rows the page does not show, a quick move asks first.
 */

interface Row {
  _id: string;
  name: string;
}

function rows(count: number, from: number = 0): Array<Row> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    const n: number = from + index + 1;

    return {
      _id: `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      name: `Row ${n}`,
    };
  });
}

interface Server {
  readPage: (page: {
    skip: number;
    limit: number;
  }) => Promise<MatchingPage<Row>>;
  asked: Array<{ skip: number; limit: number }>;
}

/*
 * A list read the way the list endpoint answers: `count` of the whole match
 * (or none, with hasMore instead), and the rows after `skip`.
 */
function server(data: {
  all: Array<Row>;
  counts?: boolean;
  // Answer hasMore instead of a count (the analytics list endpoints).
  answersHasMore?: boolean;
  // Rows each read hands back again, as a table still receiving writes does.
  repeatOnEveryPage?: Row | undefined;
}): Server {
  const asked: Array<{ skip: number; limit: number }> = [];

  return {
    asked: asked,
    readPage: async (page: {
      skip: number;
      limit: number;
    }): Promise<MatchingPage<Row>> => {
      asked.push({ ...page });

      const slice: Array<Row> = data.all.slice(
        page.skip,
        page.skip + page.limit,
      );

      if (data.repeatOnEveryPage && page.skip > 0 && slice.length > 0) {
        slice[0] = data.repeatOnEveryPage;
      }

      return {
        data: slice,
        count: data.counts === false ? undefined : data.all.length,
        hasMore: data.answersHasMore
          ? page.skip + page.limit < data.all.length
          : undefined,
      };
    },
  };
}

const getId: (row: Row) => string = (row: Row): string => {
  return row._id;
};

describe("readEveryMatch", () => {
  test("reads every row that matches, a page at a time, each once and in order", async () => {
    const all: Array<Row> = rows(2500);
    const list: Server = server({ all: all });

    const match: EveryMatch<Row> | null = await readEveryMatch<Row>({
      readPage: list.readPage,
      getItemId: getId,
    });

    expect(match).not.toBeNull();
    expect(match!.items).toEqual(all);
    expect(match!.totalCount).toBe(2500);
    expect(match!.isTruncated).toBe(false);
    expect(list.asked).toEqual([
      { skip: 0, limit: BULK_SELECT_ALL_PAGE_SIZE },
      { skip: 1000, limit: BULK_SELECT_ALL_PAGE_SIZE },
      { skip: 2000, limit: BULK_SELECT_ALL_PAGE_SIZE },
    ]);
  });

  test("pages a thousand at a time, the table's page size, up to a project's list ceiling", () => {
    expect(BULK_SELECT_ALL_PAGE_SIZE).toBe(1000);
    // One size for a table's Select All and a list's "Select all".
    expect(TABLE_SELECT_ALL_PAGE_SIZE).toBe(BULK_SELECT_ALL_PAGE_SIZE);
    expect(BULK_SELECT_ALL_LIMIT).toBe(LIMIT_PER_PROJECT);
  });

  test("stops at the ceiling, and says more matched than it holds", async () => {
    const list: Server = server({ all: rows(30) });

    const match: EveryMatch<Row> | null = await readEveryMatch<Row>({
      readPage: list.readPage,
      getItemId: getId,
      limit: 25,
      pageSize: 10,
    });

    expect(match!.items).toEqual(rows(25));
    expect(match!.totalCount).toBe(30);
    expect(match!.isTruncated).toBe(true);
    // The last read asks only for what the ceiling leaves room for.
    expect(list.asked).toEqual([
      { skip: 0, limit: 10 },
      { skip: 10, limit: 10 },
      { skip: 20, limit: 5 },
    ]);
  });

  test("a match exactly at the ceiling is whole, not cut short", async () => {
    const list: Server = server({ all: rows(20) });

    const match: EveryMatch<Row> | null = await readEveryMatch<Row>({
      readPage: list.readPage,
      getItemId: getId,
      limit: 20,
      pageSize: 10,
    });

    expect(match!.items).toHaveLength(20);
    expect(match!.isTruncated).toBe(false);
  });

  test("a short page is the last page", async () => {
    const list: Server = server({ all: rows(15) });

    await readEveryMatch<Row>({
      readPage: list.readPage,
      getItemId: getId,
      pageSize: 10,
    });

    expect(list.asked).toEqual([
      { skip: 0, limit: 10 },
      { skip: 10, limit: 10 },
    ]);
  });

  test("a match that is an exact multiple of the page costs no empty read", async () => {
    const list: Server = server({ all: rows(20) });

    const match: EveryMatch<Row> | null = await readEveryMatch<Row>({
      readPage: list.readPage,
      getItemId: getId,
      pageSize: 10,
    });

    expect(match!.items).toHaveLength(20);
    expect(list.asked).toHaveLength(2);
  });

  test("a read that counts nothing stops when it says no more rows follow", async () => {
    const list: Server = server({
      all: rows(20),
      counts: false,
      answersHasMore: true,
    });

    const match: EveryMatch<Row> | null = await readEveryMatch<Row>({
      readPage: list.readPage,
      getItemId: getId,
      pageSize: 10,
    });

    expect(match!.items).toHaveLength(20);
    expect(match!.totalCount).toBe(20);
    expect(match!.isTruncated).toBe(false);
    expect(list.asked).toHaveLength(2);
  });

  test("a read that counts nothing and still has more at the ceiling is cut short", async () => {
    const list: Server = server({
      all: rows(40),
      counts: false,
      answersHasMore: true,
    });

    const match: EveryMatch<Row> | null = await readEveryMatch<Row>({
      readPage: list.readPage,
      getItemId: getId,
      limit: 20,
      pageSize: 10,
    });

    expect(match!.items).toHaveLength(20);
    expect(match!.isTruncated).toBe(true);
  });

  test("a row a later page hands back again is selected once", async () => {
    const all: Array<Row> = rows(25);
    const list: Server = server({ all: all, repeatOnEveryPage: all[0] });

    const match: EveryMatch<Row> | null = await readEveryMatch<Row>({
      readPage: list.readPage,
      getItemId: getId,
      pageSize: 10,
    });

    const ids: Array<string> = match!.items.map(getId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      ids.filter((id: string): boolean => {
        return id === all[0]!._id;
      }),
    ).toHaveLength(1);
    // Never fewer than were read: the count is at least what is selected.
    expect(match!.totalCount).toBeGreaterThanOrEqual(match!.items.length);
  });

  test("a row with no id is still selected, never mistaken for another", async () => {
    const all: Array<Row> = [
      { _id: "", name: "No id yet" },
      { _id: "", name: "Nor this one" },
      ...rows(2),
    ];
    const list: Server = server({ all: all });

    const match: EveryMatch<Row> | null = await readEveryMatch<Row>({
      readPage: list.readPage,
      getItemId: getId,
    });

    expect(match!.items).toEqual(all);
  });

  test("an empty match selects nothing and asks once", async () => {
    const list: Server = server({ all: [] });

    const match: EveryMatch<Row> | null = await readEveryMatch<Row>({
      readPage: list.readPage,
      getItemId: getId,
    });

    expect(match).toEqual({ items: [], totalCount: 0, isTruncated: false });
    expect(list.asked).toHaveLength(1);
  });

  test("a superseded read stops after the read in flight, and answers null", async () => {
    const list: Server = server({ all: rows(30) });
    let isSuperseded: boolean = false;

    const match: EveryMatch<Row> | null = await readEveryMatch<Row>({
      readPage: async (page: {
        skip: number;
        limit: number;
      }): Promise<MatchingPage<Row>> => {
        const answer: MatchingPage<Row> = await list.readPage(page);
        // The person cleared the selection while the first page was read.
        isSuperseded = true;
        return answer;
      },
      getItemId: getId,
      pageSize: 10,
      isSuperseded: (): boolean => {
        return isSuperseded;
      },
    });

    expect(match).toBeNull();
    expect(list.asked).toHaveLength(1);
  });

  test("a read that fails throws, and nothing is selected", async () => {
    let reads: number = 0;

    await expect(
      readEveryMatch<Row>({
        readPage: async (): Promise<MatchingPage<Row>> => {
          reads++;

          if (reads === 2) {
            throw new Error("The statement timed out.");
          }

          return { data: rows(10), count: 30 };
        },
        getItemId: getId,
        pageSize: 10,
      }),
    ).rejects.toThrow("The statement timed out.");
  });
});

describe("getSelectAllMatchingOffer", () => {
  test("offers every match once the whole page is ticked and more rows match", () => {
    expect(
      getSelectAllMatchingOffer({
        selectedCount: 25,
        isPageSelected: true,
        isEveryMatchSelected: false,
        matchingCount: 4213,
      }),
    ).toEqual({ kind: SelectAllMatchingOfferKind.All, count: 4213 });
  });

  test.each([
    ["nothing is ticked", 0, true, false, 4213],
    ["only some of the page is ticked", 3, false, false, 4213],
    ["every match is selected already", 4213, true, true, 4213],
    ["the page is all there is", 25, true, false, 25],
    ["fewer match than are ticked now", 25, true, false, 20],
  ])(
    "offers nothing when %s",
    (
      _reason: string,
      selectedCount: number,
      isPageSelected: boolean,
      isEveryMatchSelected: boolean,
      matchingCount: number,
    ) => {
      expect(
        getSelectAllMatchingOffer({
          selectedCount: selectedCount,
          isPageSelected: isPageSelected,
          isEveryMatchSelected: isEveryMatchSelected,
          matchingCount: matchingCount,
        }).kind,
      ).toBe(SelectAllMatchingOfferKind.None);
    },
  );

  test("past the ceiling, offers the first of them and says how many that is", () => {
    expect(
      getSelectAllMatchingOffer({
        selectedCount: 50,
        isPageSelected: true,
        isEveryMatchSelected: false,
        matchingCount: 12345,
      }),
    ).toEqual({
      kind: SelectAllMatchingOfferKind.First,
      count: 12345,
      limit: LIMIT_PER_PROJECT,
    });

    expect(
      getSelectAllMatchingOffer({
        selectedCount: 50,
        isPageSelected: true,
        isEveryMatchSelected: false,
        matchingCount: LIMIT_PER_PROJECT,
      }).kind,
    ).toBe(SelectAllMatchingOfferKind.All);
  });

  test("a list that only knows more rows follow offers them without a number", () => {
    expect(
      getSelectAllMatchingOffer({
        selectedCount: 50,
        isPageSelected: true,
        isEveryMatchSelected: false,
        hasMore: true,
      }).kind,
    ).toBe(SelectAllMatchingOfferKind.Unknown);

    expect(
      getSelectAllMatchingOffer({
        selectedCount: 50,
        isPageSelected: true,
        isEveryMatchSelected: false,
        hasMore: false,
      }).kind,
    ).toBe(SelectAllMatchingOfferKind.None);

    // Nothing said to follow: nothing offered.
    expect(
      getSelectAllMatchingOffer({
        selectedCount: 50,
        isPageSelected: true,
        isEveryMatchSelected: false,
      }).kind,
    ).toBe(SelectAllMatchingOfferKind.None);
  });
});

describe("the offer's words", () => {
  const english: Translator = createTranslator(undefined, "en");

  const wordsFor: (
    offer: SelectAllMatchingOffer,
    translator?: Translator,
  ) => string | undefined = (
    offer: SelectAllMatchingOffer,
    translator: Translator = english,
  ): string | undefined => {
    return getSelectAllMatchingWords({
      offer: offer,
      translator: translator,
      singularLabel: "Exception",
      pluralLabel: "Exceptions",
    });
  };

  test("say how many, in the list's own noun, before anything is read", () => {
    expect(
      wordsFor({ kind: SelectAllMatchingOfferKind.All, count: 4213 }),
    ).toBe("Select all 4,213 exceptions");
  });

  test("say the ceiling before anything is read, when more match than one selection holds", () => {
    expect(
      wordsFor({
        kind: SelectAllMatchingOfferKind.First,
        count: 12345,
        limit: 10000,
      }),
    ).toBe("Select the first 10,000 of 12,345 exceptions");
  });

  test("without a count, are a table's own Select All", () => {
    expect(wordsFor({ kind: SelectAllMatchingOfferKind.Unknown })).toBe(
      "Select All Exceptions",
    );
    expect(wordsFor({ kind: SelectAllMatchingOfferKind.None })).toBeUndefined();
  });

  /*
   * While it reads them the offer says so, naming how many it is reading -
   * not "Select all 4,213 exceptions" beside a spinner, which reads as a
   * button still to press.
   */
  describe("while it reads them", () => {
    const busyWordsFor: (
      offer: SelectAllMatchingOffer,
      translator?: Translator,
    ) => string | undefined = (
      offer: SelectAllMatchingOffer,
      translator: Translator = english,
    ): string | undefined => {
      return getSelectAllMatchingWords({
        offer: offer,
        translator: translator,
        singularLabel: "Exception",
        pluralLabel: "Exceptions",
        isSelecting: true,
      });
    };

    test("say they are selecting every match, and how many", () => {
      expect(
        busyWordsFor({ kind: SelectAllMatchingOfferKind.All, count: 4213 }),
      ).toBe("Selecting 4,213 exceptions…");
      expect(BULK_SELECTING_MATCHING).toEqual({
        one: "Selecting {{count}} {{itemName}}…",
        other: "Selecting {{count}} {{itemsName}}…",
      });
    });

    test("past the ceiling, name the first of them they are reading, not the whole match", () => {
      expect(
        busyWordsFor({
          kind: SelectAllMatchingOfferKind.First,
          count: 12345,
          limit: 10000,
        }),
      ).toBe("Selecting 10,000 exceptions…");
    });

    test("without a count, are a table's own words while its Select All reads", () => {
      expect(busyWordsFor({ kind: SelectAllMatchingOfferKind.Unknown })).toBe(
        "Selecting All Exceptions...",
      );
      expect(
        busyWordsFor({ kind: SelectAllMatchingOfferKind.None }),
      ).toBeUndefined();
    });

    test("read in the reader's language, the numbers in the reader's way", () => {
      const german: Record<string, string> = {
        [BULK_SELECTING_MATCHING.other]:
          "{{count}} {{itemsName}} werden ausgewählt…",
        Exceptions: "Ausnahmen",
      };
      const translator: Translator = createTranslator(
        (key: string): string | undefined => {
          return german[key];
        },
        "de",
      );

      expect(
        busyWordsFor(
          { kind: SelectAllMatchingOfferKind.All, count: 4213 },
          translator,
        ),
      ).toBe("4.213 Ausnahmen werden ausgewählt…");
    });
  });

  test("read in the reader's language, the numbers in the reader's way", () => {
    const german: Record<string, string> = {
      [BULK_SELECT_ALL_MATCHING.other]:
        "Alle {{count}} {{itemsName}} auswählen",
      [`${BULK_SELECT_ALL_MATCHING.other}_one`]:
        "{{count}} {{itemName}} auswählen",
      [BULK_SELECT_FIRST_MATCHING.other]:
        "Die ersten {{limit}} von {{count}} {{itemsName}} auswählen",
      [`${BULK_SELECT_FIRST_MATCHING.other}_one`]:
        "Die ersten {{limit}} von {{count}} {{itemName}} auswählen",
      Exceptions: "Ausnahmen",
      Exception: "Ausnahme",
    };
    const translator: Translator = createTranslator(
      (key: string): string | undefined => {
        return german[key];
      },
      "de",
    );

    expect(
      wordsFor(
        { kind: SelectAllMatchingOfferKind.All, count: 4213 },
        translator,
      ),
    ).toBe("Alle 4.213 Ausnahmen auswählen");
    expect(
      wordsFor(
        { kind: SelectAllMatchingOfferKind.First, count: 12345, limit: 10000 },
        translator,
      ),
    ).toBe("Die ersten 10.000 von 12.345 Ausnahmen auswählen");
  });
});

describe("askBeforeActingAcrossPages", () => {
  const english: Translator = createTranslator(undefined, "en");

  const resolve: BulkActionButtonSchema<Row> = {
    title: "Resolve",
    icon: IconProp.Check,
    buttonStyleType: ButtonStyleType.NORMAL,
    onClick: async (): Promise<void> => {},
  };

  test("a quick move asks first over every match, with its own words and the count", () => {
    const asking: BulkActionButtonSchema<Row> = askBeforeActingAcrossPages(
      resolve,
      {
        translator: english,
        singularLabel: "Exception",
        pluralLabel: "Exceptions",
      },
    );

    expect(asking.confirmTitle?.(rows(4213))).toBe("Resolve");
    expect(asking.confirmMessage?.(rows(4213))).toBe(
      "This changes all 4,213 selected exceptions, including those on other pages.",
    );
    // Everything else is the action's own: the same move, the same menu item.
    expect(asking.title).toBe(resolve.title);
    expect(asking.icon).toBe(resolve.icon);
    expect(asking.onClick).toBe(resolve.onClick);
    // The action itself is left as it was, for the page's own selections.
    expect(resolve.confirmMessage).toBeUndefined();
  });

  test("an action that names itself with a count is titled with it: what it does, and to how many", () => {
    const asking: BulkActionButtonSchema<Row> = askBeforeActingAcrossPages(
      {
        ...resolve,
        titleWithCount: {
          one: "Resolve {{count}} {{itemName}}",
          other: "Resolve {{count}} {{itemsName}}",
        },
      },
      {
        translator: english,
        singularLabel: "Exception",
        pluralLabel: "Exceptions",
      },
    );

    // A title's capitals, as a selection's Resolve on an incidents list.
    expect(asking.confirmTitle?.(rows(4213))).toBe("Resolve 4,213 Exceptions");
    expect(asking.confirmTitle?.(rows(1))).toBe("Resolve 1 Exception");
    // The sentence under it, and the button, are as before.
    expect(asking.confirmMessage?.(rows(4213))).toBe(
      "This changes all 4,213 selected exceptions, including those on other pages.",
    );
    expect(asking.title).toBe("Resolve");
  });

  test("the counted title is the reader's language's, numbers in the reader's way", () => {
    const translator: Translator = createTranslator(
      (key: string): string | undefined => {
        return (
          {
            "Resolve {{count}} {{itemsName}}":
              "{{count}} {{itemsName}} beheben",
            Exceptions: "Ausnahmen",
          } as Record<string, string>
        )[key];
      },
      "de",
    );

    const asking: BulkActionButtonSchema<Row> = askBeforeActingAcrossPages(
      {
        ...resolve,
        titleWithCount: {
          one: "Resolve {{count}} {{itemName}}",
          other: "Resolve {{count}} {{itemsName}}",
        },
      },
      {
        translator: translator,
        singularLabel: "Exception",
        pluralLabel: "Exceptions",
      },
    );

    expect(asking.confirmTitle?.(rows(1500))).toBe("1.500 Ausnahmen beheben");
  });

  test("an action that asks its own question asks that, and one with a dialog of its own opens it", () => {
    const asks: BulkActionButtonSchema<Row> = {
      ...resolve,
      title: "Delete",
      confirmMessage: (): string => {
        return "Are you sure you want to delete these?";
      },
    };
    const dialog: BulkActionButtonSchema<Row> = {
      ...resolve,
      title: "Assign to…",
      opensItsOwnDialog: true,
    };

    for (const button of [asks, dialog]) {
      expect(
        askBeforeActingAcrossPages(button, {
          translator: english,
          singularLabel: "Exception",
          pluralLabel: "Exceptions",
        }),
      ).toBe(button);
    }
  });

  test("the question is a whole sentence the reader's language words", () => {
    const translator: Translator = createTranslator(
      (key: string): string | undefined => {
        return (
          {
            [BULK_ACROSS_PAGES_QUESTION.other]:
              "Dies ändert alle {{count}} ausgewählten {{itemsName}}, auch die auf anderen Seiten.",
            Resolve: "Auflösen",
            Exceptions: "Ausnahmen",
          } as Record<string, string>
        )[key];
      },
      "de",
    );

    const asking: BulkActionButtonSchema<Row> = askBeforeActingAcrossPages(
      resolve,
      {
        translator: translator,
        singularLabel: "Exception",
        pluralLabel: "Exceptions",
      },
    );

    expect(asking.confirmTitle?.(rows(1500))).toBe("Auflösen");
    expect(asking.confirmMessage?.(rows(1500))).toBe(
      "Dies ändert alle 1.500 ausgewählten Ausnahmen, auch die auf anderen Seiten.",
    );
  });
});
