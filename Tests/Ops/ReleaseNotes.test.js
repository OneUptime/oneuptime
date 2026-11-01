"use strict";

/**
 * Scripts/Release/GenerateReleaseNotes.js - the notes of every GitHub release,
 * which the upgrade guide tells self-hosters to follow and the website links
 * to as the Changelog.
 *
 * The notes used to come from an action that worked out its range from the
 * repository's tags. A draft release has no tag, so it took the newest tag for
 * the end of the range, which is the release before this one: 14.0.96, 14.0.97
 * and 14.0.98 each listed what the release before them shipped, and none of
 * what they shipped themselves. It sorted by labels, which nobody applies, so
 * all of it landed in one folded list.
 *
 * What has to hold, and what each part of this suite pins:
 *
 *  - The range: from the newest published release older than this one to the
 *    commit the run built, whatever tags exist.
 *  - The changes: every pull request once, every commit pushed straight to
 *    master (GitHub answers those with the release gate, which is no answer),
 *    and neither the gate nor the version bump.
 *  - The sorting: both ways the repository writes a title, with a label over
 *    a title, and what mends the repository rather than the product folded
 *    under Maintenance.
 *  - The text: a title stays text, so it can neither drop words as an unknown
 *    tag nor mention a stranger who holds a package's scope.
 *  - The limits: GitHub refuses a body over 125,000 characters, and that
 *    would fail the draft step.
 *  - Failure: a release is not held back for its notes, and is never left
 *    with an empty page.
 *  - The workflow: draft-github-release runs all of this, and every attempt
 *    at the draft reads what it wrote.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const {
  MAX_NOTES_LENGTH,
  areaName,
  assembleNotes,
  buildEntries,
  escapeMarkdown,
  findContributors,
  findPreviousRelease,
  parseArguments,
  parseTitle,
  renderFallbackNotes,
  renderNotes,
  run,
  sortChanges,
  startSentence,
} = require("../../Scripts/Release/GenerateReleaseNotes");

const REPO_ROOT = path.join(__dirname, "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "Scripts",
  "Release",
  "GenerateReleaseNotes.js",
);
const REPOSITORY = "OneUptime/oneuptime";
const BUILT_COMMIT = "5a55eface9b1d6f0c2e8a4b7d3c9e1f2a6b8c0d4";

function shaOf(number) {
  return String(number).padStart(40, "0");
}

function commitNamed(number, subject, options = {}) {
  return {
    sha: shaOf(number),
    commit: { message: `${subject}\n\nThe rest of the message.` },
    parents: Array.from({ length: options.parents || 1 }, () => {
      return { sha: "parent" };
    }),
    author:
      options.author === undefined ? { login: "simlarsen" } : options.author,
  };
}

function pullRequest(number, title, options = {}) {
  return {
    number,
    title,
    merged: options.merged !== false,
    baseRefName: options.base || "master",
    author:
      options.author === undefined
        ? { __typename: "User", login: "simlarsen" }
        : options.author,
    labels: {
      nodes: (options.labels || []).map((name) => {
        return { name };
      }),
    },
  };
}

const GATE = pullRequest(5408, "Release 14.0.98 (CI gate - do not merge)", {
  base: "release",
});

function answer(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      return body;
    },
    text: async () => {
      return JSON.stringify(body);
    },
  };
}

// GitHub's three answers to the script, with every request it was asked.
function fakeGitHub({ releases, commits, pullRequestsOf, failures = [] }) {
  const requests = [];

  const fetcher = async (url) => {
    requests.push(url);

    if (failures.length > 0) {
      const failure = failures.shift();
      if (failure instanceof Error) {
        throw failure;
      }
      return answer(failure, { message: "Not this time" });
    }

    if (url.endsWith("/graphql")) {
      return answer(200, { data: { repository: fakeRepository(requests) } });
    }
    if (url.includes("/releases?")) {
      return answer(200, releases);
    }
    if (url.includes("/compare/")) {
      const page = Number(new URL(url).searchParams.get("page"));
      return answer(200, {
        total_commits: commits.length,
        commits: commits.slice((page - 1) * 100, page * 100),
      });
    }
    throw new Error(`Nothing answers ${url}`);
  };

  function fakeRepository() {
    const repository = {};
    fetcher.lastQuery.match(/oid: "[0-9a-f]+"/g).forEach((oid, index) => {
      repository[`commit${index}`] = {
        associatedPullRequests: {
          nodes: pullRequestsOf(oid.slice(6, -1)),
        },
      };
    });
    return repository;
  }

  return {
    requests,
    fetcher: (url, init) => {
      if (init.body) {
        fetcher.lastQuery = JSON.parse(init.body).query;
      }
      return fetcher(url);
    },
  };
}

describe("the range of a release", () => {
  const published = (tag) => {
    return { tag_name: tag, draft: false, prerelease: false };
  };

  test("starts at the newest published release older than this one", () => {
    expect(
      findPreviousRelease(
        [published("14.0.98"), published("14.0.97"), published("14.0.96")],
        "14.0.99",
      ),
    ).toBe("14.0.98");
  });

  test("compares versions as numbers: 14.0.100 is newer than 14.0.99", () => {
    expect(
      findPreviousRelease(
        [published("14.0.99"), published("14.0.100"), published("14.0.9")],
        "14.0.101",
      ),
    ).toBe("14.0.100");
    // The next release: as text, 99 sorts after 100, and nothing is older.
    expect(
      findPreviousRelease(
        [published("14.0.99"), published("14.0.98")],
        "14.0.100",
      ),
    ).toBe("14.0.99");
  });

  test("skips drafts and prereleases, which no reader has seen", () => {
    expect(
      findPreviousRelease(
        [
          { tag_name: "14.0.98", draft: true, prerelease: false },
          { tag_name: "14.0.97", draft: false, prerelease: true },
          published("14.0.96"),
        ],
        "14.0.99",
      ),
    ).toBe("14.0.96");
  });

  test("skips this release, so a run repeated after a publish does not compare it with itself", () => {
    expect(
      findPreviousRelease(
        [published("14.0.99"), published("14.0.98")],
        "14.0.99",
      ),
    ).toBe("14.0.98");
  });

  test("skips anything newer, for the notes of an older release written again", () => {
    expect(
      findPreviousRelease(
        [published("14.0.99"), published("14.0.97"), published("14.0.96")],
        "14.0.98",
      ),
    ).toBe("14.0.97");
  });

  test("takes a major version's first release from the one before it", () => {
    expect(findPreviousRelease([published("14.0.99")], "15.0.0")).toBe(
      "14.0.99",
    );
  });

  test("reads only plain versions, with or without a v", () => {
    expect(
      findPreviousRelease(
        [published("build-number-9390"), published("v13.2.1")],
        "14.0.0",
      ),
    ).toBe("v13.2.1");
  });

  test("has no answer when nothing was published before", () => {
    expect(findPreviousRelease([published("14.0.99")], "14.0.99")).toBeNull();
  });

  test("refuses a version it cannot compare", () => {
    expect(() => {
      return findPreviousRelease([], "next");
    }).toThrow('"next" is not a release version');
  });
});

describe("what a title says", () => {
  test.each([
    ["feat(exceptions): saved views of the exceptions list", "features"],
    ["fix(monitors): the HPA template can be scoped to one HPA", "fixes"],
    ["perf(exceptions): read only text heads", "performance"],
    ["docs(audit-logs): the page lists hunts", "docs"],
    ["revert: feat(ui): the new table", "fixes"],
    ["test(events): number before the title", "maintenance"],
    ["ci(app-test): a suite of their own", "maintenance"],
    ["chore: npm audit fix", "maintenance"],
    ["refactor(ai): one prompt builder", "maintenance"],
    ["style(ai): cases are typed", "maintenance"],
    ["build: a smaller image", "maintenance"],
  ])("%s goes under %s", (title, section) => {
    expect(parseTitle(title).section).toBe(section);
  });

  test("reads a type in any case", () => {
    expect(parseTitle("Fix: the status page").section).toBe("fixes");
    expect(parseTitle("Docs: AI gateway observability").section).toBe("docs");
  });

  test("takes its area from the scope and its words from the rest", () => {
    expect(
      parseTitle("feat(kubernetes): an OpenShift cluster is offered alerts"),
    ).toEqual({
      section: "features",
      area: "Kubernetes",
      text: "an OpenShift cluster is offered alerts",
      breaking: false,
    });
  });

  test("a conventional title with no scope has no area", () => {
    expect(parseTitle("feat: uploaded logos inside emails")).toEqual({
      section: "features",
      area: null,
      text: "uploaded logos inside emails",
      breaking: false,
    });
  });

  test("marks a breaking change, with or without a scope", () => {
    expect(parseTitle("feat(helm)!: new values").breaking).toBe(true);
    expect(parseTitle("fix!: remove the old route").breaking).toBe(true);
    expect(parseTitle("feat(helm): new values").breaking).toBe(false);
  });

  test("reads a title that opens with its area", () => {
    expect(
      parseTitle("Workflows: every template in five steps or fewer"),
    ).toEqual({
      section: "features",
      area: "Workflows",
      text: "every template in five steps or fewer",
      breaking: false,
    });
  });

  test("a follow-up belongs to its area, and alone it names no area", () => {
    expect(parseTitle("Telemetry AI next: a log stall notice").area).toBe(
      "Telemetry AI",
    );
    expect(parseTitle("Security Events follow-ups: Hunts").area).toBe(
      "Security",
    );
    expect(parseTitle("Follow-ups: incidents and on-call")).toEqual({
      section: "features",
      area: null,
      text: "incidents and on-call",
      breaking: false,
    });
  });

  test.each([
    "The trace view in all 17 Dashboard languages: minimap, flame graph",
    "Forms and buttons, next: Change Plan on the plan picker",
    "Monitors follow-ups (#5281): grouped infrastructure reads",
    "Agent install scripts served by OneUptime itself: /install/<agent>",
    "Names instead of bare IP addresses on Network > Traffic (#5340)",
  ])("keeps every word of a title that names no area: %s", (title) => {
    expect(parseTitle(title)).toEqual({
      section: "features",
      area: null,
      text: title,
      breaking: false,
    });
  });

  test("a title that fits neither form can still be read as a fix", () => {
    expect(parseTitle("Fix the status page").section).toBe("fixes");
    expect(parseTitle("Fixes for monitors: the chart").section).toBe("fixes");
    expect(parseTitle('Revert "feat(ui): the new table"').section).toBe(
      "fixes",
    );
  });

  test.each([
    "fix(ci): Home's tests stop running out of heap",
    "fix(e2e): DashboardWidgetSort reads the table once it settles",
    "feat(release): the draft is written earlier",
    "fix(deps): bump a transitive dependency",
    "perf(test): the suite runs faster",
    "fix(ci, e2e): both pipelines",
    "CI: a suite of its own",
  ])("what mends the repository goes under Maintenance: %s", (title) => {
    expect(parseTitle(title).section).toBe("maintenance");
  });

  test("a product that shares a word with the repository is still the product", () => {
    expect(parseTitle("fix(workflows): a run stops").section).toBe("fixes");
    expect(parseTitle("fix(ci, monitors): both").section).toBe("fixes");
  });

  test("survives a title that starts with a name objects inherit", () => {
    expect(parseTitle("constructor: a title").area).toBe("Constructor");
    expect(parseTitle("fix(constructor): a title").area).toBe("Constructor");
  });

  test("collapses white space", () => {
    expect(parseTitle("  fix(ui):   a   title  ").text).toBe("a title");
  });
});

describe("the name of an area", () => {
  test.each([
    ["exceptions", "Exceptions"],
    ["Exceptions", "Exceptions"],
    ["on-call", "On-Call"],
    ["On-call", "On-Call"],
    ["status-pages", "Status Pages"],
    ["status-page", "Status Pages"],
    ["monitor", "Monitors"],
    ["monitors", "Monitors"],
    ["dashboard", "Dashboards"],
    ["runner", "Runners"],
    ["workflow", "Workflows"],
    ["security-events", "Security"],
    ["Security Events", "Security"],
    ["kubernetes-agent", "Kubernetes Agent"],
    ["infrastructure-monitors", "Infrastructure Monitors"],
    ["ai", "AI"],
    ["api-keys", "API Keys"],
    ["iot", "IoT"],
    ["mcp", "MCP"],
    ["ci", "CI"],
    ["e2e", "E2E"],
    ["home", "Website"],
    ["i18n", "Translations"],
    ["self-hosted", "Self-Hosted"],
    ["UI polish", "UI polish"],
    ["Mobile app", "Mobile App"],
    ["slack, teams", "Slack, Teams"],
    ["probe,runner", "Probe, Runners"],
  ])("%s reads as %s", (area, name) => {
    expect(areaName(area)).toBe(name);
  });
});

describe("the text of an entry", () => {
  test.each([
    ["an OpenShift cluster", "An OpenShift cluster"],
    ["on-call pages", "On-call pages"],
    ["the HPA template", "The HPA template"],
    ["Already a sentence", "Already a sentence"],
    ["iOS push", "iOS push"],
    ["macOS servers", "macOS servers"],
    ["npm audit fix", "npm audit fix"],
    ["kubectl output", "kubectl output"],
    [
      "oneuptime.com/demo goes to the demo",
      "oneuptime.com/demo goes to the demo",
    ],
    ["#5284 follow-ups", "#5284 follow-ups"],
    ["e2e suites", "e2e suites"],
  ])("%s starts as %s", (text, sentence) => {
    expect(startSentence(text)).toBe(sentence);
  });

  test("keeps a path's placeholder, which GitHub would drop as an unknown tag", () => {
    expect(escapeMarkdown("served at /install/<agent> on its own host")).toBe(
      "served at `/install/<agent>` on its own host",
    );
  });

  test("does not mention whoever holds a package's scope", () => {
    expect(escapeMarkdown("@hono/node-server 2.1.5 for the MCP SDK")).toBe(
      "`@hono/node-server` 2.1.5 for the MCP SDK",
    );
    expect(escapeMarkdown("the SDK (@modelcontextprotocol/sdk) moves")).toBe(
      "the SDK `(@modelcontextprotocol/sdk)` moves",
    );
  });

  test("leaves an address alone: nobody is mentioned in it", () => {
    expect(escapeMarkdown("write to key@oneuptime.com")).toBe(
      "write to key@oneuptime.com",
    );
  });

  test("a title cannot carry a link, an image or emphasis", () => {
    expect(escapeMarkdown("see [this](http://example.com)")).toBe(
      "see \\[this\\](http://example.com)",
    );
    expect(escapeMarkdown("![pixel](http://example.com/x.png)")).toBe(
      "!\\[pixel\\](http://example.com/x.png)",
    );
    expect(escapeMarkdown("*.yaml and *.yml")).toBe("\\*.yaml and \\*.yml");
    expect(escapeMarkdown("_private_ ~~gone~~")).toBe(
      "\\_private\\_ \\~\\~gone\\~\\~",
    );
  });

  test("leaves what needs nothing as it was written", () => {
    expect(escapeMarkdown("OpenAI prompt_cache_key, as #5398 counts")).toBe(
      "OpenAI prompt_cache_key, as #5398 counts",
    );
    expect(escapeMarkdown("Network > Traffic (#5340)")).toBe(
      "Network > Traffic (#5340)",
    );
  });

  test("leaves code spans as they are", () => {
    expect(escapeMarkdown("run `npm run *` and `a_b_`, then *stop")).toBe(
      "run `npm run *` and `a_b_`, then \\*stop",
    );
  });
});

describe("the changes of a release", () => {
  function sort(commits, pullRequestsBySha) {
    return sortChanges(commits, new Map(Object.entries(pullRequestsBySha)));
  }

  test("a pull request is one change, however many commits it brought", () => {
    const pr = pullRequest(5406, "feat: numbers");

    const { pullRequests, directCommits } = sort(
      [
        commitNamed(1, "feat: first"),
        commitNamed(2, "test: second"),
        commitNamed(3, "Merge pull request #5406", { parents: 2 }),
      ],
      { [shaOf(1)]: [pr], [shaOf(2)]: [pr], [shaOf(3)]: [pr] },
    );

    expect(pullRequests).toEqual([pr]);
    expect(directCommits).toEqual([]);
  });

  test("lists pull requests in the order they were opened", () => {
    const first = pullRequest(5402, "fix: one");
    const second = pullRequest(5406, "fix: two");

    const { pullRequests } = sort([commitNamed(1, "b"), commitNamed(2, "a")], {
      [shaOf(1)]: [second],
      [shaOf(2)]: [first],
    });

    expect(
      pullRequests.map((pr) => {
        return pr.number;
      }),
    ).toEqual([5402, 5406]);
  });

  test("a commit pushed to master stays, though GitHub answers it with the gate", () => {
    // What GitHub answered for 14.0.98's fixes on master, all of them lost
    // from the old notes.
    const fix = commitNamed(1, "docs(audit-logs): the page lists hunts");

    const { pullRequests, directCommits } = sort([fix], {
      [shaOf(1)]: [GATE],
    });

    expect(pullRequests).toEqual([]);
    expect(directCommits).toEqual([fix]);
  });

  test("the gate is no change of its own, whatever it calls itself", () => {
    const titles = [
      "Release 14.0.97 (CI gate - do not merge)",
      "Release 14.0.92",
      "Release gate for 14.0.40 (DO NOT MERGE)",
      "release",
    ];

    titles.forEach((title, index) => {
      expect(
        sort([commitNamed(index, "x", { parents: 2 })], {
          [shaOf(index)]: [pullRequest(index, title, { base: "release" })],
        }).pullRequests,
      ).toEqual([]);
    });
  });

  test("a hotfix into the release branch is a change", () => {
    const hotfix = pullRequest(100, "fix: a yield during ingest", {
      base: "release",
    });

    expect(
      sort([commitNamed(1, "fix: a yield")], { [shaOf(1)]: [hotfix] })
        .pullRequests,
    ).toEqual([hotfix]);
  });

  test("a title about releases into master is not the gate", () => {
    const notes = pullRequest(100, "Release notes: sorted");

    expect(
      sort([commitNamed(1, "x")], { [shaOf(1)]: [notes] }).pullRequests,
    ).toEqual([notes]);
  });

  test("an open pull request that holds a commit did not ship it", () => {
    const fix = commitNamed(1, "fix(ui): a crumb gives way");

    const { pullRequests, directCommits } = sort([fix], {
      [shaOf(1)]: [pullRequest(9, "feat: wip", { merged: false })],
    });

    expect(pullRequests).toEqual([]);
    expect(directCommits).toEqual([fix]);
  });

  test("leaves out the version bump and merges of branches into each other", () => {
    const { directCommits } = sort(
      [
        commitNamed(1, "chore: bump version to 14.0.98"),
        commitNamed(2, "Merge the 14.0.97 version bump into master", {
          parents: 2,
        }),
        commitNamed(3, "Merge master into release for 14.0.98", { parents: 2 }),
      ],
      { [shaOf(1)]: [GATE], [shaOf(2)]: [GATE], [shaOf(3)]: [GATE] },
    );

    expect(directCommits).toEqual([]);
  });

  test("a commit GitHub says nothing about is a commit pushed to master", () => {
    const fix = commitNamed(1, "fix(ui): a crumb gives way");

    expect(sort([fix], {}).directCommits).toEqual([fix]);
  });

  test("the ignore label leaves a pull request out, as it always has", () => {
    expect(
      buildEntries(
        {
          pullRequests: [
            pullRequest(1, "fix: shown"),
            pullRequest(2, "fix: hidden", { labels: ["ignore"] }),
          ],
          directCommits: [],
        },
        REPOSITORY,
      ).map((entry) => {
        return entry.reference;
      }),
    ).toEqual(["#1"]);
  });

  test("a label wins over a title", () => {
    const sectionOf = (title, labels) => {
      return buildEntries(
        {
          pullRequests: [pullRequest(1, title, { labels })],
          directCommits: [],
        },
        REPOSITORY,
      )[0].section;
    };

    expect(sectionOf("Monitors: the chart", ["bug"])).toBe("fixes");
    expect(sectionOf("Monitors: the chart", ["fix"])).toBe("fixes");
    expect(sectionOf("fix: the chart", ["enhancement"])).toBe("features");
    expect(sectionOf("feat: a guide", ["documentation"])).toBe("docs");
    expect(sectionOf("Bump a package", ["dependencies"])).toBe("maintenance");
    expect(sectionOf("Monitors: the chart", ["backend"])).toBe("features");
  });

  test("a label does not take a breaking change off the top of the notes", () => {
    expect(
      buildEntries(
        {
          pullRequests: [
            pullRequest(1, "feat!: new values", { labels: ["bug"] }),
          ],
          directCommits: [],
        },
        REPOSITORY,
      )[0].section,
    ).toBe("breaking");
  });

  test("a commit is linked by its short hash, and listed once if it was picked", () => {
    const entries = buildEntries(
      {
        pullRequests: [],
        directCommits: [
          commitNamed(0xabc, "fix(ui): a crumb gives way"),
          commitNamed(0xdef, "fix(ui): a crumb gives way"),
        ],
      },
      REPOSITORY,
    );

    expect(entries).toEqual([
      {
        section: "fixes",
        area: "UI",
        text: "a crumb gives way",
        reference: `[0000000](https://github.com/${REPOSITORY}/commit/${shaOf(0xabc)})`,
      },
    ]);
  });

  test("thanks people, not bots, and survives a commit with no account", () => {
    expect(
      findContributors({
        pullRequests: [
          pullRequest(1, "a", {
            author: { __typename: "User", login: "zoe" },
          }),
          pullRequest(2, "b", {
            author: { __typename: "User", login: "simlarsen" },
          }),
          pullRequest(3, "c", {
            author: { __typename: "Bot", login: "github-actions" },
          }),
          pullRequest(4, "d", { author: null }),
        ],
        directCommits: [
          commitNamed(1, "a", { author: { login: "ana", type: "User" } }),
          commitNamed(2, "b", {
            author: { login: "dependabot[bot]", type: "Bot" },
          }),
          commitNamed(3, "c", {
            author: { login: "renovate[bot]", type: "User" },
          }),
          commitNamed(4, "d", { author: null }),
        ],
      }),
    ).toEqual(["ana", "simlarsen", "zoe"]);
  });
});

describe("the notes of a release", () => {
  const render = (entries, overrides = {}) => {
    return renderNotes({
      version: "14.0.99",
      previous: "14.0.98",
      repository: REPOSITORY,
      entries,
      contributors: ["simlarsen"],
      ...overrides,
    });
  };

  const entry = (section, area, text, reference = "#1") => {
    return { section, area, text, reference };
  };

  test("reads as a whole", () => {
    expect(
      render(
        [
          entry("features", "Exceptions", "saved views", "#5454"),
          entry("features", "Exceptions", "merged fingerprints", "#5445"),
          entry("features", "Forms", "a form on its own domain", "#5463"),
          entry("features", null, "The trace view in all languages", "#5470"),
          entry("fixes", "Monitors", "the HPA can be scoped", "#5475"),
          entry("maintenance", null, "npm audit fix", "#5466"),
        ],
        { contributors: ["simlarsen", "zoe"] },
      ),
    ).toBe(
      `**6 changes since [14.0.98](https://github.com/OneUptime/oneuptime/releases/tag/14.0.98):** 4 new or improved features, 1 bug fix and 1 maintenance change.

## ✨ New and improved

- **Exceptions**
  - Saved views (#5454)
  - Merged fingerprints (#5445)
- **Forms:** A form on its own domain (#5463)
- The trace view in all languages (#5470)

## 🐛 Bug fixes

- **Monitors:** The HPA can be scoped (#5475)

<details>
<summary>🧰 Maintenance (1)</summary>

- npm audit fix (#5466)

</details>

## ⬆️ Upgrade

Back up first, then follow the [upgrade guide](https://oneuptime.com/docs/installation/upgrading). On Docker Compose, run \`npm run update\` on the \`release\` branch. On Kubernetes, \`helm upgrade\` to version \`14.0.99\` of the chart.

**Full changelog:** https://github.com/OneUptime/oneuptime/compare/14.0.98...14.0.99

**Contributors:** @simlarsen, @zoe`,
    );
  });

  test("puts sections in the order a reader wants them, and skips the empty ones", () => {
    const notes = render([
      entry("docs", null, "a guide"),
      entry("performance", null, "faster"),
      entry("fixes", null, "a fix"),
      entry("features", null, "a feature"),
      entry("breaking", null, "a break"),
    ]);

    const headings = notes.match(/^## .*$/gm);
    expect(headings).toEqual([
      "## ⚠️ Breaking changes",
      "## ✨ New and improved",
      "## 🐛 Bug fixes",
      "## ⚡ Performance",
      "## 📚 Documentation",
      "## ⬆️ Upgrade",
    ]);
    expect(notes).not.toContain("<details>");
  });

  test("names the busiest areas once there is more than one, leaving Maintenance out", () => {
    const notes = render([
      entry("features", "Kubernetes", "a"),
      entry("features", "Kubernetes", "b"),
      entry("features", "Kubernetes", "c"),
      entry("fixes", "Exceptions", "d"),
      entry("features", "Exceptions", "e"),
      entry("features", "Forms", "f"),
      entry("maintenance", "CI", "g"),
      entry("maintenance", "CI", "h"),
      entry("maintenance", "CI", "i"),
    ]);

    expect(notes.split("\n")[0]).toMatch(
      /The busiest areas: Kubernetes and Exceptions\.$/,
    );
  });

  test("does not name one area as the busiest", () => {
    const notes = render([
      entry("features", "Kubernetes", "a"),
      entry("features", "Kubernetes", "b"),
    ]);

    expect(notes.split("\n")[0]).not.toContain("busiest");
  });

  test("the busiest area leads its section", () => {
    const notes = render([
      entry("features", "Forms", "a"),
      entry("features", "Kubernetes", "b"),
      entry("features", "Kubernetes", "c"),
    ]);

    expect(notes.indexOf("**Kubernetes**")).toBeLessThan(
      notes.indexOf("**Forms:**"),
    );
  });

  test("an area's name and an entry's text are both escaped", () => {
    const notes = render([
      entry("features", "@scope", "served at /install/<agent>"),
    ]);

    expect(notes).toContain(
      "- **`@scope`:** Served at `/install/<agent>` (#1)",
    );
  });

  test("says so when a release changes nothing", () => {
    const notes = render([]);

    expect(notes.split("\n")[0]).toBe(
      "No changes since [14.0.98](https://github.com/OneUptime/oneuptime/releases/tag/14.0.98).",
    );
    expect(notes).toContain("## ⬆️ Upgrade");
  });

  test("a new major version sends the reader to what it asks of them", () => {
    const anchor =
      "https://oneuptime.com/docs/installation/upgrading#find-the-notes-for-your-version";

    expect(render([], { version: "15.0.0" })).toContain(anchor);
    expect(render([], { version: "15.0.1" })).not.toContain(anchor);
    expect(render([], { version: "14.1.0" })).not.toContain(anchor);
  });

  test("leaves the contributors out when there are none", () => {
    expect(render([], { contributors: [] })).not.toContain("Contributors");
  });

  describe("stays within what GitHub takes", () => {
    const longTitle = "a long title about what changed for the reader ".repeat(
      4,
    );
    const many = (section, count) => {
      return Array.from({ length: count }, (_, index) => {
        return entry(section, null, longTitle, `#${index}`);
      });
    };

    test("the limit is under GitHub's own", () => {
      expect(MAX_NOTES_LENGTH).toBeLessThan(125000);
    });

    test("a long release is left alone", () => {
      const notes = render(many("features", 300));

      expect(notes).not.toContain("too long for GitHub");
      expect(notes).toContain("(#299)");
    });

    test("Maintenance goes first", () => {
      const notes = render([
        ...many("features", 300),
        ...many("maintenance", 1000),
      ]);

      expect(notes.length).toBeLessThanOrEqual(MAX_NOTES_LENGTH);
      expect(notes).toContain("too long for GitHub");
      expect(notes).not.toContain("<details>");
      expect(notes).toContain("(#299)");
    });

    test("then the changes are cut, on a line, and the way to the rest stays", () => {
      const notes = render(many("features", 5000));

      expect(notes.length).toBeLessThanOrEqual(MAX_NOTES_LENGTH);
      expect(notes).toContain("too long for GitHub");
      expect(notes).toContain(
        "**Full changelog:** https://github.com/OneUptime/oneuptime/compare/14.0.98...14.0.99",
      );
      expect(notes).toContain("**Contributors:** @simlarsen");

      const lastEntry = notes
        .split("\n")
        .filter((line) => {
          return line.startsWith("- ");
        })
        .pop();
      expect(lastEntry).toMatch(/\(#\d+\)$/);
    });

    test("empty blocks leave no blank paragraphs", () => {
      expect(
        assembleNotes({ changes: ["one"], folded: "", closing: ["two", ""] }),
      ).toBe("one\n\ntwo");
    });
  });

  test("the fallback links to the changes, with or without a release to compare", () => {
    expect(
      renderFallbackNotes({
        version: "14.0.99",
        previous: "14.0.98",
        repository: REPOSITORY,
      }),
    ).toContain(
      "**Full changelog:** https://github.com/OneUptime/oneuptime/compare/14.0.98...14.0.99",
    );

    expect(
      renderFallbackNotes({
        version: "14.0.99",
        previous: null,
        repository: REPOSITORY,
      }),
    ).toContain(
      "**Full changelog:** https://github.com/OneUptime/oneuptime/commits/14.0.99",
    );
  });
});

describe("a run of the script", () => {
  const RELEASES = [
    { tag_name: "14.0.99", draft: true, prerelease: false },
    { tag_name: "14.0.98", draft: false, prerelease: false },
    { tag_name: "14.0.97", draft: false, prerelease: false },
  ];

  const COMMITS = [
    commitNamed(1, "feat(forms): a form on its own domain"),
    commitNamed(2, "Merge pull request #5463 from OneUptime/forms", {
      parents: 2,
    }),
    commitNamed(3, "docs(audit-logs): the page lists hunts"),
    commitNamed(4, "chore: bump version to 14.0.99"),
    commitNamed(5, "Merge master into release for 14.0.99", { parents: 2 }),
  ];

  const pullRequestsOf = (sha) => {
    if (sha === shaOf(1) || sha === shaOf(2)) {
      return [pullRequest(5463, "feat(forms): a form on its own domain")];
    }
    return [GATE];
  };

  async function generate(github, options = {}, tools = {}) {
    const written = [];
    const sleep = jest.fn().mockResolvedValue(undefined);

    await run(
      {
        version: "14.0.99",
        to: BUILT_COMMIT,
        from: null,
        repository: REPOSITORY,
        fallbackOnError: false,
        ...options,
      },
      {
        token: "a-token",
        fetcher: github.fetcher,
        sleep,
        write: (notes) => {
          written.push(notes);
        },
        ...tools,
      },
    );

    return { notes: written[0], sleep };
  }

  test("compares the newest published release with the commit the run built", async () => {
    // The regression: the end of the range is this run's commit, not a tag.
    const github = fakeGitHub({
      releases: RELEASES,
      commits: COMMITS,
      pullRequestsOf,
    });

    await generate(github);

    expect(github.requests[1]).toBe(
      `https://api.github.com/repos/${REPOSITORY}/compare/14.0.98...${BUILT_COMMIT}?per_page=100&page=1`,
    );
  });

  test("lists what the release ships, from GitHub's answers", async () => {
    const { notes } = await generate(
      fakeGitHub({ releases: RELEASES, commits: COMMITS, pullRequestsOf }),
    );

    expect(notes).toContain("**2 changes since [14.0.98]");
    expect(notes).toContain("- **Forms:** A form on its own domain (#5463)");
    expect(notes).toContain(
      "- **Audit Logs:** The page lists hunts ([0000000]",
    );
    expect(notes).not.toContain("bump version");
    expect(notes).not.toContain("CI gate");
    expect(notes).not.toContain("Merge");
    expect(notes).toContain("/compare/14.0.98...14.0.99");
    expect(notes).toContain("**Contributors:** @simlarsen");
  });

  test("takes --from at its word, without reading the releases", async () => {
    const github = fakeGitHub({
      releases: RELEASES,
      commits: COMMITS,
      pullRequestsOf,
    });

    await generate(github, { from: "14.0.97" });

    expect(github.requests[0]).toContain("/compare/14.0.97...");
  });

  test("reads every page of a long release, and asks about every commit", async () => {
    const commits = Array.from({ length: 389 }, (_, index) => {
      return commitNamed(index + 1, `fix(ui): change ${index + 1}`);
    });
    const github = fakeGitHub({
      releases: RELEASES,
      commits,
      pullRequestsOf: () => {
        return [];
      },
    });

    const { notes } = await generate(github);

    expect(
      github.requests.filter((url) => {
        return url.includes("/compare/");
      }),
    ).toHaveLength(4);
    expect(
      github.requests.filter((url) => {
        return url.endsWith("/graphql");
      }),
    ).toHaveLength(8);
    expect(notes).toContain("**389 changes since");
  });

  test("an empty range is an empty release, not a failure", async () => {
    const { notes } = await generate(
      fakeGitHub({ releases: RELEASES, commits: [], pullRequestsOf }),
    );

    expect(notes).toContain("No changes since");
  });

  test.each([
    ["a 503", 503],
    ["a 502", 502],
    ["a rate limit", 429],
    ["a secondary rate limit", 403],
  ])("waits out %s", async (_label, status) => {
    const { notes, sleep } = await generate(
      fakeGitHub({
        releases: RELEASES,
        commits: COMMITS,
        pullRequestsOf,
        failures: [status, status],
      }),
    );

    expect(notes).toContain("(#5463)");
    expect(sleep.mock.calls).toEqual([[5000], [15000]]);
  });

  test("waits out a connection that fails", async () => {
    const { notes } = await generate(
      fakeGitHub({
        releases: RELEASES,
        commits: COMMITS,
        pullRequestsOf,
        failures: [new TypeError("fetch failed")],
      }),
    );

    expect(notes).toContain("(#5463)");
  });

  test("waits out a GraphQL answer with no data", async () => {
    const answers = [
      answer(200, { errors: [{ message: "Something went wrong" }] }),
    ];
    const github = fakeGitHub({
      releases: RELEASES,
      commits: COMMITS,
      pullRequestsOf,
    });

    const { notes } = await generate(
      {
        fetcher: (url, init) => {
          if (url.endsWith("/graphql") && answers.length > 0) {
            return Promise.resolve(answers.shift());
          }
          return github.fetcher(url, init);
        },
      },
      {},
    );

    expect(notes).toContain("(#5463)");
  });

  test("reads the commits GitHub could find when it cannot find one", async () => {
    const data = {
      repository: {
        commit0: {
          associatedPullRequests: {
            nodes: [pullRequest(5463, "feat(forms): found")],
          },
        },
        commit1: null,
      },
    };
    const github = fakeGitHub({
      releases: RELEASES,
      commits: COMMITS.slice(0, 2),
      pullRequestsOf,
    });

    const { notes } = await generate({
      fetcher: (url, init) => {
        if (url.endsWith("/graphql")) {
          return Promise.resolve(
            answer(200, { data, errors: [{ type: "NOT_FOUND" }] }),
          );
        }
        return github.fetcher(url, init);
      },
    });

    expect(notes).toContain("(#5463)");
  });

  test("a pull request GitHub holds back is a failure, not a commit pushed to master", async () => {
    // Without pull-requests: read, GraphQL answers with data, every commit's
    // pull requests null in it, and an error beside them. Read as an answer,
    // that would list every commit of every branch.
    const data = {
      repository: { commit0: { associatedPullRequests: null } },
    };
    const github = fakeGitHub({
      releases: RELEASES,
      commits: COMMITS.slice(0, 1),
      pullRequestsOf,
    });

    await expect(
      generate({
        fetcher: (url, init) => {
          if (url.endsWith("/graphql")) {
            return Promise.resolve(
              answer(200, {
                data,
                errors: [
                  {
                    type: "FORBIDDEN",
                    message: "Resource not accessible by integration",
                  },
                ],
              }),
            );
          }
          return github.fetcher(url, init);
        },
      }),
    ).rejects.toThrow("Resource not accessible by integration");
  });

  test("does not wait for what cannot change", async () => {
    await expect(
      generate(
        fakeGitHub({
          releases: RELEASES,
          commits: COMMITS,
          pullRequestsOf,
          failures: [404],
        }),
      ),
    ).rejects.toThrow("answered 404");
  });

  test("gives up after its last wait, and says why", async () => {
    await expect(
      generate(
        fakeGitHub({
          releases: RELEASES,
          commits: COMMITS,
          pullRequestsOf,
          failures: [503, 503, 503, 503],
        }),
      ),
    ).rejects.toThrow("answered 503");
  });

  describe("--fallback-on-error", () => {
    let warnings;

    beforeEach(() => {
      warnings = jest.spyOn(console, "log").mockImplementation(() => {
        return undefined;
      });
    });

    afterEach(() => {
      warnings.mockRestore();
    });

    test("a GitHub that stays down leaves a release with a page and a warning", async () => {
      const { notes, sleep } = await generate(
        fakeGitHub({
          releases: RELEASES,
          commits: COMMITS,
          pullRequestsOf,
          failures: [503, 503, 503, 503],
        }),
        { fallbackOnError: true },
      );

      expect(notes).toContain(
        "https://github.com/OneUptime/oneuptime/commits/14.0.99",
      );
      expect(sleep).toHaveBeenCalledTimes(3);
      expect(warnings.mock.calls[0][0]).toMatch(
        /^::warning title=Release notes::The notes of 14\.0\.99 could not be written/,
      );
    });

    test("no token is no reason to hold a release back either", async () => {
      const { notes } = await generate(
        fakeGitHub({ releases: RELEASES, commits: [], pullRequestsOf }),
        { fallbackOnError: true },
        { token: undefined },
      );

      expect(notes).toContain("**Full changelog:**");
    });

    test("no previous release is no reason either", async () => {
      const { notes } = await generate(
        fakeGitHub({ releases: [], commits: [], pullRequestsOf }),
        { fallbackOnError: true },
      );

      expect(notes).toContain("**Full changelog:**");
      expect(warnings.mock.calls[0][0]).toContain(
        "No published release is older than 14.0.99",
      );
    });

    test("names the comparison when it got as far as finding it", async () => {
      const github = fakeGitHub({
        releases: RELEASES,
        commits: COMMITS,
        pullRequestsOf,
      });

      const { notes } = await generate(
        {
          fetcher: (url, init) => {
            return url.endsWith("/graphql")
              ? Promise.resolve(answer(503, {}))
              : github.fetcher(url, init);
          },
        },
        { fallbackOnError: true },
      );

      expect(notes).toContain("/compare/14.0.98...14.0.99");
    });

    test("keeps its warning to the one line a workflow command is", async () => {
      await generate(
        fakeGitHub({
          releases: RELEASES,
          commits: COMMITS,
          pullRequestsOf,
          failures: Array.from({ length: 4 }, () => {
            return new Error("first line\nsecond line, 100% sure");
          }),
        }),
        { fallbackOnError: true },
      );

      expect(warnings.mock.calls[0][0]).toContain(
        "first line%0Asecond line, 100%25 sure",
      );
      expect(warnings.mock.calls[0][0]).not.toContain("\n");
    });

    test("names the comparison when it was told what to compare with", async () => {
      const { notes } = await generate(
        fakeGitHub({
          releases: RELEASES,
          commits: COMMITS,
          pullRequestsOf,
          failures: [503, 503, 503, 503],
        }),
        { fallbackOnError: true, from: "14.0.98" },
      );

      expect(notes).toContain("/compare/14.0.98...14.0.99");
    });
  });
});

describe("the command line", () => {
  test("reads its defaults from the run", () => {
    expect(
      parseArguments([], {
        GITHUB_SHA: BUILT_COMMIT,
        GITHUB_REPOSITORY: "someone/fork",
      }),
    ).toEqual({
      version: null,
      from: null,
      to: BUILT_COMMIT,
      repository: "someone/fork",
      output: null,
      fallbackOnError: false,
    });
  });

  test("defaults to this repository, for a run on a laptop", () => {
    expect(parseArguments([], {}).repository).toBe(REPOSITORY);
    expect(parseArguments([], {}).to).toBeNull();
  });

  test("reads every option", () => {
    expect(
      parseArguments(
        [
          "--version",
          "14.0.99",
          "--from",
          "14.0.97",
          "--to",
          "master",
          "--repo",
          "someone/fork",
          "--output",
          "notes.md",
          "--fallback-on-error",
        ],
        {},
      ),
    ).toEqual({
      version: "14.0.99",
      from: "14.0.97",
      to: "master",
      repository: "someone/fork",
      output: "notes.md",
      fallbackOnError: true,
    });
  });

  test.each([
    [["--nonsense"], "Unknown or incomplete option: --nonsense"],
    [["--version"], "Unknown or incomplete option: --version"],
    [["--repo", "not a repository"], "is not an owner/name repository"],
  ])("refuses %j", (argumentList, message) => {
    expect(() => {
      return parseArguments(argumentList, {});
    }).toThrow(message);
  });

  describe("as the release job runs it", () => {
    let directory;
    let output;

    const runScript = (extraArguments) => {
      const environment = { ...process.env };
      delete environment.GH_TOKEN;
      delete environment.GITHUB_TOKEN;

      return spawnSync(
        process.execPath,
        [SCRIPT, "--version", "14.0.99", ...extraArguments],
        { encoding: "utf8", env: environment },
      );
    };

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-notes-"));
      output = path.join(directory, "notes.md");
    });

    afterEach(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    test("exits cleanly and writes the file, with --fallback-on-error", () => {
      const result = runScript(["--output", output, "--fallback-on-error"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("::warning title=Release notes::");
      expect(fs.readFileSync(output, "utf8")).toContain("**Full changelog:**");
    });

    test("fails loudly without it, for someone at a terminal", () => {
      const result = runScript(["--output", output]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "GenerateReleaseNotes: Set GH_TOKEN or GITHUB_TOKEN",
      );
      expect(fs.existsSync(output)).toBe(false);
    });
  });
});

describe("release.yml writes the notes of each release", () => {
  const workflows = fs
    .readdirSync(path.join(REPO_ROOT, ".github", "workflows"))
    .map((file) => {
      return fs.readFileSync(
        path.join(REPO_ROOT, ".github", "workflows", file),
        "utf8",
      );
    });

  const release = yaml.load(
    fs.readFileSync(
      path.join(REPO_ROOT, ".github", "workflows", "release.yml"),
      "utf8",
    ),
  );
  const job = release.jobs["draft-github-release"];
  const steps = job.steps;
  const noteStep = steps.findIndex((step) => {
    return /GenerateReleaseNotes\.js/.test(step.run || "");
  });
  const drafts = steps.filter((step) => {
    return /^ncipollo\/release-action@/.test(step.uses || "");
  });

  test("finds the step and the draft's three attempts (the checks below are not vacuous)", () => {
    expect(noteStep).toBeGreaterThanOrEqual(0);
    expect(drafts).toHaveLength(3);
  });

  test("nothing works out a release's range from its tags any more", () => {
    workflows.forEach((workflow) => {
      expect(workflow).not.toContain("release-changelog-builder-action");
      expect(workflow).not.toContain("ChangelogConfig.json");
    });
  });

  test("the notes end at the commit this run built", () => {
    expect(steps[noteStep].run).toContain('--to "$GITHUB_SHA"');
  });

  test("they are this release's notes", () => {
    expect(steps[noteStep].run).toContain('--version "$VERSION"');
    expect(steps[noteStep].env.VERSION).toBe(
      "${{ needs.read-version.outputs.major_minor }}",
    );
  });

  test("the step can read the repository", () => {
    expect(steps[noteStep].env.GH_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}");
    expect(job.permissions["pull-requests"]).toBe("read");
    expect(job.permissions.contents).toBe("write");
  });

  test("a release is not held back for its notes", () => {
    expect(steps[noteStep].run).toContain("--fallback-on-error");
  });

  test("the script comes from the commit the run built", () => {
    expect(steps[0].uses).toMatch(/^actions\/checkout@/);
    expect(steps[0].with).toBeUndefined();
  });

  test("every attempt at the draft reads the file the step wrote, and nothing else", () => {
    expect(steps[noteStep].run).toContain(
      '--output "$RUNNER_TEMP/release-notes.md"',
    );

    drafts.forEach((step) => {
      expect(steps.indexOf(step)).toBeGreaterThan(noteStep);
      expect(step.with.bodyFile).toBe("${{ runner.temp }}/release-notes.md");
      expect(step.with.body).toBeUndefined();
    });
  });

  test("the run's summary shows the notes", () => {
    expect(steps[noteStep].run).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });

  test("a title never reaches a shell or an expression", () => {
    // ${{ }} is spliced into the script Actions runs: a title that held a
    // quote, or a line of its own saying EOF, broke the steps this replaced.
    expect(JSON.stringify(steps)).not.toMatch(/changelog/i);
  });
});
