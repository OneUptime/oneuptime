import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import { JSONObject } from "Common/Types/JSON";

/*
 * THE COMMIT COUNT, READ FROM GITHUB'S LINK HEADER (GitHubCommitCount).
 *
 * The home page and the about page say how many commits OneUptime has. GitHub
 * gives the count as the last page of a one-commit-per-page listing, named by
 * the rel="last" link of the answer's Link header. The about page asked
 * GitHub for that listing on every visit and took the header apart by
 * position - the second link, its first "<" and first ">" replaced - and the
 * hourly job read it by a substring test and a pattern. Now only the job
 * asks, and reads the header with the shared Link header reader
 * (Common/Utils/LinkHeader): the link is found by its relation in any order,
 * and an answer with no header or no last link leaves the count as it was
 * instead of throwing. The about page never showed the count (nor the
 * repository details it also asked for), so it now asks GitHub only for
 * the contributors it shows.
 */

type RunFunction = () => Promise<void>;

const mockCronRuns: Array<RunFunction> = [];

jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (options: { runFunction: RunFunction }): void => {
      mockCronRuns.push(options.runFunction);
    },
  };
});

const mockAnswers: Array<HTTPResponse<Array<JSONObject>>> = [];

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      get: async (): Promise<HTTPResponse<Array<JSONObject>>> => {
        const answer: HTTPResponse<Array<JSONObject>> | undefined =
          mockAnswers.shift();

        if (!answer) {
          throw new Error("No answer was set up for this request.");
        }

        return answer;
      },
    },
  };
});

import { commitCountFromLinkHeader } from "../Utils/GitHubCommitCount";
import "../Jobs/FetchGitHubStats";

const COMMITS: string =
  "https://api.github.com/repositories/380744866/commits?sha=master&per_page=1";
const GITHUB_HEADER: string = `<${COMMITS}&page=2>; rel="next", <${COMMITS}&page=22486>; rel="last"`;

describe("commitCountFromLinkHeader", () => {
  it("reads the count from GitHub's header", () => {
    expect(commitCountFromLinkHeader(GITHUB_HEADER)).toBe(22486);
  });

  it("finds the last link whatever the order of the links", () => {
    expect(
      commitCountFromLinkHeader(
        `<${COMMITS}&page=22486>; rel="last", <${COMMITS}&page=2>; rel="next"`,
      ),
    ).toBe(22486);
    expect(
      commitCountFromLinkHeader(
        `<${COMMITS}&page=1>; rel="prev", <${COMMITS}&page=1>; rel="first", <${COMMITS}&page=3>; rel="next", <${COMMITS}&page=900>; rel="last"`,
      ),
    ).toBe(900);
  });

  it("is null, never a throw, for an answer that names no last page", () => {
    for (const header of [
      undefined,
      null,
      "",
      `<${COMMITS}&page=2>; rel="next"`,
      "rel=last",
      "<not a url>; rel=last",
      `<${COMMITS}>; rel="last"`,
      `<${COMMITS}&page=0>; rel="last"`,
      `<${COMMITS}&page=-4>; rel="last"`,
      `<${COMMITS}&page=many>; rel="last"`,
      `<${COMMITS}&page=2`,
    ]) {
      expect(() => {
        return commitCountFromLinkHeader(header);
      }).not.toThrow();
      expect([header, commitCountFromLinkHeader(header)]).toEqual([
        header,
        null,
      ]);
    }
  });

  it("takes an address whole, a comma in it included", () => {
    expect(
      commitCountFromLinkHeader(
        '<https://api.github.com/repos/a/b/commits?path=x,y&page=7>; rel="last"',
      ),
    ).toBe(7);
  });
});

interface MutableLocalCache {
  cache: Record<string, unknown>;
}

function answer(
  data: Array<JSONObject>,
  headers: Record<string, string>,
): HTTPResponse<Array<JSONObject>> {
  return new HTTPResponse<Array<JSONObject>>(200, data, headers);
}

describe("the hourly job reads the count the same way", () => {
  beforeEach(() => {
    (LocalCache as unknown as MutableLocalCache).cache = {};
    mockAnswers.length = 0;
  });

  async function runJobWith(linkHeader: string | undefined): Promise<void> {
    // One page of contributors, then the commit listing.
    mockAnswers.push(
      answer([{ login: "someone" }], {}),
      answer([], linkHeader === undefined ? {} : { link: linkHeader }),
    );

    expect(mockCronRuns).toHaveLength(1);
    await mockCronRuns[0]!();
  }

  it("caches the count of GitHub's header, in either order", async () => {
    await runJobWith(GITHUB_HEADER);

    expect(LocalCache.getNumber("home", "githubCommits")).toBe(22486);

    await runJobWith(
      `<${COMMITS}&page=31000>; rel="last", <${COMMITS}&page=2>; rel="next"`,
    );

    expect(LocalCache.getNumber("home", "githubCommits")).toBe(31000);
  });

  it("leaves the cached count as it was when the answer names no last page", async () => {
    await runJobWith(GITHUB_HEADER);
    await runJobWith(undefined);
    await runJobWith(`<${COMMITS}&page=2>; rel="next"`);

    expect(LocalCache.getNumber("home", "githubCommits")).toBe(22486);
  });
});

function sourceOf(file: string): string {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8");
}

// The /about route's handler, up to the next route.
function aboutRoute(): string {
  const routes: string = sourceOf("Routes.ts");
  const start: number = routes.indexOf('app.get("/about"');

  expect(start).toBeGreaterThan(-1);

  const end: number = routes.indexOf("app.get(", start + 1);

  return routes.slice(start, end === -1 ? routes.length : end);
}

describe("one reading of the header", () => {
  it("the job reads it through commitCountFromLinkHeader, and takes it apart no other way", () => {
    const source: string = sourceOf("Jobs/FetchGitHubStats.ts");

    expect(source.includes("commitCountFromLinkHeader(")).toBe(true);
    expect(source.includes('rel="last"')).toBe(false);
    expect(source.includes('.split(",")')).toBe(false);
  });

  it("the about page asks GitHub for its contributors only: no commit listing, no Link header", () => {
    const route: string = aboutRoute();

    expect(route.split("https://api.github.com/").length - 1).toBe(1);
    expect(route.includes("/contributors?page=")).toBe(true);
    expect(route.includes("/commits?")).toBe(false);
    expect(route.includes('headers["link"]')).toBe(false);
    // Nothing else in the routes reads a Link header either.
    expect(sourceOf("Routes.ts").includes('headers["link"]')).toBe(false);
  });

  it("the about view shows nothing of GitHub's but its contributors", () => {
    const view: string = sourceOf("Views/about.ejs");

    // What the route stopped passing was never read by the view.
    expect(view.includes("basicInfo")).toBe(false);
    expect(view.includes("<%= commits")).toBe(false);
    expect(view.includes("<%- commits")).toBe(false);
    expect(view.includes("contributors")).toBe(true);
  });
});
