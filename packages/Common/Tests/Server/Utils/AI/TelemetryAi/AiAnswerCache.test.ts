import { afterEach, describe, expect, jest, test } from "@jest/globals";
import AiAnswerCache from "../../../../../Server/Utils/AI/TelemetryAi/AiAnswerCache";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * The kept AI answers: keyed by exactly what an answer is written from, and
 * best effort - a cache that is down reads as nothing kept, and a write
 * that fails is not an error of the ask.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AiAnswerCache", () => {
  test("the same inputs make the same key; any change makes another", () => {
    const key: string = AiAnswerCache.key(["project", "a|5", "b|2"]);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(AiAnswerCache.key(["project", "a|5", "b|2"])).toBe(key);
    expect(AiAnswerCache.key(["project", "a|6", "b|2"])).not.toBe(key);
    expect(AiAnswerCache.key(["project", "b|2", "a|5"])).not.toBe(key);
    // Parts are kept apart: "a" + "b|2" is not "a|b" + "2".
    expect(AiAnswerCache.key(["a", "b|2"])).not.toBe(
      AiAnswerCache.key(["a|b", "2"]),
    );
  });

  test("reads and writes through the global cache, with the time it is kept", async () => {
    const written: Array<{ key: string; value: JSONObject; seconds: unknown }> =
      [];
    jest.spyOn(GlobalCache, "setJSON").mockImplementation((async (
      _namespace: string,
      key: string,
      value: JSONObject,
      options: { expiresInSeconds?: number },
    ) => {
      written.push({ key, value, seconds: options?.expiresInSeconds });
    }) as never);
    jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockResolvedValue({ answer: "kept" } as never);

    await AiAnswerCache.set({
      namespace: "n",
      key: "k",
      value: { answer: "kept" },
      expiresInSeconds: 60,
    });

    expect(written).toEqual([
      { key: "k", value: { answer: "kept" }, seconds: 60 },
    ]);
    expect(await AiAnswerCache.get("n", "k")).toEqual({ answer: "kept" });
  });

  test("a cache that is down is nothing kept, and never an error", async () => {
    jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockRejectedValue(new Error("Cache is not connected") as never);
    jest
      .spyOn(GlobalCache, "setJSON")
      .mockRejectedValue(new Error("Cache is not connected") as never);

    expect(await AiAnswerCache.get("n", "k")).toBe(null);
    await expect(
      AiAnswerCache.set({
        namespace: "n",
        key: "k",
        value: {},
        expiresInSeconds: 60,
      }),
    ).resolves.toBeUndefined();
  });
});
