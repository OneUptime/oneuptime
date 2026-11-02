import { describe, expect, test } from "@jest/globals";
import {
  BlogCommit,
  getUpdatedDateAfterPublishing,
  getUpdatedDatesOfPosts,
  getUtcDay,
} from "../Utils/BlogPostUpdatedDate";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

/*
 * When a blog post's text last changed, from the blog's git history
 * (Utils/BlogPostUpdatedDate.ts). Every post's page said it was modified the
 * day it was published, whatever changed after: its dateModified, its
 * article:modified_time and its sitemap lastmod. The commits here are listed
 * newest first, as git log lists them.
 */

const commit: (committedAt: string, ...files: Array<string>) => BlogCommit = (
  committedAt: string,
  ...files: Array<string>
): BlogCommit => {
  return { committedAt: committedAt, files: files };
};

const README: (post: string) => string = (post: string): string => {
  return `posts/${post}/README.md`;
};

describe("getUtcDay", () => {
  test("is the UTC day of an ISO 8601 time, whatever its offset", () => {
    expect(getUtcDay("2026-09-29T08:02:03+00:00")).toBe("2026-09-29");
    // Late on the 29th in New York is the 30th in UTC.
    expect(getUtcDay("2026-09-29T22:30:00-04:00")).toBe("2026-09-30");
    // Early on the 1st in Kolkata is still the 30th in UTC.
    expect(getUtcDay("2026-10-01T03:00:00+05:30")).toBe("2026-09-30");
    expect(getUtcDay("2026-09-29T08:02:03Z")).toBe("2026-09-29");
  });

  test("is null for what is not a time", () => {
    expect(getUtcDay("")).toBeNull();
    expect(getUtcDay("not a date")).toBeNull();
    expect(getUtcDay("2026-13-45T99:99:99Z")).toBeNull();
  });
});

describe("getUpdatedDatesOfPosts", () => {
  test("a post is updated the day of the newest commit to its README", () => {
    expect(
      getUpdatedDatesOfPosts([
        commit("2026-10-05T10:00:00Z", README("2026-09-29-a")),
        commit("2026-10-01T10:00:00Z", README("2026-09-29-a")),
        commit("2026-09-29T02:19:27Z", README("2026-09-29-a")),
      ]),
    ).toEqual(new Map([["2026-09-29-a", "2026-10-05"]]));
  });

  test("the commit that added a README is no update: a post one commit wrote has none", () => {
    expect(
      getUpdatedDatesOfPosts([
        // Committed a week after its date, and never changed.
        commit("2026-10-06T10:00:00Z", README("2026-09-29-late")),
      ]),
    ).toEqual(new Map());
  });

  test("only a change to the README counts, not the validation record or an image", () => {
    expect(
      getUpdatedDatesOfPosts([
        commit(
          "2026-10-05T10:00:00Z",
          "posts/2026-09-29-a/validation.json",
          "posts/2026-09-29-a/validation-summary.md",
          "posts/2026-09-29-a/social-media.png",
        ),
        commit("2026-09-29T02:19:27Z", README("2026-09-29-a")),
      ]),
    ).toEqual(new Map());
  });

  test("a README the validator fixed is updated the day it was validated", () => {
    // validate-posts.ts commits a post's fixed README with its validation.json.
    expect(
      getUpdatedDatesOfPosts([
        commit(
          "2026-04-09T12:00:00Z",
          README("2026-03-31-rook-on-pi"),
          "posts/2026-03-31-rook-on-pi/validation.json",
        ),
        commit("2026-03-31T09:00:00Z", README("2026-03-31-rook-on-pi")),
      ]),
    ).toEqual(new Map([["2026-03-31-rook-on-pi", "2026-04-09"]]));
  });

  test("one commit that changes several posts updates each of them", () => {
    const updated: Map<string, string> = getUpdatedDatesOfPosts([
      commit(
        "2026-10-05T10:00:00Z",
        README("2026-01-01-a"),
        README("2026-01-02-b"),
      ),
      commit("2026-01-02T10:00:00Z", README("2026-01-02-b")),
      commit("2026-01-01T10:00:00Z", README("2026-01-01-a")),
    ]);

    expect(updated).toEqual(
      new Map([
        ["2026-01-01-a", "2026-10-05"],
        ["2026-01-02-b", "2026-10-05"],
      ]),
    );
  });

  test("each post is read on its own", () => {
    expect(
      getUpdatedDatesOfPosts([
        commit("2026-10-05T10:00:00Z", README("2026-01-01-a")),
        commit("2026-10-04T10:00:00Z", README("2026-01-02-b")),
        commit("2026-01-02T10:00:00Z", README("2026-01-02-b")),
        commit("2026-01-01T10:00:00Z", README("2026-01-01-a")),
        commit("2026-01-03T10:00:00Z", README("2026-01-03-c")),
      ]),
    ).toEqual(
      new Map([
        ["2026-01-01-a", "2026-10-05"],
        ["2026-01-02-b", "2026-10-04"],
      ]),
    );
  });

  test("a README deeper in a post's folder, or outside posts/, is not the post's", () => {
    expect(
      getUpdatedDatesOfPosts([
        commit(
          "2026-10-05T10:00:00Z",
          "posts/2026-01-01-a/examples/README.md",
          "README.md",
          "drafts/2026-01-01-a/README.md",
        ),
        commit(
          "2026-01-01T10:00:00Z",
          "posts/2026-01-01-a/examples/README.md",
          "README.md",
          "drafts/2026-01-01-a/README.md",
        ),
      ]),
    ).toEqual(new Map());
  });

  test("a newest commit with no readable time gives way to the next one that has one", () => {
    expect(
      getUpdatedDatesOfPosts([
        commit("", README("2026-01-01-a")),
        commit("2026-06-01T10:00:00Z", README("2026-01-01-a")),
        commit("2026-01-01T10:00:00Z", README("2026-01-01-a")),
      ]),
    ).toEqual(new Map([["2026-01-01-a", "2026-06-01"]]));
  });

  test("a post none of whose commits has a time has no updated date", () => {
    expect(
      getUpdatedDatesOfPosts([
        commit("", README("2026-01-01-a")),
        commit("garbage", README("2026-01-01-a")),
      ]),
    ).toEqual(new Map());
  });

  test("no history - a shallow clone's, or none - is no updates", () => {
    expect(getUpdatedDatesOfPosts([])).toEqual(new Map());
    expect(getUpdatedDatesOfPosts([commit("2026-10-05T10:00:00Z")])).toEqual(
      new Map(),
    );
  });

  test("reads 61,000 posts' history in one pass, quickly", () => {
    const added: Array<BlogCommit> = [];
    const changed: Array<BlogCommit> = [];

    for (let index: number = 0; index < 61000; index++) {
      added.push(commit("2026-03-31T10:00:00Z", README(`post-${index}`)));
    }
    // Every tenth post changed once more, later - listed first, as git lists it.
    for (let index: number = 0; index < 61000; index += 10) {
      changed.push(commit("2026-09-01T10:00:00Z", README(`post-${index}`)));
    }

    const commits: Array<BlogCommit> = [...changed, ...added];

    // The fastest of a few runs, as a busy runner can stall any one of them.
    const timed: FastestRun<Map<string, string>> = fastestRun({
      run: (): Map<string, string> => {
        return getUpdatedDatesOfPosts(commits);
      },
      limitInMs: 2000,
    });
    const updated: Map<string, string> = timed.result;

    expect(timed.inMs).toBeLessThan(2000);
    expect(updated.size).toBe(6100);
    expect(updated.get("post-0")).toBe("2026-09-01");
    expect(updated.has("post-1")).toBe(false);
  });
});

describe("getUpdatedDateAfterPublishing", () => {
  test("is the updated date when it is after the day the post was published", () => {
    expect(getUpdatedDateAfterPublishing("2026-10-05", "2026-09-29")).toBe(
      "2026-10-05",
    );
  });

  test("is none on the day the post was published, or before it", () => {
    // A typo fixed the day the post went out.
    expect(
      getUpdatedDateAfterPublishing("2026-09-29", "2026-09-29"),
    ).toBeNull();
    // A post dated ahead of its commits.
    expect(
      getUpdatedDateAfterPublishing("2026-09-20", "2026-09-29"),
    ).toBeNull();
  });

  test("is none when there is no updated date", () => {
    expect(getUpdatedDateAfterPublishing(null, "2026-09-29")).toBeNull();
    expect(getUpdatedDateAfterPublishing(undefined, "2026-09-29")).toBeNull();
    expect(getUpdatedDateAfterPublishing("", "2026-09-29")).toBeNull();
  });
});
