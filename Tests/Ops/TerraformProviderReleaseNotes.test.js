"use strict";

/**
 * Scripts/TerraformProvider/GenerateReleaseNotes.js - the notes of each
 * Terraform provider release (OneUptime/terraform-provider-oneuptime).
 *
 * Every release used to have the same notes, word for word, whatever it
 * shipped (OneUptime/terraform-provider-oneuptime#19). What has to hold now,
 * and what each part of this suite pins:
 *
 *  - Reading a page: what it documents, what that does, and every attribute,
 *    nested ones too - whether it is required, optional or read-only, its
 *    type, whether it is sensitive or deprecated, the values it takes and its
 *    default - and nothing an example says.
 *  - Comparing two releases: every change a person upgrading acts on, and
 *    which of them break a configuration that worked: a resource, data
 *    source or attribute removed, an attribute required now or no longer
 *    settable, a type changed, a value no longer taken, a value now
 *    sensitive. A rename is not a removal while the old name still works.
 *  - The repository: only the pages that differ are read, and each release's
 *    commit names the OneUptime commit it was generated from.
 *  - OneUptime's pull requests: those that changed the provider, by their
 *    title or by one of their commits, named in OneUptime's repository.
 *  - The notes: breaking changes first, links to the new pages, the install
 *    block, and within what GitHub takes.
 *  - Failure: a release is not held back for its notes.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const {
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
} = require("../../Scripts/TerraformProvider/GenerateReleaseNotes");
const { createGitHub } = require("../../Scripts/Release/GenerateReleaseNotes");
const { pagePath, providerPage } = require("./Utils/ProviderDocsPages");
const {
  commitNamed,
  fakeOneUptimeGitHub,
  pullRequest,
  shaOf,
} = require("./Utils/FakeOneUptimeGitHub");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "Scripts",
  "TerraformProvider",
  "GenerateReleaseNotes.js",
);
const REGISTRY = "https://registry.terraform.io/providers/oneuptime/oneuptime";

const MONITOR = {
  name: "oneuptime_monitor",
  subcategory: "Monitors",
  description:
    "Monitor is anything that monitors your API, Websites, IP, Network or more. You can also create a static one.",
  attributes: {
    required: {
      name: { description: "Any friendly name for this monitor." },
      monitor_type: {
        description: "What is the type of this monitor?",
        allowed: ["Manual", "Website", "Docker Swarm"],
      },
    },
    optional: {
      description: { description: "Friendly description." },
      is_paused: { type: "Boolean", defaultValue: "false" },
      labels: { type: "Set of String", description: "Labels to group by." },
      monitor_steps: {
        type: "Attributes List",
        description: "What the monitor checks.",
        nested: true,
      },
    },
    readOnly: {
      id: { description: "Unique identifier for the resource." },
      secret_key: { sensitive: true, description: "The secret key." },
    },
  },
  nested: {
    monitor_steps: {
      required: {
        criteria: { type: "Attributes List", nested: true },
      },
      optional: {
        monitor_destination: { description: "Where to check." },
      },
    },
    "monitor_steps.criteria": {
      required: {
        check_on: {
          description: "What this filter inspects.",
          allowed: ["Is Online", "Response Time (in ms)"],
        },
      },
    },
  },
};

// The monitor's page, with `change` applied to a copy of its definition.
function monitorPage(change = () => {}) {
  const definition = JSON.parse(JSON.stringify(MONITOR));
  change(definition);
  return providerPage(definition);
}

function tempDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(directory, ...args) {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

/*
 * A provider repository whose commits hold the given trees, each tagged:
 * [{ tag, files: { path: text }, message }].
 */
function providerRepository(releases) {
  const directory = tempDirectory("provider-notes-repo-");
  git(directory, "init", "-q", "-b", "master");
  for (const release of releases) {
    for (const file of git(directory, "ls-files").split("\n").filter(Boolean)) {
      fs.rmSync(path.join(directory, file));
    }
    for (const [file, text] of Object.entries(release.files)) {
      fs.mkdirSync(path.dirname(path.join(directory, file)), {
        recursive: true,
      });
      fs.writeFileSync(path.join(directory, file), text);
    }
    git(directory, "add", "-A");
    git(
      directory,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      release.message || `chore: generate provider for version ${release.tag}`,
    );
    git(directory, "tag", "-a", release.tag, "-m", `Release ${release.tag}`);
  }
  return directory;
}

const ONEUPTIME_FROM = shaOf(0xf00d);
const ONEUPTIME_TO = shaOf(0xbeef);

function withTrailer(tag, commit) {
  return `chore: generate provider for version ${tag}\n\nThe provider of OneUptime.\n\n${TRAILER}: ${commit}`;
}

describe("reading a page", () => {
  const page = parsePage("docs/resources/monitor.md", monitorPage());

  test("names what it documents, its kind, and what that does", () => {
    expect(page).toMatchObject({
      file: "docs/resources/monitor.md",
      kind: "resource",
      name: "oneuptime_monitor",
      slug: "monitor",
      subcategory: "Monitors",
      description: MONITOR.description,
      renamedFrom: null,
    });
    expect(
      parsePage(
        "docs/data-sources/monitor.md",
        providerPage({ ...MONITOR, kind: "Data Source" }),
      ),
    ).toMatchObject({ kind: "data source", name: "oneuptime_monitor" });
  });

  test("reads each attribute's group, type, tags, values and default", () => {
    expect(page.attributes.get("name")).toMatchObject({
      kind: "required",
      type: "String",
      sensitive: false,
      deprecated: false,
      allowedValues: null,
      defaultValue: null,
    });
    expect(page.attributes.get("monitor_type").allowedValues).toEqual([
      "Manual",
      "Website",
      "Docker Swarm",
    ]);
    expect(page.attributes.get("is_paused")).toMatchObject({
      kind: "optional",
      type: "Boolean",
      defaultValue: "false",
    });
    expect(page.attributes.get("labels")).toMatchObject({
      kind: "optional",
      type: "Set of String",
    });
    expect(page.attributes.get("secret_key")).toMatchObject({
      kind: "read-only",
      sensitive: true,
    });
  });

  test("reads nested attributes by their path, each in its own group", () => {
    expect(page.attributes.get("monitor_steps")).toMatchObject({
      kind: "optional",
      type: "Attributes List",
    });
    expect(page.attributes.get("monitor_steps.criteria")).toMatchObject({
      kind: "required",
    });
    expect(
      page.attributes.get("monitor_steps.monitor_destination"),
    ).toMatchObject({ kind: "optional" });
    expect(
      page.attributes.get("monitor_steps.criteria.check_on").allowedValues,
    ).toEqual(["Is Online", "Response Time (in ms)"]);
  });

  test("reads nothing an example says, and nothing outside the Schema", () => {
    expect(page.attributes.has("not_an_attribute")).toBe(false);
    expect([...page.attributes.keys()].sort()).toEqual(
      [
        "description",
        "id",
        "is_paused",
        "labels",
        "monitor_steps",
        "monitor_steps.criteria",
        "monitor_steps.criteria.check_on",
        "monitor_steps.monitor_destination",
        "monitor_type",
        "name",
        "secret_key",
      ].sort(),
    );
  });

  test("a heading of another kind inside the Schema ends the list before it", () => {
    const attributes = parseSchema(
      [
        "## Schema",
        "",
        "### Optional",
        "",
        "- `kept` (String) Read.",
        "",
        "### Rotation",
        "",
        "- `prose` (String) Not an attribute: a list under another heading.",
        "",
      ].join("\n"),
    );
    expect([...attributes.keys()]).toEqual(["kept"]);
  });

  test("a deprecated attribute, and the default the schema gave, the last one on its line", () => {
    const attributes = parseSchema(
      [
        "## Schema",
        "",
        "### Optional",
        "",
        "- `old` (String, Deprecated) Defaults to `a` in its words. **Deprecated:** Use new. Defaults to `b`.",
        "- `values` (String) Allowed values: `A, with a comma`, `B`. Then more words: `C`.",
        "",
      ].join("\n"),
    );
    expect(attributes.get("old")).toMatchObject({
      deprecated: true,
      defaultValue: "b",
    });
    expect(attributes.get("values").allowedValues).toEqual([
      "A, with a comma",
      "B",
    ]);
  });

  test("reads the name a renamed resource had, and whether it still works", () => {
    expect(
      parsePage(
        "docs/resources/ai_rule.md",
        providerPage({
          name: "oneuptime_ai_rule",
          renamedFrom: { from: "oneuptime_auto_remediation_rule" },
        }),
      ).renamedFrom,
    ).toEqual({
      name: "oneuptime_auto_remediation_rule",
      oldNameStillWorks: true,
    });
    expect(
      parsePage(
        "docs/resources/team.md",
        providerPage({
          name: "oneuptime_team",
          renamedFrom: { from: "oneuptime_group", stillWorks: false },
        }),
      ).renamedFrom,
    ).toEqual({ name: "oneuptime_group", oldNameStillWorks: false });
  });
});

describe("comparing a resource's attributes", () => {
  const attributesOf = (change) => {
    return parsePage("docs/resources/monitor.md", monitorPage(change))
      .attributes;
  };
  const before = attributesOf();
  const compare = (change) => {
    return compareAttributes(before, attributesOf(change));
  };

  test("the same attributes change nothing", () => {
    expect(compare()).toEqual([]);
  });

  test("a new attribute breaks a configuration only when it is required", () => {
    expect(
      compare((monitor) => {
        monitor.attributes.optional.timeout = { type: "Number" };
        monitor.attributes.readOnly.checked_at = {};
        monitor.attributes.required.project_id = {};
      }),
    ).toEqual(
      expect.arrayContaining([
        {
          kind: "added",
          name: "timeout",
          attributeKind: "optional",
          breaking: false,
        },
        {
          kind: "added",
          name: "checked_at",
          attributeKind: "read-only",
          breaking: false,
        },
        {
          kind: "added",
          name: "project_id",
          attributeKind: "required",
          breaking: true,
        },
      ]),
    );
  });

  test("a removed attribute breaks a configuration that set or read it", () => {
    expect(
      compare((monitor) => {
        delete monitor.attributes.optional.labels;
        delete monitor.attributes.readOnly.secret_key;
      }),
    ).toEqual([
      { kind: "removed", name: "labels", breaking: true },
      { kind: "removed", name: "secret_key", breaking: true },
    ]);
  });

  test("a new or removed nested block is one change, not one per attribute in it", () => {
    const added = compareAttributes(
      parseSchema("## Schema\n\n### Optional\n\n- `a` (String)\n"),
      before,
    ).filter((change) => {
      return change.kind === "added";
    });
    expect(
      added.map((change) => {
        return change.name;
      }),
    ).toContain("monitor_steps");
    expect(
      added.some((change) => {
        return change.name.startsWith("monitor_steps.");
      }),
    ).toBe(false);

    const removed = compare((monitor) => {
      delete monitor.attributes.optional.monitor_steps;
      monitor.nested = {};
    });
    expect(removed).toEqual([
      { kind: "removed", name: "monitor_steps", breaking: true },
    ]);
  });

  test("required now, or read-only now, breaks; optional or settable now does not", () => {
    const changes = compare((monitor) => {
      monitor.attributes.required.description =
        monitor.attributes.optional.description;
      delete monitor.attributes.optional.description;
      monitor.attributes.readOnly.labels = monitor.attributes.optional.labels;
      delete monitor.attributes.optional.labels;
      monitor.attributes.optional.name = monitor.attributes.required.name;
      delete monitor.attributes.required.name;
      monitor.attributes.optional.id = monitor.attributes.readOnly.id;
      delete monitor.attributes.readOnly.id;
    });
    expect(changes).toEqual(
      expect.arrayContaining([
        { kind: "now-required", name: "description", breaking: true },
        { kind: "now-read-only", name: "labels", breaking: true },
        { kind: "now-optional", name: "name", breaking: false },
        { kind: "now-settable", name: "id", breaking: false },
      ]),
    );
    expect(changes).toHaveLength(4);
  });

  test("a new type breaks, and so does a value turned sensitive; one no longer sensitive does not", () => {
    expect(
      compare((monitor) => {
        monitor.attributes.optional.description.type = "Number";
        monitor.attributes.optional.labels.sensitive = true;
        monitor.attributes.readOnly.secret_key.sensitive = false;
      }),
    ).toEqual(
      expect.arrayContaining([
        {
          kind: "type",
          name: "description",
          from: "String",
          to: "Number",
          breaking: true,
        },
        { kind: "now-sensitive", name: "labels", breaking: true },
        { kind: "no-longer-sensitive", name: "secret_key", breaking: false },
      ]),
    );
  });

  test("a value no longer taken breaks; a new value, a deprecation and a new default do not", () => {
    const changes = compare((monitor) => {
      monitor.attributes.required.monitor_type.allowed = [
        "Manual",
        "Website",
        "Ceph",
      ];
      monitor.attributes.optional.description.deprecated = "Use name.";
      monitor.attributes.optional.is_paused.defaultValue = "true";
    });
    expect(changes).toEqual(
      expect.arrayContaining([
        {
          kind: "values-removed",
          name: "monitor_type",
          values: ["Docker Swarm"],
          breaking: true,
        },
        {
          kind: "values-added",
          name: "monitor_type",
          values: ["Ceph"],
          breaking: false,
        },
        { kind: "deprecated", name: "description", breaking: false },
        {
          kind: "default",
          name: "is_paused",
          from: "false",
          to: "true",
          breaking: false,
        },
      ]),
    );
  });

  test("a list of values that appears or goes says nothing about values", () => {
    const changes = compare((monitor) => {
      delete monitor.attributes.required.monitor_type.allowed;
      monitor.attributes.required.name.allowed = ["A"];
    });
    expect(changes).toEqual([]);
  });

  test("a default added or gone is a change", () => {
    const changes = compare((monitor) => {
      delete monitor.attributes.optional.is_paused.defaultValue;
      monitor.attributes.optional.description.defaultValue = "Managed";
    });
    expect(changes).toEqual(
      expect.arrayContaining([
        {
          kind: "default",
          name: "is_paused",
          from: "false",
          to: null,
          breaking: false,
        },
        {
          kind: "default",
          name: "description",
          from: null,
          to: "Managed",
          breaking: false,
        },
      ]),
    );
  });
});

describe("comparing two releases", () => {
  const label = providerPage({
    name: "oneuptime_label",
    subcategory: "Labels",
    description: "A label groups resources. It has a color.",
    attributes: { required: { name: {} } },
  });
  const status = providerPage({
    name: "oneuptime_monitor_status",
    attributes: { required: { name: {} } },
  });

  test("names what was added, removed and changed, resources and data sources apart", () => {
    const comparison = compareReleases(
      new Map([
        [pagePath("oneuptime_monitor"), monitorPage()],
        [pagePath("oneuptime_monitor_status"), status],
        [
          pagePath("oneuptime_monitor", "Data Source"),
          providerPage({ ...MONITOR, kind: "Data Source" }),
        ],
        ["docs/index.md", "# The provider"],
      ]),
      new Map([
        [
          pagePath("oneuptime_monitor"),
          monitorPage((monitor) => {
            monitor.attributes.optional.timeout = { type: "Number" };
          }),
        ],
        [pagePath("oneuptime_label"), label],
        [
          pagePath("oneuptime_label", "Data Source"),
          providerPage({
            name: "oneuptime_label",
            kind: "Data Source",
            attributes: { optional: { name: {} } },
          }),
        ],
        [
          pagePath("oneuptime_monitor", "Data Source"),
          providerPage({ ...MONITOR, kind: "Data Source" }),
        ],
        ["docs/index.md", "# The provider, changed"],
        ["docs/guides/opentofu.md", "# OpenTofu"],
      ]),
    );

    expect(
      comparison.resource.added.map((page) => {
        return page.name;
      }),
    ).toEqual(["oneuptime_label"]);
    expect(
      comparison.resource.removed.map((page) => {
        return page.name;
      }),
    ).toEqual(["oneuptime_monitor_status"]);
    expect(
      comparison.resource.changed.map(({ page, changes }) => {
        return [page.name, changes];
      }),
    ).toEqual([
      [
        "oneuptime_monitor",
        [
          {
            kind: "added",
            name: "timeout",
            attributeKind: "optional",
            breaking: false,
          },
        ],
      ],
    ]);
    expect(
      comparison["data source"].added.map((page) => {
        return page.name;
      }),
    ).toEqual(["oneuptime_label"]);
    // The same page on both sides: no change.
    expect(comparison["data source"].changed).toEqual([]);
    expect(comparison["data source"].removed).toEqual([]);
  });

  test("a resource renamed, whose old name still works, is a rename, not an addition and a removal", () => {
    const comparison = compareReleases(
      new Map([
        [
          pagePath("oneuptime_auto_remediation_rule"),
          providerPage({ name: "oneuptime_auto_remediation_rule" }),
        ],
      ]),
      new Map([
        [
          pagePath("oneuptime_ai_rule"),
          providerPage({
            name: "oneuptime_ai_rule",
            renamedFrom: { from: "oneuptime_auto_remediation_rule" },
          }),
        ],
      ]),
    );

    expect(comparison.resource.added).toEqual([]);
    expect(comparison.resource.removed).toEqual([]);
    expect(comparison.resource.renamed).toEqual([
      expect.objectContaining({
        from: "oneuptime_auto_remediation_rule",
        oldNameStillWorks: true,
        breaking: false,
      }),
    ]);
    expect(comparison.resource.renamed[0].to.name).toBe("oneuptime_ai_rule");
  });

  test("a resource renamed onto a name another resource has now breaks, and the other's page is not compared as if it were the same", () => {
    const comparison = compareReleases(
      new Map([
        [
          pagePath("oneuptime_group"),
          providerPage({
            name: "oneuptime_group",
            attributes: { required: { members: {} } },
          }),
        ],
      ]),
      new Map([
        [
          pagePath("oneuptime_team"),
          providerPage({
            name: "oneuptime_team",
            attributes: { required: { members: {} } },
            renamedFrom: { from: "oneuptime_group", stillWorks: false },
          }),
        ],
        [
          pagePath("oneuptime_group"),
          providerPage({
            name: "oneuptime_group",
            attributes: { required: { pipelines: {} } },
          }),
        ],
      ]),
    );

    expect(comparison.resource.renamed).toEqual([
      expect.objectContaining({
        from: "oneuptime_group",
        oldNameStillWorks: false,
        breaking: true,
      }),
    ]);
    expect(comparison.resource.changed).toEqual([]);
    expect(comparison.resource.added).toEqual([]);
  });

  test("a rename said on a page that was there before is old news", () => {
    const renamed = providerPage({
      name: "oneuptime_ai_rule",
      renamedFrom: { from: "oneuptime_auto_remediation_rule" },
    });
    const comparison = compareReleases(
      new Map([[pagePath("oneuptime_ai_rule"), renamed]]),
      new Map([
        [
          pagePath("oneuptime_ai_rule"),
          renamed.replace("## Import", "Another word.\n\n## Import"),
        ],
      ]),
    );
    expect(comparison.resource.renamed).toEqual([]);
    expect(comparison.resource.changed).toEqual([]);
  });

  test("lists everything by name", () => {
    const pages = (names) => {
      return new Map(
        names.map((name) => {
          return [pagePath(name), providerPage({ name })];
        }),
      );
    };
    const comparison = compareReleases(
      pages(["oneuptime_zeta", "oneuptime_alpha"]),
      pages(["oneuptime_omega", "oneuptime_beta"]),
    );
    expect(
      comparison.resource.added.map((page) => {
        return page.name;
      }),
    ).toEqual(["oneuptime_beta", "oneuptime_omega"]);
    expect(
      comparison.resource.removed.map((page) => {
        return page.name;
      }),
    ).toEqual(["oneuptime_alpha", "oneuptime_zeta"]);
  });
});

describe("reading the provider's repository", () => {
  let repository;

  beforeAll(() => {
    repository = providerRepository([
      {
        tag: "v1.0.0",
        message: withTrailer("v1.0.0", ONEUPTIME_FROM),
        files: {
          [pagePath("oneuptime_monitor")]: monitorPage(),
          [pagePath("oneuptime_monitor_status")]: providerPage({
            name: "oneuptime_monitor_status",
          }),
          [pagePath("oneuptime_probe")]: providerPage({
            name: "oneuptime_probe",
          }),
          "docs/index.md": "# One",
          "main.go": "package main\n",
        },
      },
      {
        tag: "v1.1.0",
        message: "chore: generate provider for version v1.1.0\n\nNo trailer.",
        files: {
          [pagePath("oneuptime_monitor")]: monitorPage((monitor) => {
            monitor.attributes.optional.timeout = {};
          }),
          [pagePath("oneuptime_monitor_status")]: providerPage({
            name: "oneuptime_monitor_status",
          }),
          [pagePath("oneuptime_label")]: providerPage({
            name: "oneuptime_label",
          }),
          "docs/index.md": "# Two",
          "main.go": "package main // changed\n",
        },
      },
      {
        tag: "v1.2.0",
        message: `chore: v1.2.0\n\n${TRAILER}: not-a-commit`,
        files: { "main.go": "package main\n" },
      },
    ]);
  });

  afterAll(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  test("reads the pages that differ, on each side, and no other", () => {
    const { previousPages, currentPages } = readChangedPages(
      repository,
      "v1.0.0",
      "v1.1.0",
    );
    expect([...previousPages.keys()].sort()).toEqual([
      "docs/resources/monitor.md",
      "docs/resources/probe.md",
    ]);
    expect([...currentPages.keys()].sort()).toEqual([
      "docs/resources/label.md",
      "docs/resources/monitor.md",
    ]);
    expect(currentPages.get("docs/resources/monitor.md")).toContain(
      "`timeout`",
    );

    const comparison = compareReleases(previousPages, currentPages);
    expect(
      comparison.resource.added.map((page) => {
        return page.name;
      }),
    ).toEqual(["oneuptime_label"]);
    expect(
      comparison.resource.removed.map((page) => {
        return page.name;
      }),
    ).toEqual(["oneuptime_probe"]);
  });

  test("a page's text comes back whole, whatever its characters", () => {
    const unicode = providerPage({
      name: "oneuptime_status_page",
      description: "स्थिति पृष्ठ — a page with “quotes” and emoji 🚦.",
    });
    const directory = providerRepository([
      { tag: "v1.0.0", files: { "main.go": "x" } },
      {
        tag: "v1.1.0",
        files: { [pagePath("oneuptime_status_page")]: unicode },
      },
    ]);
    try {
      expect(
        readChangedPages(directory, "v1.0.0", "v1.1.0").currentPages.get(
          pagePath("oneuptime_status_page"),
        ),
      ).toBe(unicode);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a ref the repository does not have fails, saying which", () => {
    expect(() => {
      return readChangedPages(repository, "v0.9.0", "v1.1.0");
    }).toThrow(/v0\.9\.0/);
  });

  test("reads the OneUptime commit a release's commit was generated from", () => {
    expect(oneUptimeCommitOf(repository, "v1.0.0")).toBe(ONEUPTIME_FROM);
    expect(oneUptimeCommitOf(repository, "v1.1.0")).toBeNull();
    // Only a commit's name counts.
    expect(oneUptimeCommitOf(repository, "v1.2.0")).toBeNull();
  });
});

describe("OneUptime's pull requests", () => {
  const range = `${ONEUPTIME_FROM}...${ONEUPTIME_TO}`;
  const commits = [
    commitNamed(1, "fix(terraform): a permission is written as its key"),
    commitNamed(2, "feat(probes): a probe's release"),
    commitNamed(3, "fix(terraform): refuse a secret's type changed alone"),
    commitNamed(4, "feat(incidents): SLA rules"),
    commitNamed(5, "docs(terraform): a guide on labels"),
    commitNamed(6, "fix(ui): a crumb gives way"),
    commitNamed(7, "Terraform: an apply converges"),
    commitNamed(8, "feat(terraform)!: labels a rule adds stay"),
  ];
  const pullRequestsOf = {
    [shaOf(1)]: [
      pullRequest(101, "fix(terraform): a permission is written as its key"),
    ],
    // A pull request of another area that brought a commit of the provider's.
    [shaOf(2)]: [
      pullRequest(
        102,
        "feat(probes): a probe's release, and Terraform checks a secret's type at plan time",
      ),
    ],
    [shaOf(3)]: [
      pullRequest(
        102,
        "feat(probes): a probe's release, and Terraform checks a secret's type at plan time",
      ),
    ],
    [shaOf(4)]: [pullRequest(103, "feat(incidents): SLA rules")],
    // Pushed straight to main: GitHub answers with the gate that carried it.
    [shaOf(5)]: [
      pullRequest(9, "Release 1.1.0 (CI gate - do not merge)", {
        base: "release",
      }),
    ],
    [shaOf(6)]: [],
    [shaOf(7)]: [pullRequest(104, "Terraform: an apply converges")],
    [shaOf(8)]: [pullRequest(105, "feat(terraform)!: labels a rule adds stay")],
  };

  async function changesOf(fake) {
    return findOneUptimeChanges({
      github: createGitHub({
        token: "token",
        fetcher: fake.fetcher,
        sleep: async () => {},
        api: "https://github.example",
      }),
      version: "1.1.0",
      from: ONEUPTIME_FROM,
      to: ONEUPTIME_TO,
    });
  }

  test("lists the provider's: by a title, by a commit, or pushed straight to main", async () => {
    const fake = fakeOneUptimeGitHub({
      ranges: { [range]: commits },
      pullRequestsOf,
    });
    const { from, entries } = await changesOf(fake);

    expect(from).toBe(ONEUPTIME_FROM);
    expect(
      entries.map(({ section, area, text, reference }) => {
        return { section, area, text, reference };
      }),
    ).toEqual([
      {
        section: "fixes",
        area: null,
        text: "a permission is written as its key",
        reference:
          "[OneUptime/oneuptime#101](https://github.com/OneUptime/oneuptime/pull/101)",
      },
      {
        section: "features",
        area: "Probes",
        text: "a probe's release, and Terraform checks a secret's type at plan time",
        reference:
          "[OneUptime/oneuptime#102](https://github.com/OneUptime/oneuptime/pull/102)",
      },
      {
        section: "features",
        area: null,
        text: "an apply converges",
        reference:
          "[OneUptime/oneuptime#104](https://github.com/OneUptime/oneuptime/pull/104)",
      },
      {
        section: "breaking",
        area: null,
        text: "labels a rule adds stay",
        reference:
          "[OneUptime/oneuptime#105](https://github.com/OneUptime/oneuptime/pull/105)",
      },
      {
        section: "docs",
        area: null,
        text: "a guide on labels",
        reference: `[${shaOf(5).slice(0, 7)}](https://github.com/OneUptime/oneuptime/commit/${shaOf(5)})`,
      },
    ]);
  });

  test("asks with the token", async () => {
    const fake = fakeOneUptimeGitHub({
      ranges: { [range]: commits },
      pullRequestsOf,
    });
    await changesOf(fake);
    expect(fake.requests.length).toBeGreaterThan(0);
    expect(
      fake.requests.every((request) => {
        return request.authorization === "Bearer token";
      }),
    ).toBe(true);
    expect(fake.requests[0].url).toBe(
      `https://github.example/repos/OneUptime/oneuptime/compare/${range}?per_page=100&page=1`,
    );
  });

  test("a range from a ref OneUptime does not have starts at its newest release older than this one", async () => {
    const fake = fakeOneUptimeGitHub({
      ranges: { [`1.0.5...${ONEUPTIME_TO}`]: [commits[0]] },
      pullRequestsOf,
      releases: [
        { tag_name: "1.1.0", draft: true, prerelease: false },
        { tag_name: "1.0.5", draft: false, prerelease: false },
        { tag_name: "1.0.4", draft: false, prerelease: false },
      ],
    });
    const { from, entries } = await changesOf(fake);
    expect(from).toBe("1.0.5");
    expect(entries).toHaveLength(1);
  });

  test("what is not a 404 is not worked around", async () => {
    const fake = fakeOneUptimeGitHub({
      ranges: { [range]: commits },
      pullRequestsOf,
      failures: [401],
    });
    await expect(changesOf(fake)).rejects.toThrow(/401/);
  });

  test("whose area is the provider's, alone or among others", () => {
    expect(isTheProviders("fix(terraform): x")).toBe(true);
    expect(isTheProviders("feat(terraform, crossplane): x")).toBe(true);
    expect(isTheProviders("feat(opentofu): x")).toBe(true);
    expect(isTheProviders("fix(terraform-provider): x")).toBe(true);
    expect(isTheProviders("Terraform: x")).toBe(true);
    expect(isTheProviders("test(terraform): x")).toBe(true);
    expect(isTheProviders("fix(crossplane): Terraform's jsonencode()")).toBe(
      false,
    );
    expect(isTheProviders("fix(dashboard): a resource's Terraform page")).toBe(
      false,
    );
  });
});

describe("the notes", () => {
  const comparisonOf = (previous, current) => {
    return compareReleases(new Map(previous), new Map(current));
  };

  const comparison = comparisonOf(
    [
      [pagePath("oneuptime_monitor"), monitorPage()],
      [
        pagePath("oneuptime_incident_owner"),
        providerPage({
          name: "oneuptime_incident_owner",
          attributes: { optional: { is_owner_notified: { type: "Boolean" } } },
        }),
      ],
      [
        pagePath("oneuptime_old_thing"),
        providerPage({ name: "oneuptime_old_thing" }),
      ],
      [
        pagePath("oneuptime_monitor", "Data Source"),
        providerPage({ ...MONITOR, kind: "Data Source" }),
      ],
    ],
    [
      [
        pagePath("oneuptime_monitor"),
        monitorPage((monitor) => {
          monitor.attributes.optional.timeout = { type: "Number" };
          monitor.attributes.optional.retries = { type: "Number" };
          monitor.attributes.readOnly.checked_at = {};
          monitor.attributes.required.monitor_type.allowed.push("Ceph");
          monitor.attributes.optional.is_paused.defaultValue = "true";
        }),
      ],
      [
        pagePath("oneuptime_incident_owner"),
        providerPage({ name: "oneuptime_incident_owner" }),
      ],
      [
        pagePath("oneuptime_label"),
        providerPage({
          name: "oneuptime_label",
          description:
            "A label groups resources, e.g. monitors. It has a color too.",
        }),
      ],
      [
        pagePath("oneuptime_label", "Data Source"),
        providerPage({ name: "oneuptime_label", kind: "Data Source" }),
      ],
      [
        pagePath("oneuptime_monitor", "Data Source"),
        providerPage({
          ...MONITOR,
          kind: "Data Source",
          attributes: {
            ...MONITOR.attributes,
            optional: { ...MONITOR.attributes.optional, timeout: {} },
          },
        }),
      ],
    ],
  );

  const entries = [
    {
      section: "breaking",
      area: null,
      text: "labels a rule adds stay",
      reference:
        "[OneUptime/oneuptime#105](https://github.com/OneUptime/oneuptime/pull/105)",
    },
    {
      section: "fixes",
      area: null,
      text: "a permission is written as its key",
      reference:
        "[OneUptime/oneuptime#101](https://github.com/OneUptime/oneuptime/pull/101)",
    },
    {
      section: "features",
      area: "Probes",
      text: "a probe's release",
      reference:
        "[OneUptime/oneuptime#102](https://github.com/OneUptime/oneuptime/pull/102)",
    },
    {
      section: "maintenance",
      area: null,
      text: "a test of labels",
      reference:
        "[OneUptime/oneuptime#106](https://github.com/OneUptime/oneuptime/pull/106)",
    },
  ];

  const notes = renderReleaseNotes({
    version: "1.1.0",
    previous: "v1.0.0",
    comparison,
    oneUptime: { from: ONEUPTIME_FROM, to: ONEUPTIME_TO, entries },
  });

  test("open with what the release is and what changed since the one before", () => {
    const opening = notes.split("\n")[0];
    expect(opening).toBe(
      "The provider for [OneUptime 1.1.0](https://github.com/OneUptime/oneuptime/releases/tag/1.1.0), generated from its API. **1 new resource, 1 new data source, 2 changed resources, 1 changed data source, 1 removed resource and 4 changes to the provider since [v1.0.0](https://github.com/OneUptime/terraform-provider-oneuptime/releases/tag/v1.0.0).** 3 of them break a configuration that worked before: read Breaking changes first.",
    );
  });

  test("say what breaks first: in the schema, and in OneUptime's pull requests", () => {
    const breaking = notes.slice(
      notes.indexOf("## ⚠️ Breaking changes"),
      notes.indexOf("## 🧩"),
    );
    expect(breaking).toContain("- Resource `oneuptime_old_thing` is removed.");
    expect(breaking).toContain(
      "- Resource `oneuptime_incident_owner`: `is_owner_notified` is removed.",
    );
    expect(breaking).toContain(
      "- Labels a rule adds stay ([OneUptime/oneuptime#105](https://github.com/OneUptime/oneuptime/pull/105))",
    );
    expect(notes.indexOf("## ⚠️ Breaking changes")).toBeLessThan(
      notes.indexOf("## 🧩 New resources and data sources"),
    );
  });

  test("link each new resource and data source to its page, with what it does", () => {
    expect(notes).toContain(
      `- [\`oneuptime_label\`](${REGISTRY}/1.1.0/docs/resources/label): A label groups resources, e.g. monitors.`,
    );
    expect(notes).toContain(
      `Data source: [\`oneuptime_label\`](${REGISTRY}/1.1.0/docs/data-sources/label).`,
    );
  });

  test("list what changed in the resources there were, in a line each, data sources folded", () => {
    expect(notes).toContain(
      "- `oneuptime_monitor`: new `retries` and `timeout`; new read-only `checked_at`; `monitor_type` takes `Ceph` too; `is_paused` defaults to `true` now, not `false`.",
    );
    expect(notes).toContain(
      "<details>\n<summary>1 data source</summary>\n\n- `oneuptime_monitor`: new `timeout`.\n\n</details>",
    );
    // A resource whose changes all break is said in Breaking changes alone.
    const changed = notes.slice(notes.indexOf("## 🔁"));
    expect(changed).not.toContain("oneuptime_incident_owner");
  });

  test("sort OneUptime's pull requests as its own notes do, Maintenance folded", () => {
    expect(notes).toContain(
      "## ✨ New and improved\n\n- **Probes:** A probe's release ([OneUptime/oneuptime#102](https://github.com/OneUptime/oneuptime/pull/102))",
    );
    expect(notes).toContain(
      "## 🐛 Bug fixes\n\n- A permission is written as its key ([OneUptime/oneuptime#101](https://github.com/OneUptime/oneuptime/pull/101))",
    );
    expect(notes).toContain(
      "<details>\n<summary>🧰 Maintenance (1)</summary>\n\n- A test of labels",
    );
  });

  test("say how to install it, with Terraform or OpenTofu", () => {
    expect(notes).toContain(
      [
        "## ⬇️ Install",
        "",
        "```hcl",
        "terraform {",
        "  required_providers {",
        "    oneuptime = {",
        '      source  = "oneuptime/oneuptime"',
        '      version = "~> 1.1.0"',
        "    }",
        "  }",
        "}",
        "```",
      ].join("\n"),
    );
    expect(notes).toContain(
      "The same block works with OpenTofu. The provider is on the [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime/1.1.0) and the [OpenTofu Registry](https://search.opentofu.org/provider/oneuptime/oneuptime/v1.1.0)",
    );
  });

  test("end with where every change is, the provider's and OneUptime's", () => {
    expect(notes).toContain(
      "**Full changelog:** https://github.com/OneUptime/terraform-provider-oneuptime/compare/v1.0.0...v1.1.0",
    );
    expect(notes.trim().split("\n").pop()).toBe(
      `**OneUptime's changes:** https://github.com/OneUptime/oneuptime/compare/${ONEUPTIME_FROM}...${ONEUPTIME_TO}`,
    );
  });

  test("differ from one release to the next", () => {
    const quiet = renderReleaseNotes({
      version: "1.2.0",
      previous: "v1.1.0",
      comparison: comparisonOf([], []),
      oneUptime: null,
    });
    expect(quiet).not.toBe(notes);
    expect(quiet.split("\n")[0]).toBe(
      "The provider for [OneUptime 1.2.0](https://github.com/OneUptime/oneuptime/releases/tag/1.2.0), generated from its API. No resource or data source changed since [v1.1.0](https://github.com/OneUptime/terraform-provider-oneuptime/releases/tag/v1.1.0).",
    );
    expect(quiet).not.toContain("## ⚠️");
    expect(quiet).not.toContain("## 🧩");
    expect(quiet).not.toContain("## 🔁");
    expect(quiet).not.toContain("OneUptime's changes");
  });

  test("with no release before it, say so, and link to no comparison", () => {
    const first = renderReleaseNotes({
      version: "1.0.0",
      previous: null,
      comparison: null,
      oneUptime: null,
    });
    expect(first.split("\n")[0]).toBe(
      "The provider for [OneUptime 1.0.0](https://github.com/OneUptime/oneuptime/releases/tag/1.0.0), generated from its API. There is no earlier release to compare it with.",
    );
    expect(first).not.toContain("Full changelog");
    expect(first).toContain("## ⬇️ Install");
  });

  test("when the pages could not be read, point at the full changelog", () => {
    const unread = renderReleaseNotes({
      version: "1.1.0",
      previous: "v1.0.0",
      comparison: null,
      oneUptime: null,
    });
    expect(unread.split("\n")[0]).toContain(
      "What changed since [v1.0.0](https://github.com/OneUptime/terraform-provider-oneuptime/releases/tag/v1.0.0) is in the full changelog below.",
    );
    expect(unread).toContain("**Full changelog:**");
  });

  test("when OneUptime's pull requests could not be read, link to its changes and say so", () => {
    const unread = renderReleaseNotes({
      version: "1.1.0",
      previous: "v1.0.0",
      comparison,
      oneUptime: { from: ONEUPTIME_FROM, to: ONEUPTIME_TO, entries: null },
    });
    expect(unread).toContain(
      `**OneUptime's changes:** https://github.com/OneUptime/oneuptime/compare/${ONEUPTIME_FROM}...${ONEUPTIME_TO} (its pull requests could not be read for these notes)`,
    );
    expect(unread).not.toContain("## 🐛 Bug fixes");
    expect(unread).toContain("## ⚠️ Breaking changes");
  });

  test("a name with GitHub's markup in its description stays text", () => {
    const tagged = renderReleaseNotes({
      version: "1.1.0",
      previous: "v1.0.0",
      comparison: comparisonOf(
        [],
        [
          [
            pagePath("oneuptime_widget"),
            providerPage({
              name: "oneuptime_widget",
              description: "Reads /install/<agent> for @hono/node-server.",
            }),
          ],
        ],
      ),
      oneUptime: null,
    });
    expect(tagged).toContain(
      ": Reads `/install/<agent>` for `@hono/node-server.`",
    );
  });

  test("stay within what GitHub takes, keeping the way to install it and to the rest", () => {
    const many = [];
    for (let index = 0; index < 400; index += 1) {
      const name = `oneuptime_thing_${String(index).padStart(3, "0")}`;
      const attributes = {};
      for (let attribute = 0; attribute < 40; attribute += 1) {
        attributes[`a_long_attribute_name_number_${attribute}`] = {};
      }
      many.push([pagePath(name), { name, attributes }]);
    }
    const huge = renderReleaseNotes({
      version: "1.1.0",
      previous: "v1.0.0",
      comparison: comparisonOf(
        many.map(([file, { name }]) => {
          return [file, providerPage({ name })];
        }),
        many.map(([file, { name, attributes }]) => {
          return [
            file,
            providerPage({ name, attributes: { optional: attributes } }),
          ];
        }),
      ),
      oneUptime: { from: ONEUPTIME_FROM, to: ONEUPTIME_TO, entries },
    });

    expect(huge.length).toBeLessThanOrEqual(MAX_NOTES_LENGTH);
    expect(huge).toContain("## ⬇️ Install");
    expect(huge).toContain("**Full changelog:**");
    expect(huge).toContain("too long for GitHub");
  });

  test("of a version published again say which, and why, and install the new one", () => {
    const republished = renderRepublishNotes({
      version: "17.1.1",
      republishOf: "v17.1.0",
    });
    expect(republished.split("\n")[0]).toBe(
      "This is [v17.1.0](https://github.com/OneUptime/terraform-provider-oneuptime/releases/tag/v17.1.0)'s provider, published again as v17.1.1, unchanged: it is built from the same commit.",
    );
    expect(republished).toContain(
      "so `terraform init` and `tofu init` refuse v17.1.0 with `checksum list has unexpected SHA-256 hash` (#20)",
    );
    expect(republished).toContain('version = "~> 17.1.1"');
    expect(republished).toContain(
      "**Full changelog:** https://github.com/OneUptime/terraform-provider-oneuptime/compare/v17.1.0...v17.1.1",
    );
  });
});

describe("running it", () => {
  let repository;

  beforeAll(() => {
    repository = providerRepository([
      {
        tag: "v1.0.0",
        message: withTrailer("v1.0.0", ONEUPTIME_FROM),
        files: { [pagePath("oneuptime_monitor")]: monitorPage() },
      },
      {
        tag: "v1.1.0",
        message: withTrailer("v1.1.0", ONEUPTIME_TO),
        files: {
          [pagePath("oneuptime_monitor")]: monitorPage((monitor) => {
            monitor.attributes.optional.timeout = {};
          }),
        },
      },
    ]);
  });

  afterAll(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  function options(overrides = {}) {
    return {
      ...parseArguments([
        "--version",
        "1.1.0",
        "--provider-dir",
        repository,
        "--previous",
        "v1.0.0",
        "--fallback-on-error",
      ]),
      ...overrides,
    };
  }

  async function notesOf(givenOptions, tools = {}) {
    let written = null;
    const warnings = [];
    await run(givenOptions, {
      sleep: async () => {},
      api: "https://github.example",
      write: (notes) => {
        written = notes;
      },
      warn: (text) => {
        warnings.push(text);
      },
      ...tools,
    });
    return { notes: written, warnings };
  }

  test("writes the notes from both releases' pages and OneUptime's pull requests between their commits", async () => {
    const fake = fakeOneUptimeGitHub({
      ranges: {
        [`${ONEUPTIME_FROM}...${ONEUPTIME_TO}`]: [
          commitNamed(1, "fix(terraform): a permission is written as its key"),
        ],
      },
    });
    const { notes, warnings } = await notesOf(options(), {
      token: "token",
      fetcher: fake.fetcher,
    });

    expect(warnings).toEqual([]);
    expect(notes).toContain("- `oneuptime_monitor`: new `timeout`.");
    expect(notes).toContain(
      "## 🐛 Bug fixes\n\n- A permission is written as its key",
    );
    expect(fake.requests[0].url).toContain(
      `/compare/${ONEUPTIME_FROM}...${ONEUPTIME_TO}?`,
    );
  });

  test("the commit a release names wins over --oneuptime-to, which is for a commit that names none", async () => {
    const fake = fakeOneUptimeGitHub({ ranges: {} });
    await notesOf(options({ oneUptimeTo: shaOf(0xabc) }), {
      token: "token",
      fetcher: fake.fetcher,
    });
    expect(fake.requests[0].url).toContain(
      `/compare/${ONEUPTIME_FROM}...${ONEUPTIME_TO}?`,
    );
  });

  test("a previous release whose commit names none starts at OneUptime's release of its version", async () => {
    const directory = providerRepository([
      {
        tag: "v1.0.0",
        files: { [pagePath("oneuptime_monitor")]: monitorPage() },
      },
      {
        tag: "v1.1.0",
        files: { [pagePath("oneuptime_monitor")]: monitorPage() },
      },
    ]);
    try {
      const fake = fakeOneUptimeGitHub({
        ranges: { [`1.0.0...${ONEUPTIME_TO}`]: [] },
      });
      const { notes } = await notesOf(
        options({ providerDir: directory, oneUptimeTo: ONEUPTIME_TO }),
        { token: "token", fetcher: fake.fetcher },
      );
      expect(fake.requests[0].url).toContain(
        `/compare/1.0.0...${ONEUPTIME_TO}?`,
      );
      expect(notes).toContain(
        `**OneUptime's changes:** https://github.com/OneUptime/oneuptime/compare/1.0.0...${ONEUPTIME_TO}`,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("without a token, it asks GitHub nothing and leaves OneUptime's changes out", async () => {
    const fake = fakeOneUptimeGitHub({ ranges: {} });
    const { notes } = await notesOf(options(), {
      token: null,
      fetcher: fake.fetcher,
    });
    expect(fake.requests).toEqual([]);
    expect(notes).toContain("- `oneuptime_monitor`: new `timeout`.");
    expect(notes).not.toContain("OneUptime's changes");
  });

  test("when GitHub cannot be read, warns and links to OneUptime's changes; without --fallback-on-error, fails", async () => {
    const failing = () => {
      return fakeOneUptimeGitHub({
        ranges: {},
        failures: [502, 502, 502, 502],
      });
    };
    const { notes, warnings } = await notesOf(options(), {
      token: "token",
      fetcher: failing().fetcher,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^OneUptime's pull requests for v1\.1\.0 could not be read/,
    );
    expect(notes).toContain(
      "(its pull requests could not be read for these notes)",
    );
    expect(notes).toContain("- `oneuptime_monitor`: new `timeout`.");

    await expect(
      notesOf(options({ fallbackOnError: false }), {
        token: "token",
        fetcher: failing().fetcher,
      }),
    ).rejects.toThrow(/502/);
  });

  test("a previous release the clone does not have: warns, and points at the changelog", async () => {
    const { notes, warnings } = await notesOf(options({ previous: "v0.9.0" }), {
      token: null,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^What changed since v0\.9\.0 could not be read/,
    );
    expect(notes).toContain("is in the full changelog below.");
  });

  test("a version published again gets the notes that say so", async () => {
    const { notes } = await notesOf(options({ republishOf: "v1.0.0" }), {
      token: null,
    });
    expect(notes).toMatch(/^This is \[v1\.0\.0\]/);
  });

  test("its options: what it needs, and an empty value as no value", () => {
    expect(() => {
      return parseArguments(["--provider-dir", "x"]);
    }).toThrow(/--version/);
    expect(() => {
      return parseArguments(["--version", "1.1.0"]);
    }).toThrow(/--provider-dir/);
    expect(() => {
      return parseArguments(["--version", "1.1.0", "--nope"]);
    }).toThrow(/--nope/);
    expect(
      parseArguments([
        "--version",
        "1.1.0-test",
        "--provider-dir",
        "x",
        "--previous",
        "",
        "--oneuptime-to",
        "",
      ]),
    ).toMatchObject({
      version: "1.1.0-test",
      previous: null,
      oneUptimeTo: null,
    });
  });

  test("from the command line, as the publish script runs it", () => {
    const output = path.join(tempDirectory("provider-notes-out-"), "notes.md");
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--version",
        "1.1.0",
        "--provider-dir",
        repository,
        "--ref",
        "v1.1.0",
        "--previous",
        "v1.0.0",
        "--output",
        output,
        "--fallback-on-error",
      ],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: os.tmpdir() },
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(fs.readFileSync(output, "utf8")).toContain(
      "- `oneuptime_monitor`: new `timeout`.",
    );

    const missing = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/^GenerateReleaseNotes: --version/);
  });
});
