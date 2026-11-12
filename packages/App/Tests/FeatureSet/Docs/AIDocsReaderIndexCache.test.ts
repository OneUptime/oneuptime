import DocsAIReader, {
  AIDocsLanguageIndex,
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
 */

// jest-mock's spy, as @jest/globals' jest.spyOn returns it.
type BuildSpy = SpyInstance<typeof DocsAIReader.build>;

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
