#!/usr/bin/env node

/*
 * Writes the notes of a Terraform provider release
 * (OneUptime/terraform-provider-oneuptime) from what it changes.
 *
 * Every release used to say the same thing, word for word, whatever it
 * shipped: a fixed list of features and "Resources Included", the install
 * block and a compare link (OneUptime/terraform-provider-oneuptime#19). The
 * notes now say what a person upgrading the provider needs to know:
 *
 *  - what breaks: a resource, data source or attribute that is gone, an
 *    attribute that is required now or can no longer be set, a type that
 *    changed, a value an attribute no longer takes;
 *  - what is new: resources and data sources, with their pages on the
 *    registry, and on the ones there were, new attributes and values;
 *  - OneUptime's changes to the provider itself, its pull requests in the
 *    `terraform` area, sorted as OneUptime's own release notes sort theirs
 *    (Scripts/Release/GenerateReleaseNotes.js);
 *  - how to install it, and where the whole comparison is.
 *
 * What changed comes from the provider's documentation at this release and
 * at the one before it. The generator writes a page for every resource and
 * data source, its schema included (Core/DocumentationGenerator.ts), so the
 * two pages of one say what changed in it. The pull requests come from
 * OneUptime's repository, between the commits the two releases were
 * generated from: each release's commit names its own in an OneUptime-Commit
 * trailer (publish-terraform-provider.sh writes it). For a release made
 * before there was one, the range starts at OneUptime's release of the
 * provider's previous version.
 *
 * Usage, in publish-terraform-provider.sh, or on a published release whose
 * notes need writing again:
 *
 *   git clone https://github.com/OneUptime/terraform-provider-oneuptime provider
 *   GH_TOKEN=$(gh auth token) node Scripts/TerraformProvider/GenerateReleaseNotes.js \
 *     --version 17.1.0 --provider-dir provider --previous v17.0.0 \
 *     --oneuptime-to 17.1.0 --output notes.md
 *   gh release edit v17.1.0 --repo OneUptime/terraform-provider-oneuptime --notes-file notes.md
 *
 * Options:
 *   --version <x.y.z>        the release (required)
 *   --provider-dir <path>    a clone of the provider's repository holding the
 *                            commits of this release and the one before it
 *                            (required)
 *   --ref <ref>              this release's commit (default: v<version>)
 *   --previous <tag>         the release it follows. Without it the notes say
 *                            there is none to compare it with
 *   --republish-of <tag>     the release whose provider this one publishes
 *                            again, unchanged (the publish script's
 *                            --republish-from)
 *   --oneuptime-to <ref>     the OneUptime commit this release was generated
 *                            from, when its commit names none
 *   --output <path>          where to write the notes (default: standard
 *                            output)
 *   --fallback-on-error      when GitHub cannot be read, warn and link to
 *                            OneUptime's changes instead. The publish script
 *                            passes it: a release is not held back for its
 *                            notes
 *
 * GH_TOKEN or GITHUB_TOKEN reads OneUptime's pull requests, through
 * GITHUB_API_URL (Actions sets it; https://api.github.com otherwise).
 * Without a token, or with no OneUptime commit to end the range at, the
 * notes leave OneUptime's pull requests out.
 *
 * Tests/Ops/TerraformProviderReleaseNotes.test.js tests all of it.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  MAX_NOTES_LENGTH,
  SECTIONS,
  assembleNotes,
  buildEntries,
  createGitHub,
  escapeMarkdown,
  findPullRequestsOfCommits,
  findStartOfRange,
  listCommits,
  parseTitle,
  partsOfArea,
  renderEntries,
  sleepFor,
  sortChanges,
} = require("../Release/GenerateReleaseNotes");

const PROVIDER_REPOSITORY = "OneUptime/terraform-provider-oneuptime";
const ONEUPTIME_REPOSITORY = "OneUptime/oneuptime";
const GITHUB_API = "https://api.github.com";
const REGISTRY = "https://registry.terraform.io/providers/oneuptime/oneuptime";
const OPENTOFU_REGISTRY =
  "https://search.opentofu.org/provider/oneuptime/oneuptime";
const TRAILER = "OneUptime-Commit";

/*
 * The areas of OneUptime's pull requests that are the provider's:
 * `fix(terraform): ...`, `Terraform: ...`, `feat(opentofu): ...`, as
 * GenerateReleaseNotes.js names them (areaName), in lower case.
 */
const PROVIDER_AREAS = new Set(["opentofu", "terraform", "terraform provider"]);

const PAGE_DIRECTORIES = [
  { directory: "docs/resources/", kind: "resource" },
  { directory: "docs/data-sources/", kind: "data source" },
];

const KIND_OF_GROUP = new Map([
  ["Required", "required"],
  ["Optional", "optional"],
  ["Read-Only", "read-only"],
]);

const PAGE_TITLE = /^# (\S+) \((Resource|Data Source)\)\s*$/m;
const ATTRIBUTE_LINE = /^- `([^`]+)` \(([^)]*)\)(.*)$/;
const NESTED_SCHEMA = /^### Nested Schema for `([^`]+)`\s*$/;
const TOP_LEVEL_GROUP = /^### (Required|Optional|Read-Only)\s*$/;
const NESTED_GROUP = /^(Required|Optional|Read-Only):\s*$/;
const RENAMED =
  /\*\*Renamed:\*\* this (?:resource|data source) was called `([^`]+)` before(\.|,)/;
const DEFAULT_VALUE = /Defaults to `([^`]*)`/g;
const ALLOWED_VALUES = "Allowed values:";
const FIRST_SENTENCE = /^(.+?(?<!\b(?:e\.g|i\.e|etc|vs))\.)(\s|$)/;
const MAX_DESCRIPTION_LENGTH = 200;
const COMMIT = /^[0-9a-f]{40}$/;

/*
 * ------------------------------------------------------------------
 * Reading the documentation
 * ------------------------------------------------------------------
 */

function kindOfPath(file) {
  const found = PAGE_DIRECTORIES.find(({ directory }) => {
    return file.startsWith(directory) && file.endsWith(".md");
  });
  return found ? found.kind : null;
}

// What the front matter says: `subcategory: "AI"`, `description: |-`.
function readFrontMatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
  const front = { subcategory: null, description: null };
  if (!match) {
    return front;
  }

  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const subcategory = /^subcategory:\s*"(.*)"\s*$/.exec(line);
    if (subcategory) {
      front.subcategory = subcategory[1] || null;
    }
    if (/^description:\s*\|-?\s*$/.test(line)) {
      const block = [];
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])) {
        index += 1;
        block.push(lines[index].trim());
      }
      front.description = block.join(" ") || null;
    }
  }
  return front;
}

/*
 * The values an attribute takes, from "Allowed values: `A`, `B`." at the
 * end of its line (the generator appends it from the schema); null when it
 * names none.
 */
function allowedValuesOf(description) {
  const start = description.lastIndexOf(ALLOWED_VALUES);
  if (start === -1) {
    return null;
  }

  const values = [];
  const value = /\s*`([^`]*)`(,?)/y;
  value.lastIndex = start + ALLOWED_VALUES.length;
  let match = value.exec(description);
  while (match) {
    values.push(match[1]);
    if (!match[2]) {
      break;
    }
    match = value.exec(description);
  }
  return values;
}

// The schema's default, "Defaults to `x`.", the last one on the line.
function defaultOf(description) {
  const matches = [...description.matchAll(DEFAULT_VALUE)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

function parseAttribute(line) {
  const match = ATTRIBUTE_LINE.exec(line);
  if (!match) {
    return null;
  }

  const [type, ...tags] = match[2].split(",").map((tag) => {
    return tag.trim();
  });
  const description = match[3].trim();
  return {
    name: match[1],
    type,
    sensitive: tags.includes("Sensitive"),
    deprecated: tags.includes("Deprecated"),
    allowedValues: allowedValuesOf(description),
    defaultValue: defaultOf(description),
  };
}

/*
 * A resource's or data source's attributes, from its page's Schema: the top
 * level's under "### Required", "### Optional" and "### Read-Only", and a
 * nested attribute's under "### Nested Schema for `a.b`", as a.b.name. Code
 * blocks are skipped: an example's comments start with "#" too.
 */
function parseSchema(markdown) {
  const attributes = new Map();
  let inSchema = false;
  let inCode = false;
  let nested = "";
  let kind = null;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      continue;
    }
    if (/^## /.test(line)) {
      inSchema = line.trim() === "## Schema";
      nested = "";
      kind = null;
      continue;
    }
    if (!inSchema) {
      continue;
    }

    const group = TOP_LEVEL_GROUP.exec(line);
    const nestedSchema = NESTED_SCHEMA.exec(line);
    const nestedGroup = NESTED_GROUP.exec(line);
    if (group) {
      nested = "";
      kind = KIND_OF_GROUP.get(group[1]);
    } else if (nestedSchema) {
      nested = nestedSchema[1];
      kind = null;
    } else if (/^### /.test(line)) {
      nested = "";
      kind = null;
    } else if (nestedGroup) {
      kind = nested ? KIND_OF_GROUP.get(nestedGroup[1]) : null;
    } else if (kind) {
      const attribute = parseAttribute(line);
      if (attribute) {
        const name = nested ? `${nested}.${attribute.name}` : attribute.name;
        attributes.set(name, { ...attribute, name, kind });
      }
    }
  }

  return attributes;
}

/*
 * A page as the notes read it: what it documents, what that does, and its
 * attributes. `renamedFrom` is the name it had before, and whether that
 * name still works ("The old name still works") or belongs to another
 * resource now ("..., a name another resource has now").
 */
function parsePage(file, markdown) {
  const kind = kindOfPath(file);
  const title = PAGE_TITLE.exec(markdown);
  const front = readFrontMatter(markdown);
  const renamed = RENAMED.exec(markdown);

  return {
    file,
    kind,
    name: title ? title[1] : `oneuptime_${path.basename(file, ".md")}`,
    slug: path.basename(file, ".md"),
    subcategory: front.subcategory,
    description: front.description,
    attributes: parseSchema(markdown),
    renamedFrom: renamed
      ? { name: renamed[1], oldNameStillWorks: renamed[2] === "." }
      : null,
  };
}

/*
 * ------------------------------------------------------------------
 * Comparing two releases' pages
 * ------------------------------------------------------------------
 */

// Paths whose parent is in the list too: the parent says it for them.
function withoutChildren(names) {
  const all = new Set(names);
  return names.filter((name) => {
    const parts = name.split(".");
    for (let length = 1; length < parts.length; length += 1) {
      if (all.has(parts.slice(0, length).join("."))) {
        return false;
      }
    }
    return true;
  });
}

function differenceOf(before, after) {
  const set = new Set(after || []);
  return (before || []).filter((value) => {
    return !set.has(value);
  });
}

/*
 * What changed in one resource's or data source's attributes, as changes a
 * reader can act on. Each is { breaking, kind, ... }: what removes or
 * tightens something a configuration may use breaks it.
 */
function compareAttributes(previous, current) {
  const changes = [];
  const added = withoutChildren(
    [...current.keys()].filter((name) => {
      return !previous.has(name);
    }),
  );
  const removed = withoutChildren(
    [...previous.keys()].filter((name) => {
      return !current.has(name);
    }),
  );

  for (const name of added) {
    const attribute = current.get(name);
    changes.push({
      kind: "added",
      name,
      attributeKind: attribute.kind,
      breaking: attribute.kind === "required",
    });
  }
  for (const name of removed) {
    changes.push({ kind: "removed", name, breaking: true });
  }

  for (const [name, now] of current) {
    const before = previous.get(name);
    if (!before) {
      continue;
    }

    if (before.kind !== now.kind) {
      if (now.kind === "required") {
        changes.push({ kind: "now-required", name, breaking: true });
      } else if (now.kind === "read-only") {
        changes.push({ kind: "now-read-only", name, breaking: true });
      } else if (before.kind === "required") {
        changes.push({ kind: "now-optional", name, breaking: false });
      } else {
        changes.push({ kind: "now-settable", name, breaking: false });
      }
    }
    if (before.type !== now.type) {
      changes.push({
        kind: "type",
        name,
        from: before.type,
        to: now.type,
        breaking: true,
      });
    }
    if (!before.sensitive && now.sensitive) {
      changes.push({ kind: "now-sensitive", name, breaking: true });
    }
    if (before.sensitive && !now.sensitive) {
      changes.push({ kind: "no-longer-sensitive", name, breaking: false });
    }
    if (!before.deprecated && now.deprecated) {
      changes.push({ kind: "deprecated", name, breaking: false });
    }

    // A list of values only means something on both sides.
    if (before.allowedValues && now.allowedValues) {
      const gone = differenceOf(before.allowedValues, now.allowedValues);
      const taken = differenceOf(now.allowedValues, before.allowedValues);
      if (gone.length > 0) {
        changes.push({
          kind: "values-removed",
          name,
          values: gone,
          breaking: true,
        });
      }
      if (taken.length > 0) {
        changes.push({
          kind: "values-added",
          name,
          values: taken,
          breaking: false,
        });
      }
    }

    if (before.defaultValue !== now.defaultValue) {
      changes.push({
        kind: "default",
        name,
        from: before.defaultValue,
        to: now.defaultValue,
        breaking: false,
      });
    }
  }

  return changes;
}

function byName(left, right) {
  return left.name.localeCompare(right.name);
}

/*
 * What changed between two releases' pages. `previousPages` and
 * `currentPages` map a page's path in the repository to its text; a page in
 * one only is a resource or data source added or removed, and the same text
 * on both sides changes nothing, so the maps may hold only the pages that
 * differ.
 *
 * A page added in this release that says it was called something before
 * (`renamedFrom`) is a rename, not a new resource: when the old name still
 * works, its page's removal is not a removal either.
 */
function compareReleases(previousPages, currentPages) {
  const parse = (pages) => {
    return new Map(
      [...pages]
        .filter(([file]) => {
          return kindOfPath(file) !== null;
        })
        .map(([file, markdown]) => {
          return [file, parsePage(file, markdown)];
        }),
    );
  };
  const previous = parse(previousPages);
  const current = parse(currentPages);

  const result = {};
  for (const { kind } of PAGE_DIRECTORIES) {
    result[kind] = {
      added: [],
      removed: [],
      renamed: [],
      changed: [],
    };
  }

  const renames = new Map();
  for (const [file, page] of current) {
    if (!previous.has(file) && page.renamedFrom) {
      renames.set(`${page.kind}:${page.renamedFrom.name}`, page);
    }
  }

  for (const [file, page] of current) {
    const group = result[page.kind];
    const before = previous.get(file);
    if (!before) {
      if (page.renamedFrom) {
        group.renamed.push({
          from: page.renamedFrom.name,
          to: page,
          oldNameStillWorks: page.renamedFrom.oldNameStillWorks,
          breaking: !page.renamedFrom.oldNameStillWorks,
        });
      } else {
        group.added.push(page);
      }
      continue;
    }

    // Its name went to a resource renamed this release: another one now.
    const takenBy = renames.get(`${page.kind}:${page.name}`);
    if (takenBy && !takenBy.renamedFrom.oldNameStillWorks) {
      continue;
    }

    const changes = compareAttributes(before.attributes, page.attributes);
    if (changes.length > 0) {
      group.changed.push({ page, changes });
    }
  }

  for (const [file, page] of previous) {
    if (current.has(file)) {
      continue;
    }
    const renamedTo = renames.get(`${page.kind}:${page.name}`);
    if (!renamedTo) {
      result[page.kind].removed.push(page);
    }
  }

  for (const group of Object.values(result)) {
    group.added.sort(byName);
    group.removed.sort(byName);
    group.changed.sort((left, right) => {
      return byName(left.page, right.page);
    });
    group.renamed.sort((left, right) => {
      return left.from.localeCompare(right.from);
    });
  }

  return result;
}

/*
 * ------------------------------------------------------------------
 * Reading the provider's repository
 * ------------------------------------------------------------------
 */

function git(directory, args, input) {
  const result = spawnSync("git", ["-C", directory, ...args], {
    input,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error
      ? result.error.message
      : String(result.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed: ${reason}`);
  }
  return result.stdout;
}

// Every resource and data source page at `ref`, path to blob.
function listPages(directory, ref) {
  const listing = git(directory, [
    "ls-tree",
    "-r",
    "-z",
    ref,
    "--",
    ...PAGE_DIRECTORIES.map(({ directory: pages }) => {
      return pages.replace(/\/$/, "");
    }),
  ]).toString("utf8");

  const pages = new Map();
  for (const entry of listing.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    const [, type, blob] = entry.slice(0, tab).split(" ");
    const file = entry.slice(tab + 1);
    if (type === "blob" && kindOfPath(file)) {
      pages.set(file, blob);
    }
  }
  return pages;
}

// The text of each blob, by `git cat-file --batch`: one git for them all.
function readBlobs(directory, blobs) {
  const texts = new Map();
  if (blobs.length === 0) {
    return texts;
  }

  const output = git(
    directory,
    ["cat-file", "--batch"],
    `${blobs.join("\n")}\n`,
  );
  let offset = 0;
  for (const blob of blobs) {
    const headerEnd = output.indexOf(0x0a, offset);
    const header = output.slice(offset, headerEnd).toString("utf8").split(" ");
    if (header[1] !== "blob") {
      throw new Error(`git cat-file has no blob ${blob}: ${header.join(" ")}`);
    }
    const size = Number(header[2]);
    texts.set(
      blob,
      output.slice(headerEnd + 1, headerEnd + 1 + size).toString("utf8"),
    );
    offset = headerEnd + 1 + size + 1;
  }
  return texts;
}

/*
 * The pages that differ between two commits of the provider, each side's
 * text by path, for compareReleases.
 */
function readChangedPages(directory, previousRef, currentRef) {
  const previous = listPages(directory, previousRef);
  const current = listPages(directory, currentRef);

  const differ = (pages, others) => {
    return [...pages].filter(([file, blob]) => {
      return others.get(file) !== blob;
    });
  };
  const previousOnly = differ(previous, current);
  const currentOnly = differ(current, previous);

  const texts = readBlobs(directory, [
    ...new Set(
      [...previousOnly, ...currentOnly].map(([, blob]) => {
        return blob;
      }),
    ),
  ]);
  const textsOf = (pages) => {
    return new Map(
      pages.map(([file, blob]) => {
        return [file, texts.get(blob)];
      }),
    );
  };

  return {
    previousPages: textsOf(previousOnly),
    currentPages: textsOf(currentOnly),
  };
}

// The OneUptime commit a provider commit says it was generated from.
function oneUptimeCommitOf(directory, ref) {
  const value = git(directory, [
    "log",
    "-1",
    `--format=%(trailers:key=${TRAILER},valueonly,separator=%x20)`,
    ref,
  ])
    .toString("utf8")
    .trim()
    .split(/\s+/)[0];
  return COMMIT.test(value || "") ? value : null;
}

/*
 * ------------------------------------------------------------------
 * OneUptime's pull requests
 * ------------------------------------------------------------------
 */

function isTheProvidersArea(area) {
  return (
    Boolean(area) &&
    partsOfArea(area).some((part) => {
      return PROVIDER_AREAS.has(part.toLowerCase());
    })
  );
}

// Whether a title or a commit's subject is the provider's: fix(terraform): ...
function isTheProviders(title) {
  return isTheProvidersArea(parseTitle(title).area);
}

function subjectOf(commit) {
  return commit.commit.message.split("\n")[0];
}

// "OneUptime/oneuptime#123": here, "#123" would be the provider's own.
function referenceInOneUptime(pullRequest) {
  return `[${ONEUPTIME_REPOSITORY}#${pullRequest.number}](https://github.com/${ONEUPTIME_REPOSITORY}/pull/${pullRequest.number})`;
}

/*
 * The provider's changes among OneUptime's between two commits, read and
 * sorted as GenerateReleaseNotes.js reads and sorts OneUptime's.
 *
 * A pull request is the provider's when its title is, or one of its commits
 * is: "feat(probes): ..., and Terraform checks a monitor secret's type change
 * at plan time" names probes, and brought "fix(terraform): refuse at plan
 * time a monitor secret's type changed without a new value". A commit pushed
 * straight to main is the provider's when its subject is. The provider's own
 * area goes unsaid (every line here is the provider's); another stays.
 */
async function findProviderChanges(github, from, to) {
  const commits = await listCommits(github, ONEUPTIME_REPOSITORY, from, to);
  const pullRequestsOfCommits = await findPullRequestsOfCommits(
    github,
    ONEUPTIME_REPOSITORY,
    commits,
  );
  const changes = sortChanges(commits, pullRequestsOfCommits);

  const broughtTheProviders = new Set();
  for (const commit of commits) {
    if (isTheProviders(subjectOf(commit))) {
      for (const pullRequest of pullRequestsOfCommits.get(commit.sha) || []) {
        broughtTheProviders.add(pullRequest.number);
      }
    }
  }

  const providers = {
    pullRequests: changes.pullRequests.filter((pullRequest) => {
      return (
        isTheProviders(pullRequest.title) ||
        broughtTheProviders.has(pullRequest.number)
      );
    }),
    directCommits: changes.directCommits.filter((commit) => {
      return isTheProviders(subjectOf(commit));
    }),
  };

  return buildEntries(
    providers,
    ONEUPTIME_REPOSITORY,
    referenceInOneUptime,
  ).map((entry) => {
    return isTheProvidersArea(entry.area) ? { ...entry, area: null } : entry;
  });
}

/*
 * The provider's changes since the previous release, and the OneUptime range
 * they come from. The range starts at the commit the previous release was
 * generated from, else at OneUptime's release of the previous version, else
 * (when OneUptime has no such release) at its newest release older than this
 * one.
 */
async function findOneUptimeChanges({ github, version, from, to }) {
  try {
    return { from, entries: await findProviderChanges(github, from, to) };
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  const start = await findStartOfRange(github, ONEUPTIME_REPOSITORY, version);
  return { from: start, entries: await findProviderChanges(github, start, to) };
}

/*
 * ------------------------------------------------------------------
 * Writing the notes
 * ------------------------------------------------------------------
 */

function code(value) {
  return `\`${value}\``;
}

function joinInWords(items, last = "and") {
  if (items.length < 2) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}

function codes(values, last = "and") {
  return joinInWords(values.map(code), last);
}

function countOf(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function docsOf(version, page) {
  const directory = page.kind === "resource" ? "resources" : "data-sources";
  return `${REGISTRY}/${version}/docs/${directory}/${page.slug}`;
}

function firstSentenceOf(description) {
  if (!description) {
    return "";
  }
  const match = FIRST_SENTENCE.exec(description);
  let sentence = match ? match[1] : description;
  if (sentence.length > MAX_DESCRIPTION_LENGTH) {
    const cut = sentence.slice(0, MAX_DESCRIPTION_LENGTH);
    sentence = `${cut.slice(0, cut.lastIndexOf(" "))}…`;
  }
  return escapeMarkdown(sentence);
}

function labelOf(kind) {
  return kind === "resource" ? "Resource" : "Data source";
}

// A breaking change, as the line that says it.
function breakingLine(page, change) {
  const subject = `${labelOf(page.kind)} ${code(page.name)}`;
  const attribute = code(change.name);
  switch (change.kind) {
    case "added":
      return `${subject} requires ${attribute} now, a new attribute.`;
    case "removed":
      return `${subject}: ${attribute} is removed.`;
    case "now-required":
      return `${subject}: ${attribute} is required now.`;
    case "now-read-only":
      return `${subject}: ${attribute} is read-only now. OneUptime sets it, and a configuration can no longer.`;
    case "type":
      return `${subject}: ${attribute} is a ${change.to} now, not a ${change.from}.`;
    case "now-sensitive":
      return `${subject}: ${attribute} is sensitive now. An output that shows it needs \`sensitive = true\`.`;
    case "values-removed":
      return `${subject}: ${attribute} no longer takes ${codes(change.values, "or")}.`;
    default:
      return `${subject}: ${attribute} changed.`;
  }
}

// The changes to one resource that break nothing, in one phrase each.
function changePhrases(changes) {
  const phrases = [];
  const added = (attributeKind) => {
    return changes
      .filter((change) => {
        return (
          change.kind === "added" && change.attributeKind === attributeKind
        );
      })
      .map((change) => {
        return change.name;
      });
  };

  const settable = added("optional");
  const readOnly = added("read-only");
  if (settable.length > 0) {
    phrases.push(`new ${codes(settable)}`);
  }
  if (readOnly.length > 0) {
    phrases.push(`new read-only ${codes(readOnly)}`);
  }

  for (const change of changes) {
    const attribute = code(change.name);
    if (change.kind === "now-optional") {
      phrases.push(`${attribute} is optional now`);
    } else if (change.kind === "now-settable") {
      phrases.push(`${attribute} can be set now`);
    } else if (change.kind === "values-added") {
      phrases.push(`${attribute} takes ${codes(change.values)} too`);
    } else if (change.kind === "no-longer-sensitive") {
      phrases.push(`${attribute} is no longer sensitive`);
    } else if (change.kind === "deprecated") {
      phrases.push(`${attribute} is deprecated`);
    } else if (change.kind === "default") {
      if (change.to === null) {
        phrases.push(`${attribute} has no default now`);
      } else if (change.from === null) {
        phrases.push(`${attribute} defaults to ${code(change.to)} now`);
      } else {
        phrases.push(
          `${attribute} defaults to ${code(change.to)} now, not ${code(change.from)}`,
        );
      }
    }
  }
  return phrases;
}

function breakingLines(comparison) {
  const lines = [];
  for (const { kind } of PAGE_DIRECTORIES) {
    const group = comparison[kind];
    for (const page of group.removed) {
      lines.push(`${labelOf(kind)} ${code(page.name)} is removed.`);
    }
    for (const rename of group.renamed) {
      if (rename.breaking) {
        lines.push(
          `${labelOf(kind)} ${code(rename.from)} is ${code(rename.to.name)} now, and ${code(rename.from)} is another ${kind}'s name: rename it in your configuration and add a \`moved\` block.`,
        );
      }
    }
    for (const { page, changes } of group.changed) {
      for (const change of changes) {
        if (change.breaking) {
          lines.push(breakingLine(page, change));
        }
      }
    }
  }
  return lines;
}

function newPagesSection(version, comparison) {
  const resources = comparison.resource.added;
  const dataSources = comparison["data source"].added;
  if (resources.length === 0 && dataSources.length === 0) {
    return "";
  }

  const lines = ["## 🧩 New resources and data sources", ""];
  for (const page of resources) {
    const sentence = firstSentenceOf(page.description);
    lines.push(
      `- [${code(page.name)}](${docsOf(version, page)})${sentence ? `: ${sentence}` : ""}`,
    );
  }
  if (dataSources.length > 0) {
    if (resources.length > 0) {
      lines.push("");
    }
    lines.push(
      `${dataSources.length === 1 ? "Data source" : "Data sources"}: ${joinInWords(
        dataSources.map((page) => {
          return `[${code(page.name)}](${docsOf(version, page)})`;
        }),
      )}.`,
    );
  }
  return lines.join("\n");
}

function changedLines(group) {
  const lines = [];
  for (const rename of group.renamed) {
    if (!rename.breaking) {
      lines.push(
        `- ${code(rename.from)} is ${code(rename.to.name)} now. The old name still works, but is deprecated: rename it in your configuration and add a \`moved\` block.`,
      );
    }
  }
  for (const { page, changes } of group.changed) {
    const phrases = changePhrases(changes);
    if (phrases.length > 0) {
      lines.push(`- ${code(page.name)}: ${phrases.join("; ")}.`);
    }
  }
  return lines;
}

/*
 * The changes that break nothing, resources first. A data source mostly
 * changes as its resource does, so its list is folded.
 */
function changedSection(comparison) {
  const resources = changedLines(comparison.resource);
  const dataSources = changedLines(comparison["data source"]);
  if (resources.length === 0 && dataSources.length === 0) {
    return "";
  }

  const blocks = ["## 🔁 Changed resources and data sources"];
  if (resources.length > 0) {
    blocks.push(resources.join("\n"));
  }
  if (dataSources.length > 0) {
    blocks.push(
      `<details>\n<summary>${countOf(dataSources.length, "data source", "data sources")}</summary>\n\n${dataSources.join("\n")}\n\n</details>`,
    );
  }
  return blocks.join("\n\n");
}

function countChanged(group) {
  return (
    group.changed.filter(({ changes }) => {
      return changes.length > 0;
    }).length + group.renamed.length
  );
}

function linkToRelease(tag) {
  return `[${tag}](https://github.com/${PROVIDER_REPOSITORY}/releases/tag/${tag})`;
}

function linkToOneUptime(version) {
  return `[OneUptime ${version}](https://github.com/${ONEUPTIME_REPOSITORY}/releases/tag/${version})`;
}

function oneUptimeComparison(from, to) {
  return `https://github.com/${ONEUPTIME_REPOSITORY}/compare/${from}...${to}`;
}

function summaryOf({ version, previous, comparison, entries, breakingCount }) {
  const opening = `The provider for ${linkToOneUptime(version)}, generated from its API.`;
  if (!previous) {
    return `${opening} There is no earlier release to compare it with.`;
  }
  if (!comparison) {
    return `${opening} What changed since ${linkToRelease(previous)} is in the full changelog below.`;
  }

  const resources = comparison.resource;
  const dataSources = comparison["data source"];
  const counts = [
    countOf(resources.added.length, "new resource", "new resources"),
    countOf(dataSources.added.length, "new data source", "new data sources"),
    countOf(countChanged(resources), "changed resource", "changed resources"),
    countOf(
      countChanged(dataSources),
      "changed data source",
      "changed data sources",
    ),
    countOf(resources.removed.length, "removed resource", "removed resources"),
    countOf(
      dataSources.removed.length,
      "removed data source",
      "removed data sources",
    ),
  ].filter((count) => {
    return !count.startsWith("0 ");
  });
  if (entries && entries.length > 0) {
    counts.push(
      countOf(
        entries.length,
        "change to the provider",
        "changes to the provider",
      ),
    );
  }

  const since = `since ${linkToRelease(previous)}`;
  if (counts.length === 0) {
    return `${opening} No resource or data source changed ${since}.`;
  }

  const breaking =
    breakingCount > 0
      ? ` ${breakingCount === 1 ? "One of them breaks" : `${breakingCount} of them break`} a configuration that worked before: read Breaking changes first.`
      : "";
  return `${opening} **${joinInWords(counts)} ${since}.**${breaking}`;
}

function installSection(version) {
  return [
    "## ⬇️ Install",
    "",
    "```hcl",
    "terraform {",
    "  required_providers {",
    "    oneuptime = {",
    '      source  = "oneuptime/oneuptime"',
    `      version = "~> ${version}"`,
    "    }",
    "  }",
    "}",
    "```",
    "",
    `The same block works with OpenTofu. The provider is on the [Terraform Registry](${REGISTRY}/${version}) and the [OpenTofu Registry](${OPENTOFU_REGISTRY}/v${version}); its documentation is on the [Terraform Registry](${REGISTRY}/${version}/docs).`,
  ].join("\n");
}

function entriesOf(entries, key) {
  return (entries || []).filter((entry) => {
    return entry.section === key;
  });
}

function sectionOfEntries(section, entries) {
  const list = renderEntries(entries);
  if (section.folded) {
    return `<details>\n<summary>${section.title} (${entries.length})</summary>\n\n${list}\n\n</details>`;
  }
  return `## ${section.title}\n\n${list}`;
}

/*
 * The notes of a release: { version, previous, comparison, oneUptime }.
 * `comparison` is compareReleases' answer (null when the pages could not be
 * read); `oneUptime` is { from, to, entries } or, when GitHub could not be
 * read, { from, to, entries: null }, and null when there was no range.
 */
function renderReleaseNotes({ version, previous, comparison, oneUptime }) {
  const entries = oneUptime ? oneUptime.entries : null;
  const schemaBreaking = comparison ? breakingLines(comparison) : [];
  const breakingEntries = entriesOf(entries, "breaking");

  const changes = [
    summaryOf({
      version,
      previous,
      comparison,
      entries,
      breakingCount: schemaBreaking.length + breakingEntries.length,
    }),
  ];

  if (schemaBreaking.length > 0 || breakingEntries.length > 0) {
    changes.push(
      [
        "## ⚠️ Breaking changes",
        "",
        ...schemaBreaking.map((line) => {
          return `- ${line}`;
        }),
        ...(breakingEntries.length > 0 ? [renderEntries(breakingEntries)] : []),
      ].join("\n"),
    );
  }

  if (comparison) {
    changes.push(newPagesSection(version, comparison));
  }

  const folded = [];
  for (const section of SECTIONS) {
    const inSection = entriesOf(entries, section.key);
    if (section.key === "breaking" || inSection.length === 0) {
      continue;
    }
    if (section.folded) {
      folded.push(sectionOfEntries(section, inSection));
    } else {
      changes.push(sectionOfEntries(section, inSection));
    }
  }

  if (comparison) {
    // After the pull requests: what OneUptime's API changed, attribute by attribute.
    changes.push(changedSection(comparison));
  }

  const closing = [installSection(version)];
  if (previous) {
    closing.push(
      `**Full changelog:** https://github.com/${PROVIDER_REPOSITORY}/compare/${previous}...v${version}`,
    );
  }
  if (oneUptime && oneUptime.from && oneUptime.to) {
    const comparisonLink = oneUptimeComparison(oneUptime.from, oneUptime.to);
    closing.push(
      entries
        ? `**OneUptime's changes:** ${comparisonLink}`
        : `**OneUptime's changes:** ${comparisonLink} (its pull requests could not be read for these notes)`,
    );
  }

  return assembleNotes({
    changes: changes.filter(Boolean),
    folded: folded.join("\n\n"),
    closing,
  });
}

// The notes of a release that publishes another's provider again.
function renderRepublishNotes({ version, republishOf }) {
  const original = linkToRelease(republishOf);
  return [
    `This is ${original}'s provider, published again as v${version}, unchanged: it is built from the same commit.`,
    `${original}'s assets were built again and uploaded over the published ones after the Terraform and OpenTofu registries had read them, so \`terraform init\` and \`tofu init\` refuse ${republishOf} with \`checksum list has unexpected SHA-256 hash\` (#20). A published release is never changed, so use v${version} instead: ${original}'s notes say what it changed.`,
    installSection(version),
    `**Full changelog:** https://github.com/${PROVIDER_REPOSITORY}/compare/${republishOf}...v${version}`,
  ].join("\n\n");
}

/*
 * ------------------------------------------------------------------
 * Running it
 * ------------------------------------------------------------------
 */

// A workflow command is one line, and an error may be several.
function workflowCommandText(text) {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function parseArguments(argumentList) {
  const options = {
    version: null,
    providerDir: null,
    ref: null,
    previous: null,
    republishOf: null,
    oneUptimeTo: null,
    output: null,
    fallbackOnError: false,
  };
  const withValue = new Map([
    ["--version", "version"],
    ["--provider-dir", "providerDir"],
    ["--ref", "ref"],
    ["--previous", "previous"],
    ["--republish-of", "republishOf"],
    ["--oneuptime-to", "oneUptimeTo"],
    ["--output", "output"],
  ]);

  for (let index = 0; index < argumentList.length; index += 1) {
    const argument = argumentList[index];
    if (argument === "--fallback-on-error") {
      options.fallbackOnError = true;
    } else if (withValue.has(argument) && index + 1 < argumentList.length) {
      index += 1;
      // An empty value is the option left out: the script passes them so.
      options[withValue.get(argument)] = argumentList[index] || null;
    } else {
      throw new Error(`Unknown or incomplete option: ${argument}`);
    }
  }

  if (
    !options.version ||
    !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(options.version)
  ) {
    throw new Error("--version takes the release's version, as 17.1.0");
  }
  if (!options.providerDir) {
    throw new Error(
      "--provider-dir takes a clone of the provider's repository",
    );
  }
  return options;
}

function warn(text) {
  process.stdout.write(
    `::warning title=Terraform provider release notes::${workflowCommandText(text)}\n`,
  );
}

/*
 * Writes the notes. `tools` stands in for the world in tests: token,
 * fetcher, sleep, api, write, warn.
 */
async function run(options, tools = {}) {
  const write =
    tools.write ||
    ((notes) => {
      if (options.output) {
        fs.writeFileSync(options.output, `${notes}\n`);
      } else {
        process.stdout.write(`${notes}\n`);
      }
    });
  const warnOf = tools.warn || warn;
  const { version } = options;

  if (options.republishOf) {
    write(renderRepublishNotes({ version, republishOf: options.republishOf }));
    return;
  }

  const ref = options.ref || `v${version}`;
  const previous = options.previous;

  let comparison = null;
  if (previous) {
    try {
      const { previousPages, currentPages } = readChangedPages(
        options.providerDir,
        previous,
        ref,
      );
      comparison = compareReleases(previousPages, currentPages);
    } catch (error) {
      if (!options.fallbackOnError) {
        throw error;
      }
      warnOf(
        `What changed since ${previous} could not be read, so the notes of v${version} leave it out: ${error.message}`,
      );
    }
  }

  let oneUptime = null;
  const to =
    oneUptimeCommitOfOrNull(options.providerDir, ref) || options.oneUptimeTo;
  const from = previous
    ? oneUptimeCommitOfOrNull(options.providerDir, previous) ||
      previous.replace(/^v/, "")
    : null;
  if (from && to && tools.token) {
    const github = createGitHub({
      token: tools.token,
      fetcher: tools.fetcher || fetch,
      sleep: tools.sleep || sleepFor,
      api: tools.api || GITHUB_API,
    });
    try {
      const found = await findOneUptimeChanges({ github, version, from, to });
      oneUptime = { from: found.from, to, entries: found.entries };
    } catch (error) {
      if (!options.fallbackOnError) {
        throw error;
      }
      warnOf(
        `OneUptime's pull requests for v${version} could not be read, so its notes link to OneUptime's changes instead: ${error.message}`,
      );
      oneUptime = { from, to, entries: null };
    }
  }

  write(renderReleaseNotes({ version, previous, comparison, oneUptime }));
}

function oneUptimeCommitOfOrNull(directory, ref) {
  try {
    return oneUptimeCommitOf(directory, ref);
  } catch {
    return null;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await run(options, {
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null,
    api: process.env.GITHUB_API_URL || GITHUB_API,
  });
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`GenerateReleaseNotes: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  MAX_NOTES_LENGTH,
  TRAILER,
  compareAttributes,
  compareReleases,
  findOneUptimeChanges,
  isTheProviders,
  oneUptimeCommitOf,
  parseArguments,
  parsePage,
  parseSchema,
  readChangedPages,
  renderReleaseNotes,
  renderRepublishNotes,
  run,
};
