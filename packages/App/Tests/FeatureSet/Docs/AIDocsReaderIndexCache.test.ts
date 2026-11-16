import DocsAIReader, {
  AIDocsLanguageIndex,
  DOCS_INDEX_IDLE_MS,
} from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import { makeDocsIndex } from "./DocsSearchHelpers";
import OneUptimeDate from "Common/Types/Date";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE DOCS INDEX IS BUILT ONCE, AND NEVER WAITED FOR TWICE (issue #6822).
 *
 * Building a language's index reads every page and takes seconds. The docs
 * search box asks as someone types, so: requests that arrive during the
 * first build share it; an index older than ten minutes is still answered
 * from at once while its replacement is built behind it; and a build that
 * fails leaves the old index answering.
 *
 * And it is let go after half an hour with no search in its language
 * (#8818), each language on its own, checked every five minutes without a
 * search to start it: a server asked once in every language no longer
 * keeps all seventeen for as long as it runs.
 */

// jest-mock's spy, as @jest/globals' jest.spyOn returns it.
type BuildSpy = SpyInstance<typeof DocsAIReader.build>;
// The same, of setInterval, as jest.spyOn types it.
type SetIntervalSpy = SpyInstance<
  (
    callback: (...args: Array<any>) => void,
    delay?: number,
    ...args: Array<any>
  ) => NodeJS.Timeout
>;

let now: number = 1_800_000_000_000;
let builds: number = 0;
let buildSpy: BuildSpy;

const TEN_MINUTES: number = 10 * 60 * 1000;

const indexNamed: (name: string) => AIDocsLanguageIndex = (
  name: string,
): AIDocsLanguageIndex => {
  return makeDocsIndex([{ page: `x/${name}`, title: name }]);
};

const settle: () => Promise<void> = async (): Promise<void> => {
  for (let round: number = 0; round < 5; round++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  DocsAIReader.clearCache();
  builds = 0;
  now = 1_800_000_000_000;
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(now);
  });
  buildSpy = jest
    .spyOn(DocsAIReader, "build")
    .mockImplementation(async (): Promise<AIDocsLanguageIndex> => {
      builds++;
      return indexNamed(`build-${builds}`);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  DocsAIReader.clearCache();
});

describe("DocsAIReader.getIndex", () => {
  test("builds a language once, however many ask while it builds", async () => {
    const [first, second, third] = await Promise.all([
      DocsAIReader.getIndex("de"),
      DocsAIReader.getIndex("de"),
      DocsAIReader.getIndex("de"),
    ]);

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(await DocsAIReader.getIndex("de")).toBe(first);
    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  test("builds each language on its own, and reads one the docs do not have as English", async () => {
    await DocsAIReader.getIndex("de");
    await DocsAIReader.getIndex("xx");
    await DocsAIReader.getIndex("en");

    expect(
      buildSpy.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toEqual(["de", "en"]);
  });

  test("answers from an old index at once, and builds the next one behind it", async () => {
    const first: AIDocsLanguageIndex = await DocsAIReader.getIndex("fr");

    now += TEN_MINUTES + 1;
    // Still the old one: nobody waits for the build.
    expect(await DocsAIReader.getIndex("fr")).toBe(first);
    await settle();

    expect(buildSpy).toHaveBeenCalledTimes(2);
    const second: AIDocsLanguageIndex = await DocsAIReader.getIndex("fr");
    expect(second).not.toBe(first);
    expect(second.pages[0]!.title).toBe("build-2");
    expect(buildSpy).toHaveBeenCalledTimes(2);
  });

  test("keeps answering from the old index when building the next one fails", async () => {
    const first: AIDocsLanguageIndex = await DocsAIReader.getIndex("es");

    buildSpy.mockImplementationOnce(async (): Promise<AIDocsLanguageIndex> => {
      throw new Error("the disk went away");
    });
    now += TEN_MINUTES + 1;

    expect(await DocsAIReader.getIndex("es")).toBe(first);
    await settle();
    expect(await DocsAIReader.getIndex("es")).toBe(first);
  });

  test("lets the first request see a first build that fails, and tries again on the next", async () => {
    buildSpy.mockImplementationOnce(async (): Promise<AIDocsLanguageIndex> => {
      throw new Error("not yet");
    });

    await expect(DocsAIReader.getIndex("it")).rejects.toThrow("not yet");
    expect((await DocsAIReader.getIndex("it")).pages.length).toBe(1);
  });
});

describe("DocsAIReader.releaseIdle (#8818)", () => {
  const HALF_AN_HOUR: number = 30 * 60 * 1000;

  test("waits half an hour", () => {
    expect(DOCS_INDEX_IDLE_MS).toBe(HALF_AN_HOUR);
  });

  test("lets a language go after half an hour with no search in it, and builds it again on the next", async () => {
    const first: AIDocsLanguageIndex = await DocsAIReader.getIndex("de");

    now += HALF_AN_HOUR - 1;
    expect(DocsAIReader.releaseIdle()).toEqual([]);
    expect(DocsAIReader.getKeptLanguages()).toEqual(["de"]);

    now += 1;
    expect(DocsAIReader.releaseIdle()).toEqual(["de"]);
    expect(DocsAIReader.getKeptLanguages()).toEqual([]);

    const again: AIDocsLanguageIndex = await DocsAIReader.getIndex("de");
    expect(again).not.toBe(first);
    expect(buildSpy).toHaveBeenCalledTimes(2);
  });

  test("keeps a language searched in within the half hour, however old its index is", async () => {
    await DocsAIReader.getIndex("fr");

    // A search every twenty minutes: the index grows old and is rebuilt behind, but is in use.
    for (let search: number = 0; search < 6; search++) {
      now += 20 * 60 * 1000;
      await DocsAIReader.getIndex("fr");
      await settle();
      expect(DocsAIReader.releaseIdle()).toEqual([]);
    }

    expect(DocsAIReader.getKeptLanguages()).toEqual(["fr"]);
    expect(buildSpy).toHaveBeenCalledTimes(7);
  });

  test("does not count building an index again behind the old one as a search in it", async () => {
    await DocsAIReader.getIndex("es");

    let finishBuild: () => void = (): void => {};
    buildSpy.mockImplementationOnce(async (): Promise<AIDocsLanguageIndex> => {
      builds++;
      await new Promise<void>((resolve: () => void): void => {
        finishBuild = resolve;
      });
      return indexNamed(`build-${builds}`);
    });

    // Searched at ten minutes and a moment: the old index answers, a new one is built...
    now += TEN_MINUTES + 1;
    await DocsAIReader.getIndex("es");
    // ...which takes five minutes.
    now += 5 * 60 * 1000;
    finishBuild();
    await settle();
    expect(buildSpy).toHaveBeenCalledTimes(2);
    expect((await DocsAIReader.getIndex("es")).pages[0]!.title).toBe("build-2");

    // That last look was a search: half an hour after it, not after the build, it goes.
    now += HALF_AN_HOUR - 1;
    expect(DocsAIReader.releaseIdle()).toEqual([]);
    now += 1;
    expect(DocsAIReader.releaseIdle()).toEqual(["es"]);
  });

  test("keeps the time of the last search when the build behind it ends later", async () => {
    await DocsAIReader.getIndex("it");

    let finishBuild: () => void = (): void => {};
    buildSpy.mockImplementationOnce(async (): Promise<AIDocsLanguageIndex> => {
      builds++;
      await new Promise<void>((resolve: () => void): void => {
        finishBuild = resolve;
      });
      return indexNamed(`build-${builds}`);
    });

    now += TEN_MINUTES + 1;
    // The last search in Italian.
    await DocsAIReader.getIndex("it");
    // Its build ends twenty minutes later, with no search since.
    now += 20 * 60 * 1000;
    finishBuild();
    await settle();

    // Half an hour after the search, though ten minutes after the build.
    now += 10 * 60 * 1000;
    expect(DocsAIReader.releaseIdle()).toEqual(["it"]);
  });

  test("lets each language go on its own", async () => {
    await DocsAIReader.getIndex("de");
    now += 20 * 60 * 1000;
    await DocsAIReader.getIndex("ja");
    now += 11 * 60 * 1000;

    expect(DocsAIReader.releaseIdle()).toEqual(["de"]);
    expect(DocsAIReader.getKeptLanguages()).toEqual(["ja"]);

    now += 20 * 60 * 1000;
    expect(DocsAIReader.releaseIdle()).toEqual(["ja"]);
    expect(DocsAIReader.getKeptLanguages()).toEqual([]);
  });

  test("reads a language the docs do not have as English, kept as English", async () => {
    await DocsAIReader.getIndex("xx");

    expect(DocsAIReader.getKeptLanguages()).toEqual(["en"]);
    now += HALF_AN_HOUR;
    expect(DocsAIReader.releaseIdle()).toEqual(["en"]);
  });
});

describe("the check for indexes nobody searches", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("lets them go every five minutes, without a search to start it, and stops once none is kept", async () => {
    jest.useFakeTimers({
      doNotFake: ["nextTick", "queueMicrotask", "performance", "hrtime"],
    });

    await DocsAIReader.getIndex("de");
    await DocsAIReader.getIndex("nl");
    expect(DocsAIReader.getKeptLanguages()).toEqual(["de", "nl"]);
    // One check, however many languages are kept.
    expect(jest.getTimerCount()).toBe(1);

    now += 31 * 60 * 1000;
    jest.advanceTimersByTime(5 * 60 * 1000);

    expect(DocsAIReader.getKeptLanguages()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("starts again with the next index kept", async () => {
    jest.useFakeTimers({
      doNotFake: ["nextTick", "queueMicrotask", "performance", "hrtime"],
    });

    await DocsAIReader.getIndex("sv");
    now += 31 * 60 * 1000;
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(jest.getTimerCount()).toBe(0);

    await DocsAIReader.getIndex("sv");
    expect(jest.getTimerCount()).toBe(1);
    expect(DocsAIReader.getKeptLanguages()).toEqual(["sv"]);
  });

  test("does not keep the process up: the check is unref'd", async () => {
    const setIntervalSpy: SetIntervalSpy = jest.spyOn(global, "setInterval");

    await DocsAIReader.getIndex("pt");

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0]![1]).toBe(5 * 60 * 1000);
    expect(
      (setIntervalSpy.mock.results[0]!.value as NodeJS.Timeout).hasRef(),
    ).toBe(false);
  });

  test("lets go with clearCache too", async () => {
    jest.useFakeTimers({
      doNotFake: ["nextTick", "queueMicrotask", "performance", "hrtime"],
    });

    await DocsAIReader.getIndex("ko");
    expect(jest.getTimerCount()).toBe(1);
    DocsAIReader.clearCache();
    expect(jest.getTimerCount()).toBe(0);
    expect(DocsAIReader.getKeptLanguages()).toEqual([]);
  });
});
