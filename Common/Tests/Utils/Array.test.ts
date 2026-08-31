import ArrayUtil from "../../Utils/Array";
import ObjectID from "../../Types/ObjectID";
import Sleep from "../../Types/Sleep";

describe("ArrayUtil", () => {
  describe("removeDuplicates", () => {
    it("keeps the first occurrence of each value in order", () => {
      expect(ArrayUtil.removeDuplicates([1, 2, 2, 3, 1])).toEqual([1, 2, 3]);
    });

    it("returns an empty array unchanged", () => {
      expect(ArrayUtil.removeDuplicates([])).toEqual([]);
    });

    it("de-duplicates strings", () => {
      expect(ArrayUtil.removeDuplicates(["a", "b", "a"])).toEqual(["a", "b"]);
    });
  });

  describe("mergeStringArrays", () => {
    it("concatenates and removes duplicates", () => {
      expect(ArrayUtil.mergeStringArrays(["a", "b"], ["b", "c"])).toEqual([
        "a",
        "b",
        "c",
      ]);
    });

    it("handles empty inputs on either side", () => {
      expect(ArrayUtil.mergeStringArrays([], ["x"])).toEqual(["x"]);
      expect(ArrayUtil.mergeStringArrays(["x"], [])).toEqual(["x"]);
    });
  });

  describe("isEqual / isStringArrayEqual", () => {
    it("is true for arrays with the same members regardless of order", () => {
      expect(ArrayUtil.isEqual([1, 2, 3], [3, 2, 1])).toBe(true);
      expect(ArrayUtil.isStringArrayEqual(["a", "b"], ["b", "a"])).toBe(true);
    });

    it("is false for different lengths", () => {
      expect(ArrayUtil.isEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    it("is false for different members", () => {
      expect(ArrayUtil.isEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    });

    it("is true for two empty arrays", () => {
      expect(ArrayUtil.isEqual([], [])).toBe(true);
    });
  });

  describe("shuffle", () => {
    it("returns a new array with the same members", () => {
      const input: Array<number> = [1, 2, 3, 4, 5];
      const shuffled: Array<number> = ArrayUtil.shuffle(input);
      expect(shuffled).not.toBe(input);
      expect([...shuffled].sort()).toEqual([...input].sort());
    });

    it("does not mutate the input array", () => {
      const input: Array<number> = [1, 2, 3];
      const copy: Array<number> = [...input];
      ArrayUtil.shuffle(input);
      expect(input).toEqual(copy);
    });

    it("handles empty and single-element arrays", () => {
      expect(ArrayUtil.shuffle([])).toEqual([]);
      expect(ArrayUtil.shuffle([9])).toEqual([9]);
    });
  });

  describe("removeDuplicatesFromObjectIDArray", () => {
    it("de-duplicates by string value", () => {
      const id1: ObjectID = new ObjectID(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      );
      const id1Dup: ObjectID = new ObjectID(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      );
      const id2: ObjectID = new ObjectID(
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      );

      const result: Array<ObjectID> =
        ArrayUtil.removeDuplicatesFromObjectIDArray([id1, id1Dup, id2]);

      expect(result).toHaveLength(2);
      expect(
        result.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([id1.toString(), id2.toString()]);
    });

    it("returns an empty array unchanged", () => {
      expect(ArrayUtil.removeDuplicatesFromObjectIDArray([])).toEqual([]);
    });
  });

  describe("sortByFieldName", () => {
    it("sorts objects ascending by the given field", () => {
      const rows: Array<{ name: string; age: number }> = [
        { name: "c", age: 3 },
        { name: "a", age: 1 },
        { name: "b", age: 2 },
      ];
      rows.sort(ArrayUtil.sortByFieldName("age"));
      expect(
        rows.map((r: { name: string }) => {
          return r.name;
        }),
      ).toEqual(["a", "b", "c"]);
    });

    it("returns 0 for equal field values", () => {
      const comparator: (a: any, b: any) => number =
        ArrayUtil.sortByFieldName("age");
      expect(comparator({ age: 5 }, { age: 5 })).toBe(0);
    });
  });

  describe("selectItemByRandom", () => {
    it("returns a member of the array", () => {
      const arr: Array<string> = ["x", "y", "z"];
      for (let i: number = 0; i < 100; i++) {
        expect(arr).toContain(ArrayUtil.selectItemByRandom(arr));
      }
    });

    it("returns the only element of a single-element array", () => {
      expect(ArrayUtil.selectItemByRandom(["only"])).toBe("only");
    });
  });

  describe("distinctByFieldName", () => {
    it("keeps the first object for each distinct field value", () => {
      const rows: Array<{ group: string; id: number }> = [
        { group: "a", id: 1 },
        { group: "b", id: 2 },
        { group: "a", id: 3 },
      ];
      const result: Array<{ group: string; id: number }> =
        ArrayUtil.distinctByFieldName(rows, "group");
      expect(result).toEqual([
        { group: "a", id: 1 },
        { group: "b", id: 2 },
      ]);
    });

    it("returns an empty array unchanged", () => {
      expect(ArrayUtil.distinctByFieldName([], "group")).toEqual([]);
    });
  });
  describe("forEachWithConcurrency", () => {
    it("runs every item exactly once", async () => {
      const items: Array<number> = [1, 2, 3, 4, 5, 6, 7];
      const seen: Array<number> = [];

      await ArrayUtil.forEachWithConcurrency(
        items,
        3,
        async (item: number): Promise<void> => {
          seen.push(item);
        },
      );

      expect(seen.sort()).toEqual(items);
    });

    it("never exceeds the requested concurrency", async () => {
      let inFlight: number = 0;
      let peak: number = 0;

      await ArrayUtil.forEachWithConcurrency(
        Array.from({ length: 30 }, (_v: unknown, i: number) => {
          return i;
        }),
        4,
        async (): Promise<void> => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await Sleep.sleep(1);
          inFlight--;
        },
      );

      expect(peak).toBeLessThanOrEqual(4);
    });

    it("actually overlaps work rather than awaiting one at a time", async () => {
      let inFlight: number = 0;
      let peak: number = 0;

      await ArrayUtil.forEachWithConcurrency(
        Array.from({ length: 10 }, (_v: unknown, i: number) => {
          return i;
        }),
        5,
        async (): Promise<void> => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await Sleep.sleep(5);
          inFlight--;
        },
      );

      expect(peak).toBeGreaterThan(1);
    });

    it("starts items in order, so a caller that sorted by urgency is respected", async () => {
      const started: Array<number> = [];

      await ArrayUtil.forEachWithConcurrency(
        [0, 1, 2, 3, 4, 5],
        2,
        async (item: number): Promise<void> => {
          started.push(item);
          await Sleep.sleep(1);
        },
      );

      expect(started.slice(0, 2)).toEqual([0, 1]);
    });

    it("does no work and does not hang on an empty array", async () => {
      let calls: number = 0;

      await ArrayUtil.forEachWithConcurrency(
        [] as Array<number>,
        5,
        async (): Promise<void> => {
          calls++;
        },
      );

      expect(calls).toBe(0);
    });

    it("treats a concurrency below one as one rather than doing nothing", async () => {
      const seen: Array<number> = [];

      await ArrayUtil.forEachWithConcurrency(
        [1, 2, 3],
        0,
        async (item: number): Promise<void> => {
          seen.push(item);
        },
      );

      expect(seen).toEqual([1, 2, 3]);
    });
  });
});
