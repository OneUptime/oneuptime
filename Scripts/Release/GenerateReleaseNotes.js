#!/usr/bin/env node

/*
 * Writes the notes of a GitHub release from what it ships: every pull request
 * and every commit pushed straight to master between the last published
 * release and the commit being released, sorted by what they mean to the
 * person reading the release page.
 *
 * Nobody labels pull requests here, so the sorting is done from their titles,
 * which the repository writes in two ways. `feat(exceptions): saved views`
 * names its section and its area outright; `Security Events: playbooks that
 * branch` names only its area, and lands under New and improved unless its
 * words say otherwise. A label wins over a title (SECTION_OF_LABEL), the
 * `ignore` label leaves a pull request out, and a `!` after the type or scope
 * (`feat(helm)!: ...`) puts it under Breaking changes.
 *
 * The range is always named: the end is the commit the run built, and the
 * start is the newest published release older than this one. Nothing is worked
 * out from the newest tag, because a draft has no tag: that is how each
 * release's page came to list the release before it.
 *
 * Usage, here or on a published release whose notes need writing again:
 *
 *   GH_TOKEN=$(gh auth token) node Scripts/Release/GenerateReleaseNotes.js \
 *     --version 14.0.98 --output notes.md
 *   gh release edit 14.0.98 --notes-file notes.md
 *
 * With --to master and no --version, it shows what the next release will say.
 *
 * Options:
 *   --version <x.y.z>    the release (default: the VERSION file)
 *   --to <ref>           the commit it is built from (default: GITHUB_SHA,
 *                        else the release's tag)
 *   --from <tag>         the release to compare it with (default: the newest
 *                        published release older than --version)
 *   --repo <owner/name>  the repository (default: GITHUB_REPOSITORY, else
 *                        OneUptime/oneuptime)
 *   --output <path>      where to write the notes (default: standard output)
 *   --fallback-on-error  when GitHub cannot be read, warn and write notes that
 *                        link to the changes, rather than fail. The release
 *                        job passes this: a release that has spent 90 minutes
 *                        building is not held back for its notes
 */

const fs = require("fs");
const path = require("path");

const GITHUB_API = "https://api.github.com";
const UPGRADE_GUIDE = "https://oneuptime.com/docs/installation/upgrading";
const DEFAULT_REPOSITORY = "OneUptime/oneuptime";
const VERSION_FILE = path.join(__dirname, "..", "..", "VERSION");

// GitHub refuses a release body over 125,000 characters. A release that does
// that fails the draft step, so the notes stop short of it (assembleNotes).
const MAX_NOTES_LENGTH = 120000;

const COMMITS_PER_QUERY = 50;
const REQUEST_TIMEOUT_IN_MS = 60000;
const RETRY_DELAYS_IN_MS = [5000, 15000, 30000];

const PLAIN_VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/*
 * In the order a reader wants them. Maintenance is folded: it is there for
 * anyone who wants all of it, and it is nothing a person using OneUptime sees.
 */
const SECTIONS = [
  {
    key: "breaking",
    title: "⚠️ Breaking changes",
    one: "breaking change",
    many: "breaking changes",
  },
  {
    key: "features",
    title: "✨ New and improved",
    one: "new or improved feature",
    many: "new or improved features",
  },
  {
    key: "fixes",
    title: "🐛 Bug fixes",
    one: "bug fix",
    many: "bug fixes",
  },
  {
    key: "performance",
    title: "⚡ Performance",
    one: "performance improvement",
    many: "performance improvements",
  },
  {
    key: "docs",
    title: "📚 Documentation",
    one: "documentation update",
    many: "documentation updates",
  },
  {
    key: "maintenance",
    title: "🧰 Maintenance",
    one: "maintenance change",
    many: "maintenance changes",
    folded: true,
  },
];

// Maps, here and below: a title can start with any word, "constructor" too.
const SECTION_OF_TYPE = new Map([
  ["feat", "features"],
  ["feature", "features"],
  ["fix", "fixes"],
  ["bug", "fixes"],
  ["bugfix", "fixes"],
  ["hotfix", "fixes"],
  ["revert", "fixes"],
  ["perf", "performance"],
  ["performance", "performance"],
  ["doc", "docs"],
  ["docs", "docs"],
  ["documentation", "docs"],
  ["build", "maintenance"],
  ["chore", "maintenance"],
  ["ci", "maintenance"],
  ["dependencies", "maintenance"],
  ["deps", "maintenance"],
  ["refactor", "maintenance"],
  ["style", "maintenance"],
  ["test", "maintenance"],
  ["tests", "maintenance"],
]);

const SECTION_OF_LABEL = new Map([
  ["bug", "fixes"],
  ["dependencies", "maintenance"],
  ["documentation", "docs"],
  ["enhancement", "features"],
  ["feature", "features"],
  ["fix", "fixes"],
  ["test", "maintenance"],
]);

const LEFT_OUT_LABEL = "ignore";

/*
 * Areas of the repository, not of the product: `fix(ci): ...` mends the
 * pipeline, and nothing a person using OneUptime has noticed. `workflows` is
 * not here: that is a product.
 */
const INTERNAL_AREAS = new Set([
  "build",
  "ci",
  "deps",
  "dev",
  "e2e",
  "gha",
  "lint",
  "ops",
  "release",
  "test",
  "tests",
]);

// Spellings of an area that a title's words would not arrive at on their own.
const AREA_NAMES = new Map([
  ["alert", "Alerts"],
  ["clickhouse", "ClickHouse"],
  ["dashboard", "Dashboards"],
  ["ee", "Enterprise"],
  ["github", "GitHub"],
  ["gitlab", "GitLab"],
  ["graphql", "GraphQL"],
  ["home", "Website"],
  ["i18n", "Translations"],
  ["incident", "Incidents"],
  ["iot", "IoT"],
  ["k8s", "Kubernetes"],
  ["mobile", "Mobile App"],
  ["mobile app", "Mobile App"],
  ["monitor", "Monitors"],
  ["on-call", "On-Call"],
  ["opentelemetry", "OpenTelemetry"],
  ["runner", "Runners"],
  ["security events", "Security"],
  ["security-events", "Security"],
  ["self-hosted", "Self-Hosted"],
  ["status-page", "Status Pages"],
  ["status page", "Status Pages"],
  ["vmware", "VMware"],
  ["workflow", "Workflows"],
]);

const UPPERCASE_WORDS = new Set([
  "ai",
  "api",
  "ci",
  "cli",
  "e2e",
  "llm",
  "mcp",
  "scim",
  "seo",
  "sms",
  "sso",
  "ui",
]);

const LOWERCASE_WORDS = new Set(["kubectl", "npm"]);

const CONVENTIONAL_TITLE = /^([a-z][a-z0-9]*)(?:\(([^)]*)\))?(!)?:\s+(.+)$/i;
const AREA_TITLE = /^([^:]{2,40}): (.+)$/;
const NOT_AN_AREA = /[,()[\]"'`#]/;
const WORDS_OF_A_FOLLOW_UP = /(^|\s+)(follow-ups?|next)$/i;
const OPENS_LIKE_A_FIX = /^(fix|fixes|fixed|revert)\b/i;
const MAX_WORDS_IN_AN_AREA = 3;

// The pull request `release` is gated on is not a change: everything in it is
// listed already. Any other pull request into `release` is a hotfix.
const RELEASE_GATE_TITLE = /^release\b/i;
const VERSION_BUMP = /^chore(\([^)]*\))?: bump version\b/i;

function parseVersion(tag) {
  const match = PLAIN_VERSION.exec(tag);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

// The newest release a reader has seen before this one. A draft or prerelease
// has been seen by nobody, and an unfinished run leaves drafts behind.
function findPreviousRelease(releases, version) {
  const current = parseVersion(version);
  if (!current) {
    throw new Error(`"${version}" is not a release version`);
  }

  let previous = null;
  for (const release of releases) {
    const parsed = parseVersion(release.tag_name);
    if (
      parsed &&
      !release.draft &&
      !release.prerelease &&
      compareVersions(parsed, current) < 0 &&
      (!previous || compareVersions(parsed, previous.parsed) > 0)
    ) {
      previous = { tag: release.tag_name, parsed };
    }
  }

  return previous ? previous.tag : null;
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function nameOfArea(area) {
  const key = area.toLowerCase();
  if (AREA_NAMES.has(key)) {
    return AREA_NAMES.get(key);
  }
  if (area !== key) {
    // Someone chose these capitals: "UI polish", "Security Events".
    return area;
  }
  return key
    .split(/[-\s]+/)
    .map((word) => {
      return UPPERCASE_WORDS.has(word) ? word.toUpperCase() : capitalize(word);
    })
    .join(" ");
}

function partsOfArea(area) {
  return area
    .split(",")
    .map((part) => {
      return part.trim();
    })
    .filter(Boolean);
}

function areaName(area) {
  return partsOfArea(area).map(nameOfArea).join(", ");
}

function isInternalArea(area) {
  const parts = partsOfArea(area);
  return (
    parts.length > 0 &&
    parts.every((part) => {
      return INTERNAL_AREAS.has(part.toLowerCase());
    })
  );
}

function isAreaName(words) {
  return (
    !NOT_AN_AREA.test(words) &&
    words.split(/\s+/).length <= MAX_WORDS_IN_AN_AREA
  );
}

/*
 * What a title says, as { section, area, text, breaking }. A title that fits
 * neither form keeps every word and has no area: the notes would rather show
 * it as it was written than guess.
 */
function parseTitle(title) {
  const cleaned = title.replace(/\s+/g, " ").trim();
  const sectionOfWords = OPENS_LIKE_A_FIX.test(cleaned) ? "fixes" : "features";

  const conventional = CONVENTIONAL_TITLE.exec(cleaned);
  if (conventional) {
    const [, type, scope, breaking, text] = conventional;
    const section = SECTION_OF_TYPE.get(type.toLowerCase());
    if (section) {
      return {
        section: scope && isInternalArea(scope) ? "maintenance" : section,
        area: scope ? areaName(scope) : null,
        text,
        breaking: Boolean(breaking),
      };
    }
  }

  const named = AREA_TITLE.exec(cleaned);
  if (named && isAreaName(named[1])) {
    const area = named[1].replace(WORDS_OF_A_FOLLOW_UP, "");
    return {
      section: isInternalArea(area) ? "maintenance" : sectionOfWords,
      area: area ? areaName(area) : null,
      text: named[2],
      breaking: false,
    };
  }

  return {
    section: sectionOfWords,
    area: null,
    text: cleaned,
    breaking: false,
  };
}

function sectionOf(parsed, labels) {
  if (parsed.breaking) {
    return "breaking";
  }

  const labelled = labels
    .map((label) => {
      return SECTION_OF_LABEL.get(label.toLowerCase());
    })
    .find(Boolean);

  return labelled || parsed.section;
}

// Titles are lower case after their prefix; "iOS" and "npm" stay as they are.
function startSentence(text) {
  const firstWord = text.split(" ")[0];
  const plainWord = /^[a-z][a-z'-]*[,:;]?$/.test(firstWord);

  if (!plainWord || LOWERCASE_WORDS.has(firstWord.replace(/[,:;]$/, ""))) {
    return text;
  }
  return capitalize(text);
}

function escapeWord(word) {
  /*
   * A code span, because GitHub reads anything else in these as markup:
   * `/install/<agent>` loses `<agent>` as an unknown tag, and `@hono/node-server`
   * mentions whoever holds the name.
   */
  if (word.includes("<") || /(^|\W)@\w/.test(word)) {
    return `\`${word}\``;
  }
  return word.replace(/[\\*~[\]]|(?<![a-z0-9])_|_(?![a-z0-9])/gi, "\\$&");
}

// A title is text, whatever it looks like; only its code spans stay as written.
function escapeMarkdown(text) {
  return text
    .split(/(`[^`]+`)/)
    .map((piece, index) => {
      if (index % 2 === 1) {
        return piece;
      }
      return piece.split(/(\s+)/).map(escapeWord).join("");
    })
    .join("");
}

function isReleaseGate(pullRequest) {
  return (
    pullRequest.baseRefName === "release" &&
    RELEASE_GATE_TITLE.test(pullRequest.title)
  );
}

/*
 * Sorts the commits of a release into the pull requests that brought them and
 * the commits pushed straight to master. GitHub answers a commit pushed to
 * master with the gate pull request that later carried it, so the gate is no
 * answer at all: those commits are the ones the notes must not lose (fixes
 * made on master just before a cut). The version bump and merges of branches
 * into each other change nothing of their own.
 */
function sortChanges(commits, pullRequestsOfCommits) {
  const pullRequests = new Map();
  const directCommits = [];

  for (const commit of commits) {
    const merged = (pullRequestsOfCommits.get(commit.sha) || []).filter(
      (pullRequest) => {
        return pullRequest.merged && !isReleaseGate(pullRequest);
      },
    );

    if (merged.length > 0) {
      for (const pullRequest of merged) {
        pullRequests.set(pullRequest.number, pullRequest);
      }
    } else if (
      commit.parents.length < 2 &&
      !VERSION_BUMP.test(subjectOf(commit))
    ) {
      directCommits.push(commit);
    }
  }

  return {
    pullRequests: [...pullRequests.values()].sort((left, right) => {
      return left.number - right.number;
    }),
    directCommits,
  };
}

function subjectOf(commit) {
  return commit.commit.message.split("\n")[0];
}

function labelsOf(pullRequest) {
  return pullRequest.labels.nodes.map((label) => {
    return label.name;
  });
}

function entryOf(title, labels, reference) {
  const parsed = parseTitle(title);
  return {
    section: sectionOf(parsed, labels),
    area: parsed.area,
    text: parsed.text,
    reference,
  };
}

function buildEntries({ pullRequests, directCommits }, repository) {
  const entries = pullRequests
    .filter((pullRequest) => {
      return !labelsOf(pullRequest).includes(LEFT_OUT_LABEL);
    })
    .map((pullRequest) => {
      return entryOf(
        pullRequest.title,
        labelsOf(pullRequest),
        `#${pullRequest.number}`,
      );
    });

  const seen = new Set();
  for (const commit of directCommits) {
    const subject = subjectOf(commit);
    // A fix made on master and picked onto `release` is one change.
    if (!seen.has(subject)) {
      seen.add(subject);
      const url = `https://github.com/${repository}/commit/${commit.sha}`;
      entries.push(entryOf(subject, [], `[${commit.sha.slice(0, 7)}](${url})`));
    }
  }

  return entries;
}

// The people to thank, by login. GitHub shows their avatars under the notes.
function findContributors({ pullRequests, directCommits }) {
  const logins = new Set();

  for (const { author } of pullRequests) {
    if (author && author.__typename !== "Bot") {
      logins.add(author.login);
    }
  }
  for (const { author } of directCommits) {
    if (author && author.type !== "Bot") {
      logins.add(author.login);
    }
  }

  return [...logins]
    .filter((login) => {
      return !login.endsWith("[bot]");
    })
    .sort((left, right) => {
      return left.localeCompare(right);
    });
}

function renderEntry(entry) {
  return `${escapeMarkdown(startSentence(entry.text))} (${entry.reference})`;
}

// The busiest area comes first, and an area of one needs no list of its own.
function renderEntries(entries) {
  const areas = new Map();
  const withoutAnArea = [];

  for (const entry of entries) {
    if (entry.area) {
      const key = entry.area.toLowerCase();
      if (!areas.has(key)) {
        areas.set(key, { name: entry.area, entries: [] });
      }
      areas.get(key).entries.push(entry);
    } else {
      withoutAnArea.push(entry);
    }
  }

  const lines = [];
  const ordered = [...areas.values()].sort((left, right) => {
    return (
      right.entries.length - left.entries.length ||
      left.name.localeCompare(right.name)
    );
  });

  for (const area of ordered) {
    const name = escapeMarkdown(area.name);
    if (area.entries.length === 1) {
      lines.push(`- **${name}:** ${renderEntry(area.entries[0])}`);
    } else {
      lines.push(`- **${name}**`);
      for (const entry of area.entries) {
        lines.push(`  - ${renderEntry(entry)}`);
      }
    }
  }
  for (const entry of withoutAnArea) {
    lines.push(`- ${renderEntry(entry)}`);
  }

  return lines.join("\n");
}

function renderSection(section, entries) {
  const list = renderEntries(entries);
  if (section.folded) {
    const summary = `${section.title} (${entries.length})`;
    return `<details>\n<summary>${summary}</summary>\n\n${list}\n\n</details>`;
  }
  return `## ${section.title}\n\n${list}`;
}

function joinInWords(items) {
  if (items.length < 2) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function busiestAreas(entries) {
  const counts = new Map();
  for (const { area } of entries) {
    if (area) {
      counts.set(area, (counts.get(area) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => {
      return count > 1;
    })
    .sort((left, right) => {
      return right[1] - left[1] || left[0].localeCompare(right[0]);
    })
    .slice(0, 3)
    .map(([area]) => {
      return escapeMarkdown(area);
    });
}

function renderSummary({ entries, previous, repository }) {
  const since = `[${previous}](https://github.com/${repository}/releases/tag/${previous})`;

  if (entries.length === 0) {
    return `No changes since ${since}.`;
  }

  const counts = SECTIONS.map((section) => {
    const count = entries.filter((entry) => {
      return entry.section === section.key;
    }).length;
    return { count, section };
  })
    .filter(({ count }) => {
      return count > 0;
    })
    .map(({ count, section }) => {
      return `${count} ${count === 1 ? section.one : section.many}`;
    });

  const changes =
    entries.length === 1 ? "1 change" : `${entries.length} changes`;
  const summary = `**${changes} since ${since}:** ${joinInWords(counts)}.`;

  const areas = busiestAreas(
    entries.filter((entry) => {
      return entry.section !== "maintenance";
    }),
  );
  return areas.length > 1
    ? `${summary} The busiest areas: ${joinInWords(areas)}.`
    : summary;
}

function renderUpgrade(version) {
  const major = /^\d+\.0\.0$/.test(version)
    ? `This is a new major version: read [what it asks of you](${UPGRADE_GUIDE}#find-the-notes-for-your-version) first, and upgrade one major version at a time.\n\n`
    : "";

  return (
    `## ⬆️ Upgrade\n\n${major}Back up first, then follow the [upgrade guide](${UPGRADE_GUIDE}). ` +
    `On Docker Compose, run \`npm run update\` on the \`release\` branch. ` +
    `On Kubernetes, \`helm upgrade\` to version \`${version}\` of the chart.`
  );
}

/*
 * Keeps the notes within what GitHub takes. Maintenance goes first, since
 * nobody reads it for what changed for them; only then are the changes cut,
 * and what closes the notes (the way to the full list) always stays.
 */
function assembleNotes({ changes, folded, closing }) {
  const join = (blocks) => {
    return blocks.filter(Boolean).join("\n\n");
  };

  const whole = join([...changes, folded, ...closing]);
  if (whole.length <= MAX_NOTES_LENGTH) {
    return whole;
  }

  const note =
    "_These notes are too long for GitHub. The full changelog below has the rest._";
  const shorter = join([...changes, note, ...closing]);
  if (shorter.length <= MAX_NOTES_LENGTH) {
    return shorter;
  }

  const end = join([note, ...closing]);
  const room = MAX_NOTES_LENGTH - end.length - 2;
  const start = join(changes).slice(0, room);
  return `${start.slice(0, start.lastIndexOf("\n"))}\n\n${end}`;
}

function renderNotes({ version, previous, repository, entries, contributors }) {
  const sectionsWithEntries = SECTIONS.map((section) => {
    return {
      section,
      entries: entries.filter((entry) => {
        return entry.section === section.key;
      }),
    };
  }).filter((group) => {
    return group.entries.length > 0;
  });

  const rendered = sectionsWithEntries.map((group) => {
    return { ...group, text: renderSection(group.section, group.entries) };
  });
  const textsOf = (groups) => {
    return groups.map((group) => {
      return group.text;
    });
  };

  return assembleNotes({
    changes: [
      renderSummary({ entries, previous, repository }),
      ...textsOf(
        rendered.filter((group) => {
          return !group.section.folded;
        }),
      ),
    ],
    folded: textsOf(
      rendered.filter((group) => {
        return group.section.folded;
      }),
    ).join("\n\n"),
    closing: [
      renderUpgrade(version),
      `**Full changelog:** https://github.com/${repository}/compare/${previous}...${version}`,
      contributors.length > 0
        ? `**Contributors:** ${contributors
            .map((login) => {
              return `@${login}`;
            })
            .join(", ")}`
        : "",
    ],
  });
}

// What a release gets when GitHub could not be read: never an empty page.
function renderFallbackNotes({ version, previous, repository }) {
  const changes = previous
    ? `https://github.com/${repository}/compare/${previous}...${version}`
    : `https://github.com/${repository}/commits/${version}`;

  return `**Full changelog:** ${changes}\n\n${renderUpgrade(version)}`;
}

function sleepFor(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function canSucceedLater(status) {
  // A 403 is how GitHub says a secondary rate limit, as well as no.
  return status === 403 || status === 408 || status === 429 || status >= 500;
}

/*
 * The two calls the notes need, each repeated on what is likely to pass by:
 * the draft job died on a 503 on 2026-08-17 with every image already pushed.
 */
function createGitHub({ token, fetcher, sleep }) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "OneUptime-Release-Notes",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  async function send(url, init, readAnswer) {
    let failure = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_IN_MS.length; attempt += 1) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS_IN_MS[attempt - 1]);
      }

      try {
        const response = await fetcher(url, {
          ...init,
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_IN_MS),
        });

        if (response.ok) {
          return readAnswer(await response.json());
        }

        failure = new Error(
          `${url} answered ${response.status}: ${await response.text()}`,
        );
        if (!canSucceedLater(response.status)) {
          throw Object.assign(failure, { permanent: true });
        }
      } catch (error) {
        if (error.permanent) {
          throw error;
        }
        failure = error;
      }
    }

    throw failure;
  }

  return {
    rest(route) {
      return send(`${GITHUB_API}${route}`, { method: "GET" }, (answer) => {
        return answer;
      });
    },

    graphql(query) {
      return send(
        `${GITHUB_API}/graphql`,
        { method: "POST", body: JSON.stringify({ query }) },
        (answer) => {
          // A commit GitHub cannot find is one line less. Anything else it
          // held back would read as commits that no pull request brought.
          const refused = (answer.errors || []).filter((error) => {
            return error.type !== "NOT_FOUND";
          });
          if (!answer.data || refused.length > 0) {
            throw new Error(
              `GraphQL answered ${JSON.stringify(answer.errors)}`,
            );
          }
          return answer.data;
        },
      );
    },
  };
}

async function listCommits(github, repository, from, to) {
  const commits = [];
  const range = `${encodeURIComponent(from)}...${encodeURIComponent(to)}`;

  for (let page = 1; ; page += 1) {
    const comparison = await github.rest(
      `/repos/${repository}/compare/${range}?per_page=100&page=${page}`,
    );
    commits.push(...comparison.commits);

    if (
      comparison.commits.length === 0 ||
      commits.length >= comparison.total_commits
    ) {
      return commits;
    }
  }
}

function pullRequestsQuery(repository, shas) {
  const [owner, name] = repository.split("/");

  const commits = shas.map((sha, index) => {
    return `commit${index}: object(oid: "${sha}") {
      ... on Commit {
        associatedPullRequests(first: 5) {
          nodes {
            number
            title
            merged
            baseRefName
            author { __typename login }
            labels(first: 20) { nodes { name } }
          }
        }
      }
    }`;
  });

  return `query {
    repository(owner: "${owner}", name: "${name}") {
      ${commits.join("\n")}
    }
  }`;
}

/*
 * By commit rather than from "Merge pull request #N" in a subject: this reads
 * the same for a merge, a squash or a rebase, and a subject that mentions
 * another pull request names nothing here.
 */
async function findPullRequestsOfCommits(github, repository, commits) {
  const found = new Map();

  for (let start = 0; start < commits.length; start += COMMITS_PER_QUERY) {
    const shas = commits
      .slice(start, start + COMMITS_PER_QUERY)
      .map((commit) => {
        return commit.sha;
      });
    const data = await github.graphql(pullRequestsQuery(repository, shas));

    shas.forEach((sha, index) => {
      const commit = data.repository ? data.repository[`commit${index}`] : null;
      found.set(
        sha,
        commit && commit.associatedPullRequests
          ? commit.associatedPullRequests.nodes
          : [],
      );
    });
  }

  return found;
}

async function findStartOfRange(github, repository, version) {
  const previous = findPreviousRelease(
    await github.rest(`/repos/${repository}/releases?per_page=100`),
    version,
  );

  if (!previous) {
    throw new Error(`No published release is older than ${version}`);
  }

  return previous;
}

async function generateReleaseNotes({
  github,
  repository,
  version,
  previous,
  to,
}) {
  const commits = await listCommits(github, repository, previous, to);
  const changes = sortChanges(
    commits,
    await findPullRequestsOfCommits(github, repository, commits),
  );

  return renderNotes({
    version,
    previous,
    repository,
    entries: buildEntries(changes, repository),
    contributors: findContributors(changes),
  });
}

// A workflow command is one line, and an answer from GitHub may be several.
function workflowCommandText(text) {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function parseArguments(argumentList, environment = process.env) {
  const options = {
    version: null,
    from: null,
    to: environment.GITHUB_SHA || null,
    repository: environment.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
    output: null,
    fallbackOnError: false,
  };
  const withValue = new Map([
    ["--version", "version"],
    ["--from", "from"],
    ["--to", "to"],
    ["--repo", "repository"],
    ["--output", "output"],
  ]);

  for (let index = 0; index < argumentList.length; index += 1) {
    const argument = argumentList[index];
    if (argument === "--fallback-on-error") {
      options.fallbackOnError = true;
    } else if (withValue.has(argument) && index + 1 < argumentList.length) {
      index += 1;
      options[withValue.get(argument)] = argumentList[index];
    } else {
      throw new Error(`Unknown or incomplete option: ${argument}`);
    }
  }

  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repository)) {
    throw new Error(`"${options.repository}" is not an owner/name repository`);
  }

  return options;
}

async function run(options, tools = {}) {
  const version =
    options.version || fs.readFileSync(VERSION_FILE, "utf8").trim();
  const github = createGitHub({
    token: tools.token,
    fetcher: tools.fetcher || fetch,
    sleep: tools.sleep || sleepFor,
  });
  const write =
    tools.write ||
    ((notes) => {
      if (options.output) {
        fs.writeFileSync(options.output, `${notes}\n`);
      } else {
        process.stdout.write(`${notes}\n`);
      }
    });

  // Kept apart so that a failure further on can still link to the comparison.
  let previous = options.from;

  try {
    if (!tools.token) {
      throw new Error("Set GH_TOKEN or GITHUB_TOKEN to read the repository");
    }

    previous =
      previous || (await findStartOfRange(github, options.repository, version));

    write(
      await generateReleaseNotes({
        github,
        repository: options.repository,
        version,
        previous,
        to: options.to || version,
      }),
    );
  } catch (error) {
    if (!options.fallbackOnError) {
      throw error;
    }

    console.log(
      `::warning title=Release notes::The notes of ${version} could not be written, so its release links to the changes instead. Write them again with Scripts/Release/GenerateReleaseNotes.js. ${workflowCommandText(error.message)}`,
    );
    write(
      renderFallbackNotes({
        version,
        previous,
        repository: options.repository,
      }),
    );
  }
}

async function main() {
  await run(parseArguments(process.argv.slice(2)), {
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`GenerateReleaseNotes: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  MAX_NOTES_LENGTH,
  assembleNotes,
  areaName,
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
};
