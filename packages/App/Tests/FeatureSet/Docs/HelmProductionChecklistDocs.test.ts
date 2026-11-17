import { DocsHeading, DocsLink, scanMarkdown } from "./DocsContentSupport";
import { inlineCode } from "./DocsTranslationChecks";
import { parseYaml } from "Common/Tests/Helpers/Yaml";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Helm chart's production readiness checklist
 * (HelmChart/Public/oneuptime/docs/production-checklist.md): what a OneUptime
 * on Kubernetes needs before real traffic, what keeps it up through failures,
 * and what to do as it grows. It is three parts, so that a small install can
 * stop after the first, and each item says what to set rather than how the
 * chart works inside: the long explanations are on the pages it links to,
 * such as Sizing ClickHouse inserts in the configuration reference.
 *
 * These tests keep it true. Every value it sets or names is one the chart's
 * values.yaml has, or a Kubernetes field the chart passes through (listed
 * below, each with its reason); every link lands on a file and on a heading
 * GitHub draws there; the Secrets and keys it says to copy on an install that
 * already runs are the ones the chart writes; and every number it quotes is
 * the chart's or the app's own default.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DOCS_DIR: string = path.join(
  REPO_ROOT,
  "HelmChart/Public/oneuptime/docs",
);
const CHECKLIST_FILE: string = path.join(DOCS_DIR, "production-checklist.md");
const CONFIGURATION_FILE: string = path.join(DOCS_DIR, "configuration.md");
const GITHUB_BLOB: string = "https://github.com/OneUptime/oneuptime/blob/main/";

function repoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// Text with every run of whitespace as one space: prose wraps where it likes.
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

const CHECKLIST: string = fs.readFileSync(CHECKLIST_FILE, "utf8");
const CONFIGURATION: string = fs.readFileSync(CONFIGURATION_FILE, "utf8");
const VALUES_TEXT: string = repoFile("HelmChart/Public/oneuptime/values.yaml");
const VALUES: unknown = parseYaml(VALUES_TEXT);

const PARTS: Array<string> = [
  "1. Before you go live",
  "2. Stay up through failures",
  "3. Scale up",
];

// What every install does, in the order it does it: email first.
const FIRST_PART: Array<string> = [
  "Reach people",
  "Keep your keys and passwords",
  "Pin versions",
  "Back up your data",
  "Stay current",
];

// What a large install does, once it shows a sign the part's table names.
const THIRD_PART: Array<string> = [
  "Run background jobs in their own pods",
  "Size the Postgres connections",
  "Autoscale with KEDA",
  "Keep ClickHouse inserts in budget",
];

/*
 * Values the pages name that values.yaml does not spell out, each with its
 * reason. A path that no page names any more leaves the list.
 */
const NOT_IN_VALUES: Record<string, { parent: string; reason: string }> = {
  "app.resources.requests.cpu": {
    parent: "app.resources",
    reason:
      "a Kubernetes resource request: app.resources goes to the pod as written",
  },
  "telemetryWriter.resources.requests": {
    parent: "telemetryWriter.resources",
    reason:
      "Kubernetes resource requests: telemetryWriter.resources goes to the pod as written",
  },
  "deployment.updateStrategy.rollingUpdate.maxUnavailable": {
    parent: "deployment.updateStrategy",
    reason:
      "a Kubernetes Deployment strategy field: deployment.updateStrategy goes to every Deployment as written",
  },
  "keda.install": {
    parent: "keda",
    reason:
      "commented out in values.yaml, so that it follows keda.enabled until someone sets it",
  },
};

/*
 * The keys and passwords the checklist says to copy on an install that
 * already runs: the Secret the chart keeps each in (after the release's
 * name), its key there, and the value that sets it. `<name>` is a probe's key
 * under `probes`.
 */
const COPIED: Array<{ secret: string; key: string; value: string }> = [
  { secret: "secrets", key: "oneuptime-secret", value: "oneuptimeSecret" },
  { secret: "secrets", key: "encryption-secret", value: "encryptionSecret" },
  { secret: "secrets", key: "register-probe-key", value: "registerProbeKey" },
  { secret: "secrets", key: "probe-<name>", value: "probes.<name>.key" },
  { secret: "secrets", key: "global-runner-key", value: "globalRunner.key" },
  {
    secret: "postgresql",
    key: "postgres-password",
    value: "postgresql.auth.postgresPassword",
  },
  {
    secret: "clickhouse",
    key: "admin-password",
    value: "clickhouse.auth.password",
  },
  { secret: "valkey", key: "valkey-password", value: "valkey.auth.password" },
];

// `a.b.c` in inline code: a value's path, as the pages name one.
const VALUE_PATH: RegExp = /^[a-z][A-Za-z0-9]*(?:\.(?:[A-Za-z0-9]+|<name>))+$/;

// `values.yaml` and the like: a file, not a value.
const FILE_NAME: RegExp = /\.(?:md|ya?ml)$/;

// A page on the web, which these tests do not fetch.
const WEB_ADDRESS: RegExp = /^https:\/\//;

// "a.b.c" for every leaf and branch of a YAML document.
function valuePaths(value: unknown, prefix: string = ""): Array<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]: [string, unknown]): Array<string> => {
      const here: string = prefix ? `${prefix}.${key}` : key;

      return [here, ...valuePaths(child, here)];
    },
  );
}

const CHART_PATHS: Set<string> = new Set(valuePaths(VALUES));

function valueAt(document: unknown, valuePath: string): unknown {
  return valuePath.split(".").reduce((node: unknown, key: string): unknown => {
    return node && typeof node === "object"
      ? (node as Record<string, unknown>)[key]
      : undefined;
  }, document);
}

// A probe's key stands for every probe: the chart ships one, `one`.
function asChartPath(valuePath: string): string {
  return valuePath.replace(/<name>/g, "one");
}

// The paths a page names in inline code: `a.b.c`, or `a.b.c: value`.
function namedValues(markdown: string): Array<string> {
  return inlineCode(markdown)
    .map((code: string): string => {
      return (code.split(":")[0] as string).trim();
    })
    .filter((code: string): boolean => {
      return VALUE_PATH.test(code) && !FILE_NAME.test(code);
    });
}

// A fence's code without the indentation of the list item it sits in.
function dedent(code: string): string {
  const lines: Array<string> = code.split("\n");
  const indent: number = Math.min(
    ...lines
      .filter((line: string): boolean => {
        return line.trim() !== "";
      })
      .map((line: string): number => {
        return (line.match(/^ */) as RegExpMatchArray)[0].length;
      }),
  );

  return lines
    .map((line: string): string => {
      return line.slice(indent);
    })
    .join("\n");
}

function yamlBlocks(markdown: string): Array<unknown> {
  return scanMarkdown(markdown)
    .fences.filter((fence: { lang: string }): boolean => {
      return fence.lang === "yaml";
    })
    .map((fence: { code: string }): unknown => {
      return parseYaml(dedent(fence.code));
    });
}

/*
 * The anchors GitHub gives a page's headings: the heading's text in lower
 * case, without its punctuation (a hyphen and an underscore stay), each space
 * a hyphen, and -1, -2 after a heading met before. The chart's docs are read
 * on GitHub, so their links use these rather than the docs site's own.
 */
function githubSlug(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, "")
    .replace(/ /g, "-");
}

function githubAnchors(markdown: string): Array<string> {
  const seen: Map<string, number> = new Map();

  return scanMarkdown(markdown).headings.map((heading: DocsHeading): string => {
    const slug: string = githubSlug(heading.text);
    const times: number = seen.get(slug) || 0;

    seen.set(slug, times + 1);

    return times === 0 ? slug : `${slug}-${times}`;
  });
}

// The part of a page under a heading, down to the next heading of its level or above.
function sectionOf(markdown: string, level: number, text: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((heading: DocsHeading): boolean => {
    return heading.level === level && heading.text === text;
  });

  if (index === -1) {
    throw new Error(`No heading "${"#".repeat(level)} ${text}"`);
  }

  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((heading: DocsHeading): boolean => {
      return heading.level <= level;
    });

  return markdown
    .split("\n")
    .slice(headings[index]!.line - 1, next ? next.line - 1 : undefined)
    .join("\n");
}

function headingsOf(markdown: string, level: number): Array<string> {
  return scanMarkdown(markdown)
    .headings.filter((heading: DocsHeading): boolean => {
      return heading.level === level;
    })
    .map((heading: DocsHeading): string => {
      return heading.text;
    });
}

// Each link that does not land: no file, or no such heading in it.
function brokenLinks(markdown: string, file: string): Array<string> {
  return scanMarkdown(markdown)
    .links.map((link: DocsLink): string => {
      return link.target;
    })
    .filter((target: string): boolean => {
      if (target.startsWith(GITHUB_BLOB)) {
        return !fs.existsSync(
          path.join(REPO_ROOT, target.slice(GITHUB_BLOB.length).split("#")[0]!),
        );
      }

      if (WEB_ADDRESS.test(target)) {
        return false;
      }

      const [page, anchor] = target.split("#") as [string, string | undefined];
      const landing: string = page
        ? path.resolve(path.dirname(file), page)
        : file;

      if (!fs.existsSync(landing)) {
        return true;
      }

      return (
        anchor !== undefined &&
        !githubAnchors(fs.readFileSync(landing, "utf8")).includes(anchor)
      );
    });
}

describe("the Helm chart's production readiness checklist", () => {
  it("is three parts, in order, each linked from the table at the top", () => {
    const top: string = CHECKLIST.slice(
      0,
      CHECKLIST.indexOf(`\n## ${PARTS[0]}\n`),
    );

    expect(headingsOf(CHECKLIST, 1)).toEqual([
      "Production Readiness Checklist",
    ]);
    expect(headingsOf(CHECKLIST, 2)).toEqual(PARTS);
    expect(
      scanMarkdown(top).links.map((link: DocsLink): string => {
        return link.target;
      }),
    ).toEqual(
      PARTS.map((part: string): string => {
        return `#${githubSlug(part)}`;
      }),
    );
    // Most installs stop after the first part, and the page says so.
    expect(flat(top)).toContain("most installs need only the first");
  });

  it("puts what every install needs in the first part, email first", () => {
    expect(headingsOf(sectionOf(CHECKLIST, 2, PARTS[0]!), 3)).toEqual(
      FIRST_PART,
    );
    expect(headingsOf(sectionOf(CHECKLIST, 2, PARTS[1]!), 3)).toEqual([]);
  });

  it("opens the last part with the signs that call for it, each linked to the section that answers it", () => {
    const part: string = sectionOf(CHECKLIST, 2, PARTS[2]!);
    const anchors: Array<string> = THIRD_PART.map((text: string): string => {
      return `#${githubSlug(text)}`;
    });
    const signs: Array<string> = scanMarkdown(
      part.slice(0, part.indexOf(`\n### ${THIRD_PART[0]}\n`)),
    ).links.map((link: DocsLink): string => {
      return link.target;
    });

    expect(headingsOf(part, 3)).toEqual(THIRD_PART);
    expect(signs.length).toBeGreaterThanOrEqual(THIRD_PART.length);
    for (const sign of signs) {
      expect({ sign, answered: anchors.includes(sign) }).toEqual({
        sign,
        answered: true,
      });
    }
    for (const anchor of anchors) {
      expect({ anchor, linked: signs.includes(anchor) }).toEqual({
        anchor,
        linked: true,
      });
    }
  });

  it("sets only values the chart's values.yaml has", () => {
    const set: Array<string> = yamlBlocks(CHECKLIST).flatMap(
      (block: unknown): Array<string> => {
        return valuePaths(block);
      },
    );

    expect(set).toEqual(
      expect.arrayContaining([
        "httpProtocol",
        "encryptionSecret",
        "postgresql.auth.postgresPassword",
        "image.tag",
        "podDisruptionBudget.enabled",
        "postgresOperator.cnpg.instances",
        "worker.enabled",
        "pgbouncer.enabled",
        "telemetryWriter.enabled",
      ]),
    );
    for (const value of set) {
      expect({ value, inChart: CHART_PATHS.has(value) }).toEqual({
        value,
        inChart: true,
      });
    }
  });

  it("names only values the chart's values.yaml has, or a Kubernetes field the chart passes through", () => {
    const named: Array<string> = [
      ...namedValues(CHECKLIST),
      ...namedValues(sectionOf(CONFIGURATION, 3, "Sizing ClickHouse inserts")),
    ];

    expect(named.length).toBeGreaterThan(30);
    for (const value of named) {
      const exception: { parent: string; reason: string } | undefined =
        NOT_IN_VALUES[value];

      expect({
        value,
        inChart: CHART_PATHS.has(asChartPath(value)) || Boolean(exception),
      }).toEqual({ value, inChart: true });
    }
    for (const [value, exception] of Object.entries(NOT_IN_VALUES)) {
      expect({ value, stillNamed: named.includes(value) }).toEqual({
        value,
        stillNamed: true,
      });
      expect({ value, parent: CHART_PATHS.has(exception.parent) }).toEqual({
        value,
        parent: true,
      });
      expect(exception.reason.length).toBeGreaterThan(20);
    }
    // keda.install waits, commented out, under keda.
    expect(VALUES_TEXT).toMatch(/^keda:\n(?: {2}.*\n)* {2}# install: true$/m);
    // deployment.updateStrategy reaches each Deployment as written.
    expect(valueAt(VALUES, "deployment.updateStrategy.type")).toBe(
      "RollingUpdate",
    );
    expect(repoFile("HelmChart/Public/oneuptime/templates/app.yaml")).toContain(
      "strategy: {{- toYaml $.Values.deployment.updateStrategy",
    );
  });

  it("links only to files that exist, and to headings those files have", () => {
    const links: Array<DocsLink> = scanMarkdown(CHECKLIST).links;

    expect(links.length).toBeGreaterThan(20);
    expect(brokenLinks(CHECKLIST, CHECKLIST_FILE)).toEqual([]);
    expect(brokenLinks(CONFIGURATION, CONFIGURATION_FILE)).toEqual([]);
  });

  it("leads email and the rest of /admin/setup with the Self-Hosting Guide beside it", () => {
    const reach: string = sectionOf(CHECKLIST, 3, "Reach people");

    expect(reach).toContain("`https://<host>/admin/setup`");
    expect(reach).toContain(
      "(https://oneuptime.com/docs/installation/self-hosting-guide)",
    );
    expect(valuePaths(yamlBlocks(reach)[0])).toEqual(
      expect.arrayContaining(["host", "httpProtocol", "ssl.provision"]),
    );
  });
});

describe("the keys and passwords the checklist says to keep", () => {
  const section: string = sectionOf(
    CHECKLIST,
    3,
    "Keep your keys and passwords",
  );
  const template: string = repoFile(
    "HelmChart/Public/oneuptime/templates/secrets.yaml",
  );

  // The Secret the chart names `<release>-<secret>`, as its template writes it.
  function secretTemplate(secret: string): string {
    const documents: Array<string> = template.split(/^---[ \t]*$/m);
    const found: Array<string> = documents.filter(
      (document: string): boolean => {
        return (
          document.includes(
            `name: {{ printf "%s-%s" $.Release.Name "${secret}"`,
          ) ||
          new RegExp(
            `^  name: \\{\\{ \\.Release\\.Name \\}\\}-${secret}$`,
            "m",
          ).test(document)
        );
      },
    );

    expect({ secret, documents: found.length }).toEqual({
      secret,
      documents: 1,
    });

    return found[0] as string;
  }

  it("are the keys the chart writes, in the Secrets the command reads", () => {
    for (const copied of COPIED) {
      const document: string = secretTemplate(copied.secret);
      const written: boolean =
        copied.key === "probe-<name>"
          ? document.includes('{{printf "probe-%s" $key}}:')
          : new RegExp(`^\\s+${copied.key}:`, "m").test(document);

      expect({ ...copied, written }).toEqual({ ...copied, written: true });
    }
  });

  it("prints each of those Secrets, and maps each key to the value that sets it", () => {
    const secrets: Array<string> = Array.from(
      new Set(
        COPIED.map((copied: { secret: string }): string => {
          return copied.secret;
        }),
      ),
    );

    expect(section).toContain(`for name in ${secrets.join(" ")}; do`);
    expect(section).toContain('kubectl get secret "my-oneuptime-$name"');
    expect(section).toContain("base64decode");
    for (const copied of COPIED) {
      expect(section).toContain(`| \`${copied.key}\` | \`${copied.value}\` |`);
      expect({
        value: copied.value,
        inChart: CHART_PATHS.has(asChartPath(copied.value)),
      }).toEqual({ value: copied.value, inChart: true });
    }
  });

  it("sets in its example the values the table maps", () => {
    const mapped: Array<string> = COPIED.map(
      (copied: { value: string }): string => {
        return asChartPath(copied.value);
      },
    );
    const leaves: Array<string> = valuePaths(yamlBlocks(section)[0]).filter(
      (value: string): boolean => {
        return typeof valueAt(yamlBlocks(section)[0], value) !== "object";
      },
    );

    expect(leaves).toEqual([
      "oneuptimeSecret",
      "encryptionSecret",
      "probes.one.key",
      "postgresql.auth.postgresPassword",
      "clickhouse.auth.password",
      "valkey.auth.password",
    ]);
    for (const leaf of leaves) {
      expect(mapped).toContain(leaf);
    }
  });

  it("warns an install that already runs to copy the values, not make new ones", () => {
    const text: string = flat(section);

    expect(text).toContain(
      "**Already installed:** copy the values the chart made instead of making new ones.",
    );
    expect(text).toContain(
      "A new `encryptionSecret` cannot read what the old one encrypted",
    );
    expect(text).toContain(
      "a new PostgreSQL password locks OneUptime out of its database",
    );
    expect(text).toContain("a new probe key registers a new probe");
  });
});

describe("the numbers the checklist quotes", () => {
  const text: string = flat(CHECKLIST);

  it("are the defaults of the chart and the app", () => {
    // Every pod's PostgreSQL pool, and the PostgreSQL the chart runs: ten pods fill it.
    const pool: number = Number(
      (
        repoFile("packages/Common/Server/EnvironmentConfig.ts").match(
          /process\.env\["DATABASE_MAX_OPEN_CONNECTIONS"\] \|\| "(\d+)"/,
        ) as RegExpMatchArray
      )[1],
    );
    const maxConnections: number = Number(
      (
        VALUES_TEXT.match(/^\s*max_connections = (\d+)$/m) as RegExpMatchArray
      )[1],
    );

    expect({ pool, maxConnections, pods: maxConnections / pool }).toEqual({
      pool: 50,
      maxConnections: 500,
      pods: 10,
    });
    expect(text).toContain("pod opens up to 50 connections to PostgreSQL");
    expect(text).toContain(
      "500 for the chart's own PostgreSQL, which ten pods already reach",
    );

    // A new pod waits this long for the migrations, then starts again.
    expect(valueAt(VALUES, "migrate.runtimeWaitTimeoutSeconds")).toBe(15 * 60);
    expect(text).toContain("New pods that restart every 15 minutes");

    // What runs by default.
    expect(valueAt(VALUES, "deployment.replicaCount")).toBe(1);
    expect(text).toContain("The chart runs one copy of each service");
    expect(valueAt(VALUES, "worker.enabled")).toBe(false);
    expect(text).toContain(
      "By default the `app` pods serve requests and also run the background jobs",
    );
    expect(valueAt(VALUES, "deployment.spreadReplicasAcrossNodes")).toBe(true);
    expect(text).toContain(
      "(`deployment.spreadReplicasAcrossNodes`, on by default)",
    );
    expect(valueAt(VALUES, "podDisruptionBudget.maxUnavailable")).toBe(1);
    expect(valueAt(VALUES, "podDisruptionBudget.minAvailable")).toBe("");
    expect(text).toContain("at most one pod of each service down at a time");
  });

  it("say which images move by themselves, and which the chart pins", () => {
    // OneUptime's tag moves with every release, and a restart pulls it again.
    expect(valueAt(VALUES, "image.tag")).toBe("release");
    expect(valueAt(VALUES, "image.pullPolicy")).toBe("Always");
    expect(text).toContain("The default tag, `release`, follows every release");

    expect(valueAt(VALUES, "postgresql.image.tag")).toBe("latest");
    expect(text).toContain("Its default tag is `latest`");

    for (const tag of [
      valueAt(VALUES, "clickhouse.image.tag"),
      valueAt(VALUES, "valkey.image.tag"),
    ]) {
      expect(String(tag)).toMatch(/^\d+\.\d+/);
    }
    expect(text).toContain(
      "ClickHouse and Valkey need nothing: the chart pins their versions itself",
    );
  });

  it("turn on failover where the operators' defaults do not", () => {
    const [operators] = yamlBlocks(sectionOf(CHECKLIST, 2, PARTS[1]!)).filter(
      (block: unknown): boolean => {
        return valueAt(block, "postgresOperator") !== undefined;
      },
    );

    // One instance and one replica are what the operators start with: no failover.
    expect(valueAt(VALUES, "postgresOperator.cnpg.instances")).toBe(1);
    expect(
      valueAt(VALUES, "clickhouseOperator.altinity.cluster.replicasCount"),
    ).toBe(1);
    expect(
      valueAt(operators, "postgresOperator.cnpg.instances") as number,
    ).toBeGreaterThanOrEqual(3);
    expect(
      valueAt(
        operators,
        "clickhouseOperator.altinity.cluster.replicasCount",
      ) as number,
    ).toBeGreaterThanOrEqual(2);
    // ClickHouse replicas need a Keeper, which the chart turns on by default.
    expect(valueAt(VALUES, "clickhouseOperator.altinity.keeper.enabled")).toBe(
      true,
    );
  });

  it("size ClickHouse inserts with the chart's own limits", () => {
    const configuration: string = flat(
      sectionOf(CONFIGURATION, 3, "Sizing ClickHouse inserts"),
    );
    const inserts: unknown = valueAt(
      VALUES,
      "worker.telemetryFanInMaxConcurrentInserts",
    );

    expect(inserts).toBe(4);
    expect(valueAt(VALUES, "app.telemetryFanInMaxConcurrentInserts")).toBe(4);
    expect(
      valueAt(VALUES, "telemetryWriter.telemetryFanInMaxConcurrentInserts"),
    ).toBe(4);
    expect(valueAt(VALUES, "telemetryWriter.replicaCount")).toBe(2);
    // Both ClickHouses the chart runs allow 10000 queries at once.
    expect(VALUES_TEXT).toContain(
      "<max_concurrent_queries>10000</max_concurrent_queries>",
    );
    expect(
      valueAt(
        VALUES,
        "clickhouseOperator.altinity.settings.max_concurrent_queries",
      ),
    ).toBe("10000");
    // 60% of 100 queries, 4 inserts a pod: 15 pods.
    expect(Math.floor((100 * 0.6) / 4)).toBe(15);

    for (const page of [text, configuration]) {
      expect(page).toContain("*pods × 4*");
      expect(page).toContain("60%");
      expect(page).toContain("2 × 4");
      expect(page).toContain("allows 10000");
      expect(page).toContain("that allows 100 fits about 15 such pods");
    }
    expect(text).toContain("at most 4 inserts at once");
    expect(configuration).toContain("`telemetryFanInMaxConcurrentInserts` (4)");
  });
});

describe("what points at the checklist and its sizing guidance", () => {
  it("values.yaml's comments name headings the checklist has, and rules it states", () => {
    const anchors: Array<string> = headingsOf(CHECKLIST, 3);
    // A comment that wraps onto the next line reads as one line.
    const comments: string = VALUES_TEXT.replace(/\n[ \t]*#[ \t]*/g, " ");
    const quoted: Array<string> = Array.from(
      comments.matchAll(/"([^"]+)" in docs\/production-checklist\.md/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(quoted).toEqual(["Size the Postgres connections"]);
    for (const heading of quoted) {
      expect(anchors).toContain(heading);
    }
    // The comments that send the ClickHouse insert rule here.
    expect(comments).toMatch(
      /max_concurrent_queries \(see docs\/production-checklist\.md\)/,
    );
    expect(flat(CHECKLIST)).toContain(
      "Keep that under about 60% of ClickHouse's `max_concurrent_queries`",
    );
  });

  it("the configuration reference's writer tier sends you to its own sizing section", () => {
    const writerTier: string = flat(
      sectionOf(CONFIGURATION, 2, "Telemetry writer tier"),
    );

    expect(writerTier).toContain(
      "See [Sizing ClickHouse inserts](#sizing-clickhouse-inserts) below.",
    );
    expect(githubAnchors(CONFIGURATION)).toContain("sizing-clickhouse-inserts");
    expect(CHECKLIST).toContain(
      "[Sizing ClickHouse inserts](configuration.md#sizing-clickhouse-inserts)",
    );
  });
});
