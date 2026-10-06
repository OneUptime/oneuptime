import PromiseCache from "../../../Server/Utils/PromiseCache";
import { describe, expect, test } from "@jest/globals";

/*
 * PromiseCache.lookUpOnce: one lookup per key, shared by reads made at the
 * same time and kept for as long as the cache; a failed lookup is
 * forgotten so the next read asks again.
 */
describe("PromiseCache.lookUpOnce", () => {
  test("reads made at the same time share one lookup", async () => {
    const cache: Map<string, Promise<number>> = new Map();
    let lookUps: number = 0;
    const lookUp: () => Promise<number> = async (): Promise<number> => {
      lookUps++;
      return 7;
    };

    const answers: Array<number> = await Promise.all([
      PromiseCache.lookUpOnce(cache, "key", lookUp),
      PromiseCache.lookUpOnce(cache, "key", lookUp),
      PromiseCache.lookUpOnce(cache, "key", lookUp),
    ]);

    expect(answers).toEqual([7, 7, 7]);
    expect(lookUps).toBe(1);
  });

  test("keeps the answer for later reads, per key", async () => {
    const cache: Map<string, Promise<string>> = new Map();
    const asked: Array<string> = [];
    const lookUpFor: (key: string) => () => Promise<string> = (
      key: string,
    ): (() => Promise<string>) => {
      return async (): Promise<string> => {
        asked.push(key);
        return key.toUpperCase();
      };
    };

    expect(await PromiseCache.lookUpOnce(cache, "a", lookUpFor("a"))).toBe("A");
    expect(await PromiseCache.lookUpOnce(cache, "a", lookUpFor("a"))).toBe("A");
    expect(await PromiseCache.lookUpOnce(cache, "b", lookUpFor("b"))).toBe("B");
    expect(asked).toEqual(["a", "b"]);
  });

  test("forgets a lookup that fails, so the next read asks again", async () => {
    const cache: Map<string, Promise<number>> = new Map();
    let lookUps: number = 0;
    const lookUp: () => Promise<number> = async (): Promise<number> => {
      lookUps++;
      if (lookUps === 1) {
        throw new Error("unavailable");
      }
      return 3;
    };

    await expect(PromiseCache.lookUpOnce(cache, "key", lookUp)).rejects.toThrow(
      "unavailable",
    );
    expect(cache.has("key")).toBe(false);

    expect(await PromiseCache.lookUpOnce(cache, "key", lookUp)).toBe(3);
    expect(lookUps).toBe(2);
  });

  test("turns a lookup that throws before it awaits into a rejection it forgets", async () => {
    const cache: Map<string, Promise<number>> = new Map();
    const lookUp: () => Promise<number> = (): Promise<number> => {
      throw new Error("refused");
    };

    await expect(PromiseCache.lookUpOnce(cache, "key", lookUp)).rejects.toThrow(
      "refused",
    );
    expect(cache.has("key")).toBe(false);
  });

  test("keys a WeakMap by an object, for as long as the object lives", async () => {
    const record: { id: string } = { id: "application" };
    const cache: WeakMap<
      { id: string },
      Promise<Array<string>>
    > = new WeakMap();
    let lookUps: number = 0;
    const lookUp: () => Promise<Array<string>> = async (): Promise<
      Array<string>
    > => {
      lookUps++;
      return ["owner"];
    };

    expect(await PromiseCache.lookUpOnce(cache, record, lookUp)).toEqual([
      "owner",
    ]);
    expect(await PromiseCache.lookUpOnce(cache, record, lookUp)).toEqual([
      "owner",
    ]);
    expect(lookUps).toBe(1);

    // Another object is another key.
    await PromiseCache.lookUpOnce(cache, { id: "application" }, lookUp);
    expect(lookUps).toBe(2);
  });
});
