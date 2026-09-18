/*
 * The GitHub figures the home page puts in front of visitors.
 *
 * "6.5k+ stars", "80+ contributors", "29k+ commits" are claims, and this repo
 * holds its marketing copy to a claims matrix (see ClaimsGovernance.test.ts).
 * A number with a "+" after it says "at least this many", so the only safe
 * rounding is DOWN: rounding up turns 28,001 commits into "29k+", which is a
 * claim about a thousand commits that do not exist. The two formatters sit in
 * different files and had drifted apart on exactly that point.
 *
 * The cache readers matter for a quieter reason. They are read on every render
 * of "/", and the cron that fills them runs hourly - so the very first render
 * after a deploy, and every render during a GitHub outage, goes through the
 * fallback path. Whatever that path returns is what the world sees.
 */

import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import LocalCache from "Common/Server/Infrastructure/LocalCache";

/*
 * Both modules register a cron at import, with runOnStartup - which would
 * fire real requests at api.github.com from a unit test.
 */
jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (): void => {},
  };
});

import {
  formatCount,
  getGitHubCommitsCount,
  getGitHubContributorsCount,
} from "../Jobs/FetchGitHubStats";
import { formatStarCount, getGitHubStarsCount } from "../Jobs/FetchGitHubStars";

const HOME_NAMESPACE: string = "home";
const CONTRIBUTORS_KEY: string = "githubContributors";
const COMMITS_KEY: string = "githubCommits";
const STARS_KEY: string = "githubStars";

const DEFAULT_CONTRIBUTORS: number = 80;
const DEFAULT_COMMITS: number = 29000;

describe("formatCount", () => {
  it("rounds thousands DOWN, so the '+' is never a claim about work that does not exist", () => {
    expect(formatCount(28001)).toBe("28k+");
    expect(formatCount(28999)).toBe("28k+");
    expect(formatCount(29000)).toBe("29k+");
  });

  it("rounds the same way its sibling formatter does", () => {
    /*
     * formatStarCount has always floored. These two render side by side on the
     * same page, and a visitor reading "6.5k+ stars, 29k+ commits" has no way
     * to know one was rounded up.
     */
    expect(formatCount(28999)).toBe("28k+");
    expect(formatStarCount(6599)).toBe("6.5k+");
  });

  it("leaves counts under a thousand exact", () => {
    expect(formatCount(80)).toBe("80+");
    expect(formatCount(999)).toBe("999+");
    expect(formatCount(0)).toBe("0+");
  });

  it("switches to thousands at exactly one thousand", () => {
    expect(formatCount(999)).toBe("999+");
    expect(formatCount(1000)).toBe("1k+");
    expect(formatCount(1001)).toBe("1k+");
  });
});

describe("formatStarCount", () => {
  it("keeps one decimal place, rounded down", () => {
    expect(formatStarCount(6543)).toBe("6.5k+");
    expect(formatStarCount(6599)).toBe("6.5k+");
    expect(formatStarCount(6600)).toBe("6.6k+");
  });

  it("drops a trailing .0 rather than printing it", () => {
    expect(formatStarCount(6000)).toBe("6k+");
  });

  it("leaves counts under a thousand exact", () => {
    expect(formatStarCount(999)).toBe("999+");
    expect(formatStarCount(0)).toBe("0+");
  });

  it("returns null for an unknown count, so the page can omit the claim entirely", () => {
    /*
     * The difference from formatCount: stars have no believable default, so
     * "not known yet" is rendered as nothing rather than as a made-up number.
     */
    expect(formatStarCount(null)).toBeNull();
  });
});

interface MutableLocalCache {
  cache: Record<string, unknown>;
}

describe("reading the cached counts", () => {
  beforeEach(() => {
    /*
     * LocalCache is a process-wide singleton with no reset of its own, and
     * these tests care about the not-yet-populated state, so empty its store
     * directly rather than letting one test's writes decide another's answer.
     */
    (LocalCache as unknown as MutableLocalCache).cache = {};
  });

  it("falls back to a plausible figure before the cron has ever run", () => {
    // Every render between boot and the first successful fetch lands here.
    expect(getGitHubContributorsCount()).toBe(DEFAULT_CONTRIBUTORS);
    expect(getGitHubCommitsCount()).toBe(DEFAULT_COMMITS);
  });

  it("returns the cached figure once the cron has filled it", () => {
    LocalCache.setNumber(HOME_NAMESPACE, CONTRIBUTORS_KEY, 137);
    LocalCache.setNumber(HOME_NAMESPACE, COMMITS_KEY, 31234);

    expect(getGitHubContributorsCount()).toBe(137);
    expect(getGitHubCommitsCount()).toBe(31234);
  });

  it("falls back rather than rendering a zero", () => {
    /*
     * A zero is what a failed or empty API response looks like after it has
     * been written to the cache, and "0+ contributors" on the home page is
     * worse than a slightly stale number.
     */
    LocalCache.setNumber(HOME_NAMESPACE, CONTRIBUTORS_KEY, 0);
    LocalCache.setNumber(HOME_NAMESPACE, COMMITS_KEY, 0);

    expect(getGitHubContributorsCount()).toBe(DEFAULT_CONTRIBUTORS);
    expect(getGitHubCommitsCount()).toBe(DEFAULT_COMMITS);
  });

  it("stars have no default: an unknown star count stays null", () => {
    expect(getGitHubStarsCount()).toBeNull();

    LocalCache.setNumber(HOME_NAMESPACE, STARS_KEY, 6543);

    expect(getGitHubStarsCount()).toBe(6543);
  });

  it("the rendered strings are what the home page would show", () => {
    // End to end through both halves, the way Routes.ts composes them.
    LocalCache.setNumber(HOME_NAMESPACE, CONTRIBUTORS_KEY, 137);
    LocalCache.setNumber(HOME_NAMESPACE, COMMITS_KEY, 31234);
    LocalCache.setNumber(HOME_NAMESPACE, STARS_KEY, 6543);

    expect(formatCount(getGitHubContributorsCount())).toBe("137+");
    expect(formatCount(getGitHubCommitsCount())).toBe("31k+");
    expect(formatStarCount(getGitHubStarsCount())).toBe("6.5k+");
  });
});
