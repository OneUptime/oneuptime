import { describe, expect, test } from "@jest/globals";
import BulkReadAhead, {
  BULK_READ_WINDOW_SIZE,
} from "../../../UI/Components/BulkUpdate/BulkReadAhead";

/*
 * READING WHAT A BULK ACTION NEEDS, A WINDOW AT A TIME (issue #5299).
 *
 * A bulk action that read each item before writing it made two requests per
 * item. BulkReadAhead reads a window of items in one request the first time
 * one of them is asked for, shares that request among the window's items,
 * and falls back to one read per item when a window's request fails.
 */

interface Row {
  _id: string;
  name: string;
}

function rows(count: number): Array<Row> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return {
      _id: `d0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `Row ${index + 1}`,
    };
  });
}

interface Reader {
  reader: BulkReadAhead<Row, string>;
  windowsAsked: Array<Array<string>>;
  oneAsked: Array<string>;
}

function makeReader(data: {
  items: Array<Row>;
  windowSize?: number;
  // What the server answers, by id: a value, or nothing (left out).
  answer?: (row: Row) => string | undefined;
  failWindows?: boolean;
  withReadOne?: boolean;
  // The id the server's answer carries for a row: as asked, unless said.
  answerKey?: (row: Row) => string;
}): Reader {
  const windowsAsked: Array<Array<string>> = [];
  const oneAsked: Array<string> = [];
  const answer: (row: Row) => string | undefined =
    data.answer ||
    ((row: Row): string => {
      return `state of ${row.name}`;
    });

  const reader: BulkReadAhead<Row, string> = new BulkReadAhead<Row, string>({
    items: data.items,
    windowSize: data.windowSize,
    getKey: (row: Row): string => {
      return row._id;
    },
    readWindow: async (
      windowItems: Array<Row>,
    ): Promise<Map<string, string>> => {
      windowsAsked.push(
        windowItems.map((row: Row) => {
          return row._id;
        }),
      );

      if (data.failWindows) {
        throw new Error("The list could not be read.");
      }

      const found: Map<string, string> = new Map<string, string>();

      for (const row of windowItems) {
        const value: string | undefined = answer(row);

        if (value !== undefined) {
          found.set(data.answerKey ? data.answerKey(row) : row._id, value);
        }
      }

      return found;
    },
    readOne:
      data.withReadOne === false
        ? undefined
        : async (row: Row): Promise<string | null> => {
            oneAsked.push(row._id);
            return answer(row) ?? null;
          },
  });

  return { reader, windowsAsked, oneAsked };
}

describe("BulkReadAhead", () => {
  test("reads fifty items to a window unless told otherwise", () => {
    expect(BULK_READ_WINDOW_SIZE).toBe(50);
  });

  test("reads a whole window the first time one of its items is asked for, once", async () => {
    const items: Array<Row> = rows(120);
    const r: Reader = makeReader({ items: items });

    expect(await r.reader.read(items[0]!)).toBe("state of Row 1");
    expect(await r.reader.read(items[49]!)).toBe("state of Row 50");
    expect(r.windowsAsked).toHaveLength(1);
    expect(r.windowsAsked[0]).toHaveLength(50);

    // The next window, when its first item is asked about.
    expect(await r.reader.read(items[50]!)).toBe("state of Row 51");
    expect(r.windowsAsked).toHaveLength(2);
    expect(r.windowsAsked[1]![0]).toBe(items[50]!._id);

    // The last window holds what is left.
    expect(await r.reader.read(items[119]!)).toBe("state of Row 120");
    expect(
      r.windowsAsked.map((ids: Array<string>) => {
        return ids.length;
      }),
    ).toEqual([50, 50, 20]);
    expect(r.reader.windowsRead).toBe(3);
    expect(r.oneAsked).toEqual([]);
  });

  test("items of one window asked for at once share its one request", async () => {
    const items: Array<Row> = rows(10);
    const r: Reader = makeReader({ items: items, windowSize: 5 });

    const values: Array<string | null> = await Promise.all(
      items.map((row: Row) => {
        return r.reader.read(row);
      }),
    );

    expect(values).toEqual(
      items.map((row: Row) => {
        return `state of ${row.name}`;
      }),
    );
    expect(r.windowsAsked).toHaveLength(2);
  });

  test("an item the answer leaves out reads as nothing found, without a read of its own", async () => {
    const items: Array<Row> = rows(3);
    const r: Reader = makeReader({
      items: items,
      answer: (row: Row): string | undefined => {
        return row.name === "Row 2" ? undefined : `state of ${row.name}`;
      },
    });

    expect(await r.reader.read(items[1]!)).toBe(null);
    expect(await r.reader.read(items[0]!)).toBe("state of Row 1");
    expect(r.oneAsked).toEqual([]);
  });

  test("a window whose read fails reads each of its items on its own", async () => {
    const items: Array<Row> = rows(4);
    const r: Reader = makeReader({ items: items, failWindows: true });

    const values: Array<string | null> = await Promise.all(
      items.map((row: Row) => {
        return r.reader.read(row);
      }),
    );

    expect(values).toEqual([
      "state of Row 1",
      "state of Row 2",
      "state of Row 3",
      "state of Row 4",
    ]);
    // The failed window is not asked again for each item.
    expect(r.windowsAsked).toHaveLength(1);
    expect(r.oneAsked.sort()).toEqual(
      items
        .map((row: Row) => {
          return row._id;
        })
        .sort(),
    );
  });

  test("without a read of one, a failed window fails its items with the read's error", async () => {
    const items: Array<Row> = rows(2);
    const r: Reader = makeReader({
      items: items,
      failWindows: true,
      withReadOne: false,
    });

    await expect(r.reader.read(items[0]!)).rejects.toThrow(
      "The list could not be read.",
    );
    await expect(r.reader.read(items[1]!)).rejects.toThrow(
      "The list could not be read.",
    );
  });

  test("names each id once in a window, and leaves out an item without one", async () => {
    const items: Array<Row> = rows(3);
    const selection: Array<Row> = [
      items[0]!,
      items[0]!,
      { _id: "", name: "No id" },
      items[1]!,
    ];
    const r: Reader = makeReader({ items: selection });

    expect(await r.reader.read(items[0]!)).toBe("state of Row 1");
    expect(r.windowsAsked).toEqual([[items[0]!._id, items[1]!._id]]);
  });

  test("an item that is not one of the run's own is read alone", async () => {
    const items: Array<Row> = rows(2);
    const stranger: Row = rows(3)[2]!;
    const r: Reader = makeReader({ items: items });

    expect(await r.reader.read(stranger)).toBe("state of Row 3");
    expect(r.windowsAsked).toEqual([]);
    expect(r.oneAsked).toEqual([stranger._id]);
  });

  test("matches ids as Postgres does: by value, whatever their case", async () => {
    const items: Array<Row> = rows(2);
    const shouting: Array<Row> = items.map((row: Row) => {
      return { ...row, _id: row._id.toUpperCase() };
    });

    const r: Reader = makeReader({
      items: shouting,
      // The server answers in lower case.
      answerKey: (row: Row): string => {
        return row._id.toLowerCase();
      },
    });

    expect(await r.reader.read(shouting[1]!)).toBe("state of Row 2");
    expect(r.oneAsked).toEqual([]);
  });

  test.each([0, -4, Number.NaN])(
    "a window size of %p reads one item to a window",
    async (windowSize: number) => {
      const items: Array<Row> = rows(3);
      const r: Reader = makeReader({ items: items, windowSize: windowSize });

      await r.reader.read(items[2]!);

      expect(r.windowsAsked).toEqual([[items[2]!._id]]);
    },
  );
});
