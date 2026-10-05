import {
  AI_AGENT_INSTALL_COMMAND,
  AI_SRE_PAGE,
  CHART_README,
  CHART_SCHEMA,
  CHART_VALUES,
  DOCS_CONTENT_DIR,
  KUBERNETES_AGENT_PAGE,
  PACKAGES_ROOT,
  RUNNER_README,
  UPGRADING_PAGE,
  getBashBlocks,
  getHeadings,
  getSection,
  read,
  readFlat,
  relative,
} from "./KubernetesAiAgentDocsSupport";
import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
  KUBERNETES_AI_AGENT_IMAGE_REPOSITORY,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS } from "Common/Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The upgrade to the Kubernetes AI agent, as the docs describe it, against
 * what the chart and the server do.
 *
 * The chart's ai-agent Deployment replaces the in-cluster Runner that
 * aiAccess.enabled=true installed. The upgrade notes (the docs site's
 * upgrading page, the Kubernetes agent page's Upgrading section and the
 * chart README) must say what an operator needs before running it:
 *
 * - upgrade a self-hosted OneUptime server before the chart (an older
 *   server has no agent API, and the chart has already removed the Runner);
 * - the upgrade adds a pod that pulls docker.io/oneuptime/kubernetes-ai-agent,
 *   so --wait/--atomic, Terraform and Flux users with a mirror or an image
 *   allowlist mirror it (aiAgent.image.repository) or opt out
 *   (aiAgent.enabled=false);
 * - aiAccess settings carry over until the matching aiAgent value is set
 *   (which always wins), aiAccess.enabled=false is not an opt-out, and
 *   aiAccess.image / aiAccess.resources are not carried over;
 * - `helm rollback`, not `helm upgrade --version <older>`, is the downgrade,
 *   and it brings the in-cluster Runner back only within a week: after a
 *   week offline the server may delete the old Runner's row, and a Runner
 *   that registers after that is not bound to its cluster again;
 * - the server upgrade turns kubectl access off on every cluster whose
 *   Runner (in-cluster or not) someone had unbound or deleted;
 * - this agent is not the AI Agent retired in OneUptime 12.
 *
 * The values table on the Kubernetes agent page lists every aiAgent value
 * the chart accepts, with the defaults values.yaml sets; the Runner README's
 * kubectl environment matches what the Runner's executor now does; and
 * every docs link on the changed pages resolves to a page and heading that
 * exist.
 */

const THIRTEEN_TO_FOURTEEN_HEADING: string =
  "## Upgrading from OneUptime 13 → 14";
const UPGRADE_NOTE_HEADING: string =
  "### Kubernetes agent chart: the Kubernetes AI agent";
const KUBERNETES_AGENT_UPGRADE_HEADING: string =
  "### Upgrading to the Kubernetes AI agent";
const AI_AGENT_IMAGE_ON_DOCKER_HUB: string = `docker.io/${KUBERNETES_AI_AGENT_IMAGE_REPOSITORY}`;
const RUNNER_KUBECTL_EXECUTOR: string = path.join(
  PACKAGES_ROOT,
  "Runner/Services/KubectlExecutor.ts",
);
// Retires the previous in-cluster Runner once it is certainly unused.
const AI_AGENT_SERVICE: string = path.join(
  PACKAGES_ROOT,
  "Common/Server/Services/KubernetesAiAgentService.ts",
);
// Registers the in-cluster Runner and decides whether it is bound.
const AI_ACCESS_SERVICE: string = path.join(
  PACKAGES_ROOT,
  "Common/Server/Services/KubernetesClusterAiAccessService.ts",
);
const KUBERNETES_CLUSTER_MODEL: string = path.join(
  PACKAGES_ROOT,
  "Common/Models/DatabaseModels/KubernetesCluster.ts",
);
const SCHEMA_MIGRATIONS_DIR: string = path.join(
  PACKAGES_ROOT,
  "Common/Server/Infrastructure/Postgres/SchemaMigrations",
);
// The migration that added the agent and carried revocations over.
const AI_AGENT_MIGRATION_NAME: string = "AddKubernetesAiAgentAndAiDefaults";
/*
 * The revocation it carries over: every cluster with no Runner bound now
 * that had one bound once, or already ran (or failed to run) kubectl —
 * whichever Runner it was.
 */
const REVOCATION_WHERE: string =
  'WHERE "aiAccessRunnerId" IS NULL AND ("aiAccessRunnerBoundAt" IS NOT NULL OR "aiAccessLastVerifiedAt" IS NOT NULL OR "aiAccessLastError" IS NOT NULL)';
// The narrower wording the notes used before: only the in-cluster Runner.
const IN_CLUSTER_ONLY_REVOCATION: string =
  "whose in-cluster Runner someone had unbound or deleted";
// A sentence that promises a rolled-back chart brings the Runner back.
const RUNNER_COMES_BACK_PATTERN: RegExp =
  /brings (the in-cluster Runner|it) back/;
const WITHIN_A_WEEK_PATTERN: RegExp = /within a week of the upgrade/i;

/*
 * Every aiAgent value the chart documents. remediation.* and extraEnv are
 * left out of values.yaml on purpose (so a value stored under the old
 * aiAccess key keeps applying until one is set); the schema and the docs
 * still list them.
 */
const AI_AGENT_VALUES: Array<string> = [
  "enabled",
  "investigation",
  "fixes",
  "remediation.enabled",
  "remediation.namespaces",
  "remediation.nodeOperations",
  "image.repository",
  "image.tag",
  "image.pullPolicy",
  "imagePullSecrets",
  "resources",
  "extraEnv",
];

// A values.yaml line at the top level: the next block starts there.
const TOP_LEVEL_LINE_PATTERN: RegExp = /^\S/;
// The chart's template files: manifests, helpers and NOTES.txt.
const TEMPLATE_FILE_PATTERN: RegExp = /\.(yaml|tpl|txt)$/;

// A JSON schema node, as far as this suite walks it.
interface SchemaNode {
  type?: string | Array<string>;
  properties?: Record<string, SchemaNode>;
}

/*
 * "remediation.namespaces", "image.tag", ... for every leaf of a schema
 * object. `resources` is one value (a Kubernetes resources block), however
 * the schema spells out its insides.
 */
function getSchemaLeaves(node: SchemaNode, prefix: string): Array<string> {
  if (node.properties && prefix !== "resources") {
    return Object.entries(node.properties).flatMap(
      ([key, child]: [string, SchemaNode]): Array<string> => {
        return getSchemaLeaves(child, prefix ? `${prefix}.${key}` : key);
      },
    );
  }

  return [prefix];
}

/*
 * The lines of values.yaml's top-level `aiAgent:` block that set a value
 * (comments and blank lines left out).
 */
function getValuesBlock(key: string): Array<string> {
  const lines: Array<string> = read(CHART_VALUES).split("\n");
  const start: number = lines.indexOf(`${key}:`);

  if (start === -1) {
    return [];
  }

  const block: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    if (TOP_LEVEL_LINE_PATTERN.test(line) && !line.startsWith("#")) {
      break;
    }

    if (line.trim() !== "" && !line.trim().startsWith("#")) {
      block.push(line);
    }
  }

  return block;
}

// The value a `  key: value` line under a given parent sets, or undefined.
function getBlockValue(
  block: Array<string>,
  parents: Array<string>,
  key: string,
): string | undefined {
  let depth: number = 0;

  for (const line of block) {
    const indent: number = line.length - line.trimStart().length;
    const [name, ...rest] = line.trim().split(":");
    const value: string = rest.join(":").trim();

    if (depth < parents.length) {
      // Left the parent found so far without finding the next one.
      if (depth > 0 && indent <= 2 * depth) {
        return undefined;
      }

      if (indent === 2 * (depth + 1) && name === parents[depth]) {
        depth++;
      }
      continue;
    }

    if (indent === 2 * (parents.length + 1) && name === key) {
      return value.replace(/^"(.*)"$/, "$1");
    }

    if (indent <= 2 * parents.length) {
      return undefined;
    }
  }

  return undefined;
}

// The `| Value | Default | What it does |` row of the docs' values table.
function getTableRow(page: string, value: string): string | undefined {
  return read(page)
    .split("\n")
    .find((line: string): boolean => {
      return line.startsWith(`| \`aiAgent.${value}\` |`);
    });
}

// The Default cell of that row.
function getTableDefault(page: string, value: string): string | undefined {
  const row: string | undefined = getTableRow(page, value);

  return row ? row.split(" | ")[1] : undefined;
}

/*
 * Every docs link (`/docs/<page>#<anchor>`) and in-page link (`#<anchor>`)
 * a markdown file makes, with the ones that name no page or heading.
 */
function getUnresolvedLinks(filePath: string): Array<string> {
  const markdown: string = read(filePath);
  const unresolved: Array<string> = [];
  const headingSlugsOf: (text: string) => Set<string> = (
    text: string,
  ): Set<string> => {
    return new Set(
      getHeadings(text).map((heading: string): string => {
        return slugify(heading.replace(/^#+ /, ""));
      }),
    );
  };

  for (const match of markdown.matchAll(
    /\]\((\/docs\/[^)#\s]+)(#[^)\s]+)?\)/g,
  )) {
    const page: string = path.join(
      DOCS_CONTENT_DIR,
      `${match[1]!.replace(/^\/docs\//, "")}.md`,
    );

    if (!fs.existsSync(page)) {
      unresolved.push(match[0]);
      continue;
    }

    if (match[2] && !headingSlugsOf(read(page)).has(match[2].slice(1))) {
      unresolved.push(match[0]);
    }
  }

  for (const match of markdown.matchAll(/\]\(#([^)\s]+)\)/g)) {
    if (!headingSlugsOf(markdown).has(match[1]!)) {
      unresolved.push(match[0]);
    }
  }

  return unresolved;
}

// The sentences of a flattened copy that say the rollback brings the Runner back.
function getRunnerComesBackSentences(flat: string): Array<string> {
  return flat.split(/(?<=\.)\s+(?=[A-Z])/).filter((sentence: string) => {
    return RUNNER_COMES_BACK_PATTERN.test(sentence);
  });
}

// The body of a method of a service's source, up to its closing brace.
function getMethodBody(source: string, signature: string): string {
  const start: number = source.indexOf(signature);

  expect({ signature, found: start > -1 }).toEqual({ signature, found: true });

  return source.slice(start, source.indexOf("\n  }\n", start));
}

describe("the upgrade notes on the docs site", () => {
  const page: string = read(UPGRADING_PAGE);

  it("put the Kubernetes AI agent note in the newest version section, as a subsection", () => {
    const newest: string = getSection(page, THIRTEEN_TO_FOURTEEN_HEADING);

    expect(newest).toContain(`\n${UPGRADE_NOTE_HEADING}\n`);
    /*
     * EnterpriseEditionDocs.test.ts pins the page's `## ` sections: general
     * guidance, the edition split, then the version sections newest first.
     * A note of its own at that level would break that order.
     */
    expect(
      getHeadings(page).filter((heading: string): boolean => {
        return heading.includes("Kubernetes AI agent");
      }),
    ).toEqual([UPGRADE_NOTE_HEADING]);
  });

  describe("the note itself", () => {
    const note: string = getSection(page, UPGRADE_NOTE_HEADING);
    const flat: string = note.replace(/\s*\n\s*/g, " ");

    it("names the agent, its pod and its image, and what it replaces", () => {
      expect(flat).toContain(
        `**${KUBERNETES_AI_AGENT_DISPLAY_NAME}** by default`,
      );
      expect(flat).toContain("`component=ai-agent`");
      expect(flat).toContain(`\`${KUBERNETES_AI_AGENT_IMAGE_REPOSITORY}\``);
      expect(flat).toContain(
        "It replaces the in-cluster Runner that `aiAccess.enabled=true` installed.",
      );
    });

    it("says it is not the AI Agent retired in OneUptime 12, and links that note", () => {
      expect(flat).toContain(
        "It is not related to the AI Agent retired in OneUptime 12",
      );
      expect(flat).toContain("(#if-you-ran-the-standalone-ai-agent)");
    });

    it("says to upgrade the OneUptime server before the chart", () => {
      expect(flat).toContain(
        "**Upgrade the OneUptime server before the chart.**",
      );
      expect(flat).toContain(
        '"This OneUptime server does not have the Kubernetes AI agent API"',
      );
      expect(flat).toContain("`--version <your OneUptime version>`");
    });

    it("tells waiting upgrades to mirror the image or opt out", () => {
      for (const expected of [
        `\`${AI_AGENT_IMAGE_ON_DOCKER_HUB}\``,
        "`--wait`",
        "`--atomic`",
        "Terraform",
        "Flux",
        "`aiAgent.image.repository`",
        "`aiAgent.imagePullSecrets`",
        "`--set aiAgent.enabled=false`",
        "`--atomic` rolls back the whole release",
      ]) {
        expect({ expected, said: flat.includes(expected) }).toEqual({
          expected,
          said: true,
        });
      }
    });

    it("says how aiAccess settings carry over", () => {
      expect(flat).toContain(
        "keep applying until you set the matching `aiAgent.*` value, which always wins",
      );
      expect(flat).toContain(
        "`aiAccess.enabled=false` does not turn the AI agent off — `--set aiAgent.enabled=false` does",
      );
      expect(flat).toContain(
        "`aiAccess.image` and `aiAccess.resources` are not carried over",
      );
    });

    /*
     * The server upgrade's migration turns kubectl access off where an
     * operator had unbound or deleted a Runner (the in-cluster one or any
     * other), and drops unattended modes to Ask for approval where the
     * project never opted into AI command execution — that opt-in no longer
     * applies to the agent.
     */
    it("names the two changes the server upgrade makes to cluster settings", () => {
      expect(flat).toContain(
        "a cluster whose Runner someone had unbound or deleted (the in-cluster Runner or any other) starts with kubectl access off",
      );
      expect(flat).toContain(
        "**Automatic** or **Bypass approval** on a cluster whose project never turned on **Enable AI Command Execution** becomes **Ask for approval**",
      );
    });

    it("names helm rollback, not an older chart's upgrade, as the downgrade", () => {
      expect(flat).toContain("**To downgrade the chart, use `helm rollback`**");
      expect(flat).toContain("not `helm upgrade --version <older version>`");
    });

    it("says the Runner comes back only within a week, and how to bind it after that", () => {
      for (const expected of [
        "Within a week of the upgrade, the rollback brings the in-cluster Runner back, and it reconnects on its own once the AI agent has stopped.",
        "After that, OneUptime may have removed the old Runner, and the rolled-back one is not used until you bind it to the cluster again with the API or Terraform (the cluster's **AI Access Runner**; a Project Owner, a Project Admin or **Edit Auto Remediation Rule** may do it), or you upgrade the chart again.",
      ]) {
        expect({ expected, said: flat.includes(expected) }).toEqual({
          expected,
          said: true,
        });
      }
    });

    it("prints the shared install command", () => {
      expect(getBashBlocks(note)).toEqual([AI_AGENT_INSTALL_COMMAND]);
    });
  });

  it("only links to docs pages and headings that exist", () => {
    expect(getUnresolvedLinks(UPGRADING_PAGE)).toEqual([]);
  });
});

describe("the Kubernetes agent page's Upgrading section", () => {
  const upgrading: string = getSection(
    read(KUBERNETES_AGENT_PAGE),
    "## Upgrading the Agent",
  );
  const note: string = getSection(upgrading, KUBERNETES_AGENT_UPGRADE_HEADING);
  const flat: string = note.replace(/\s*\n\s*/g, " ");

  it("keeps the plain upgrade first", () => {
    expect(getBashBlocks(upgrading)[0]).toBe(
      "helm repo update\nhelm upgrade kubernetes-agent oneuptime/kubernetes-agent \\\n  --namespace oneuptime-agent \\\n  --reuse-values",
    );
  });

  it("says what to do before upgrading to the agent", () => {
    for (const expected of [
      "**Self-hosted OneUptime: upgrade the OneUptime server first.**",
      '"This OneUptime server does not have the Kubernetes AI agent API"',
      `\`${AI_AGENT_IMAGE_ON_DOCKER_HUB}\``,
      "`--wait` or `--atomic`, with Terraform or with Flux",
      "`aiAgent.image.repository`",
      "`aiAgent.imagePullSecrets`",
      "`--set aiAgent.enabled=false`",
    ]) {
      expect({ expected, said: flat.includes(expected) }).toEqual({
        expected,
        said: true,
      });
    }
  });

  it("names each aiAccess value that carries over, and how the aiAgent value overrides it", () => {
    for (const expected of [
      "`aiAccess.remediation.enabled`",
      "`aiAccess.remediation.namespaces`",
      "`aiAccess.remediation.nodeOperations`",
      "`aiAccess.extraEnv`",
      "Revoke write access with `--set aiAgent.fixes=off`",
      "go back to cluster-wide with `--set-json 'aiAgent.remediation.namespaces=[]'`",
      "clear a stored proxy setting with `--set-json 'aiAgent.extraEnv=[]'`",
      "`aiAccess.enabled=false` does not turn the AI agent off",
      "`aiAccess.image` and `aiAccess.resources` are not carried over",
    ]) {
      expect({ expected, said: flat.includes(expected) }).toEqual({
        expected,
        said: true,
      });
    }
  });

  it("names helm rollback as the downgrade and says the Runner comes back within a week", () => {
    expect(flat).toContain(
      "use `helm rollback kubernetes-agent <revision> --namespace oneuptime-agent`",
    );
    expect(flat).toContain("not `helm upgrade --version <older version>`");
    expect(flat).toContain(
      "Within a week of the upgrade, the rollback brings the in-cluster Runner back, and it reconnects on its own once the AI agent has stopped.",
    );
    expect(flat).toContain(
      "After that, OneUptime may have removed the old Runner (the cluster's **Feed** says when). The rolled-back Runner then connects but is not used until you bind it to the cluster again with the API or Terraform (the cluster's **AI Access Runner**; a Project Owner, a Project Admin or **Edit Auto Remediation Rule** may do it), or you upgrade the chart again.",
    );
  });

  it("names the two changes the server upgrade makes to cluster settings", () => {
    expect(flat).toContain(
      "a cluster whose Runner someone had unbound or deleted (the in-cluster Runner or any other) starts with **Investigate with kubectl** and fixes off",
    );
    expect(flat).toContain(
      "**Automatic** or **Bypass approval** on a cluster whose project never turned on **Enable AI Command Execution** becomes **Ask for approval**",
    );
  });

  it("says it is not the AI Agent retired in OneUptime 12", () => {
    expect(flat).toContain(
      "The Kubernetes AI agent is not related to the AI Agent retired in OneUptime 12.",
    );
  });
});

describe("the rollback the notes promise, against the server", () => {
  /*
   * A rollback of the chart brings the in-cluster Runner's pod back, and
   * while its row is still bound the cluster falls back to it on its own.
   * But the server deletes that row once the agent is a day old and the
   * Runner has been offline for LEGACY_RUNNER_RETIREMENT_OFFLINE_DAYS
   * (KubernetesAiAgentService.retireLegacyRunnerIfUnused); the foreign key
   * clears aiAccessRunnerId and leaves aiAccessRunnerBoundAt, and a Runner
   * that registers after that is left unbound. So every copy that promises
   * the Runner comes back says "within a week", and how to bind it again.
   */
  const copies: Array<string> = [
    KUBERNETES_AGENT_PAGE,
    UPGRADING_PAGE,
    RUNNER_README,
  ];

  it('retires the old Runner after a week offline, which is what "within a week" rests on', () => {
    const source: string = read(AI_AGENT_SERVICE);
    const days: RegExpMatchArray | null = source.match(
      /export const LEGACY_RUNNER_RETIREMENT_OFFLINE_DAYS: number = (\d+);/,
    );

    expect(days).not.toBeNull();
    expect(Number(days![1])).toBe(7);

    const retire: string = getMethodBody(
      source,
      "public async retireLegacyRunnerIfUnused(",
    );

    // It deletes the Runner row, and does not clear the "bound once" stamp.
    expect(retire).toContain("RunnerService.deleteOneBy(");
    expect(retire).not.toContain("aiAccessRunnerBoundAt");
  });

  it("leaves a Runner that registers after that unbound", () => {
    const source: string = read(AI_ACCESS_SERVICE);

    expect(source).toContain(
      "const hadRunnerBound: boolean = Boolean(cluster.aiAccessRunnerBoundAt);",
    );
    expect(source).toMatch(
      /\} else if \(hadRunnerBound \|\| hasCommandHistory\) \{\s*bindingState = "left_unbound_by_operator";/,
    );
  });

  for (const file of copies) {
    it(`qualifies every promise that the Runner comes back, in ${relative(file)}`, () => {
      const sentences: Array<string> = getRunnerComesBackSentences(
        readFlat(file),
      );

      // Harness guard: the copy still makes the promise.
      expect(sentences.length).toBeGreaterThan(0);

      for (const sentence of sentences) {
        expect({
          sentence,
          qualified: WITHIN_A_WEEK_PATTERN.test(sentence),
        }).toEqual({
          sentence,
          qualified: true,
        });
      }
    });

    it(`says how to bind the Runner again after that, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        apiOrTerraform: text.includes(
          "with the API or Terraform (the cluster's **AI Access Runner**",
        ),
        upgradeAgain:
          text.includes("or you upgrade the chart again") ||
          text.includes("or upgrade the chart again"),
      }).toEqual({
        file: relative(file),
        apiOrTerraform: true,
        upgradeAgain: true,
      });
    });
  }

  it("names the cluster's AI Access Runner as the model titles it", () => {
    expect(read(KUBERNETES_CLUSTER_MODEL)).toContain(
      'title: "AI Access Runner",',
    );
  });

  /*
   * Binding a Runner is a loosening (KubernetesClusterService.
   * getAiAccessLoosening), so it takes the same people as turning fixes on.
   */
  it("names who may bind it, from the permission catalog", () => {
    for (const file of [KUBERNETES_AGENT_PAGE, UPGRADING_PAGE]) {
      const text: string = readFlat(file);
      const start: number = text.search(/the rolled-back/i);
      const end: number = text.indexOf("or you upgrade the chart again", start);

      expect({
        file: relative(file),
        found: start > -1 && end > start,
      }).toEqual({ file: relative(file), found: true });

      const bind: string = text.slice(start, end);

      for (const permission of KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS) {
        const title: string = PermissionHelper.getTitle(permission);

        expect({
          file: relative(file),
          title,
          named: bind.includes(title),
        }).toEqual({
          file: relative(file),
          title,
          named: true,
        });
      }
    }
  });

  // Negative control: the unqualified promise is caught, a qualified one is not.
  it("reads an unqualified promise as one", () => {
    const sentences: Array<string> = getRunnerComesBackSentences(
      "Use helm rollback. The rollback brings the in-cluster Runner back, and it reconnects on its own. Within a week of the upgrade, a rollback brings it back.",
    );

    expect(sentences).toEqual([
      "The rollback brings the in-cluster Runner back, and it reconnects on its own.",
      "Within a week of the upgrade, a rollback brings it back.",
    ]);
    expect(
      sentences.map((sentence: string): boolean => {
        return WITHIN_A_WEEK_PATTERN.test(sentence);
      }),
    ).toEqual([false, true]);
  });
});

describe("the revocation the notes describe, against the server's migration", () => {
  it("covers every Runner, not only the in-cluster one", () => {
    const migrations: Array<string> = fs
      .readdirSync(SCHEMA_MIGRATIONS_DIR)
      .filter((name: string): boolean => {
        return name.includes(AI_AGENT_MIGRATION_NAME);
      });

    expect(migrations.length).toBe(1);

    const migration: string = read(
      path.join(SCHEMA_MIGRATIONS_DIR, migrations[0]!),
    );
    const revocation: string | undefined = migration
      .split("\n")
      .find((line: string): boolean => {
        return line.includes(`"aiRemediationMode" = 'Disabled'`);
      });

    expect(revocation).toBeDefined();
    expect(revocation).toContain(REVOCATION_WHERE);
    // Nothing narrows it to the chart's Runner (its name or posture).
    expect(revocation).not.toMatch(/Runner"|kubernetes-agent|name/);
  });

  for (const file of [KUBERNETES_AGENT_PAGE, UPGRADING_PAGE]) {
    it(`says so, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        anyRunner: text.includes(
          "a cluster whose Runner someone had unbound or deleted (the in-cluster Runner or any other)",
        ),
        inClusterOnly: text.includes(IN_CLUSTER_ONLY_REVOCATION),
      }).toEqual({
        file: relative(file),
        anyRunner: true,
        inClusterOnly: false,
      });
    });
  }
});

describe("the carry-over the notes describe, in the chart's templates", () => {
  const TEMPLATES_DIR: string = path.join(
    path.dirname(CHART_VALUES),
    "templates",
  );

  // Every template, and every variable one binds to `.Values.aiAccess`.
  function getTemplates(): Array<{ name: string; text: string }> {
    return fs
      .readdirSync(TEMPLATES_DIR)
      .filter((name: string): boolean => {
        return TEMPLATE_FILE_PATTERN.test(name);
      })
      .map((name: string): { name: string; text: string } => {
        return { name, text: read(path.join(TEMPLATES_DIR, name)) };
      });
  }

  function getLegacyReferences(text: string): Array<string> {
    const variables: Array<string> = Array.from(
      text.matchAll(/\$(\w+) := \.Values\.aiAccess\b/g),
    ).map((match: RegExpMatchArray): string => {
      return `$${match[1]!}`;
    });

    return [".Values.aiAccess", ...variables];
  }

  it("reads the stored aiAccess write access, namespaces, node operations and extra env", () => {
    const text: string = getTemplates()
      .map((template: { name: string; text: string }): string => {
        return template.text;
      })
      .join("\n");
    const references: Array<string> = getLegacyReferences(text);

    // Harness guard: the chart binds the legacy values somewhere.
    expect(references.length).toBeGreaterThan(1);

    for (const key of ["remediation", "extraEnv"]) {
      expect({
        key,
        read: references.some((reference: string): boolean => {
          return text.includes(`${reference}.${key}`);
        }),
      }).toEqual({ key, read: true });
    }
  });

  // Negative control: a template that binds aiAccess to a variable is read through it.
  it("follows a variable bound to .Values.aiAccess", () => {
    const text: string =
      "{{- $old := .Values.aiAccess | default dict -}}\nimage: {{ $old.image.tag }}";

    expect(getLegacyReferences(text)).toEqual([".Values.aiAccess", "$old"]);
    expect(text.includes(`${getLegacyReferences(text)[1]}.image`)).toBe(true);
  });

  it("never reads the stored aiAccess image or resources", () => {
    for (const template of getTemplates()) {
      for (const reference of getLegacyReferences(template.text)) {
        for (const key of ["image", "resources"]) {
          expect({
            template: template.name,
            reads: `${reference}.${key}`,
            found: template.text.includes(`${reference}.${key}`),
          }).toEqual({
            template: template.name,
            reads: `${reference}.${key}`,
            found: false,
          });
        }
      }
    }
  });
});

describe("the chart README's upgrade notes", () => {
  /*
   * The README is the chart's own copy of the same notes (§6 of the
   * design): the four things an operator must know before the upgrade.
   */
  const upgrading: string = getSection(
    read(CHART_README),
    "## Upgrading",
  ).replace(/\s*\n\s*/g, " ");

  it("say the upgrade pulls the agent's image and how to mirror it or opt out", () => {
    expect(upgrading).toContain(AI_AGENT_IMAGE_ON_DOCKER_HUB);
    expect(upgrading).toContain("aiAgent.image.repository");
    expect(upgrading).toContain("aiAgent.enabled=false");
  });

  it("say aiAccess settings carry over to aiAgent", () => {
    expect(upgrading).toMatch(/aiAccess/);
    expect(upgrading).toMatch(/aiAgent\.remediation/);
  });

  it("say to upgrade OneUptime first and to downgrade with helm rollback", () => {
    expect(upgrading).toMatch(/helm rollback/);
    expect(upgrading).toMatch(/(server|OneUptime)[^.]{0,80}(first|before)/i);
  });
});

describe("the aiAgent values the docs list", () => {
  it("lists every aiAgent value in the Kubernetes agent page's table", () => {
    for (const value of AI_AGENT_VALUES) {
      expect({
        value,
        listed: getTableRow(KUBERNETES_AGENT_PAGE, value) !== undefined,
      }).toEqual({ value, listed: true });
    }
  });

  it("lists every aiAgent value the chart's schema accepts", () => {
    const schema: { properties: Record<string, SchemaNode> } = JSON.parse(
      read(CHART_SCHEMA),
    );
    const aiAgent: SchemaNode | undefined = schema.properties["aiAgent"];

    expect(aiAgent).toBeDefined();

    const leaves: Array<string> = getSchemaLeaves(aiAgent!, "");

    // Harness guard: the schema was walked, not skipped.
    expect(leaves).toEqual(expect.arrayContaining(["enabled", "image.tag"]));

    for (const leaf of leaves) {
      expect({ leaf, documented: AI_AGENT_VALUES.includes(leaf) }).toEqual({
        leaf,
        documented: true,
      });
    }
  });

  it("keeps the deprecated aiAccess key in the schema, so stored releases still validate", () => {
    const schema: { properties: Record<string, SchemaNode> } = JSON.parse(
      read(CHART_SCHEMA),
    );

    expect(schema.properties["aiAccess"]).toBeDefined();
  });

  it("gives the defaults values.yaml sets", () => {
    const block: Array<string> = getValuesBlock("aiAgent");

    // Harness guard: values.yaml has an aiAgent block.
    expect(block.length).toBeGreaterThan(0);

    expect(getBlockValue(block, [], "enabled")).toBe("true");
    expect(getTableDefault(KUBERNETES_AGENT_PAGE, "enabled")).toBe("`true`");

    expect(getBlockValue(block, ["image"], "repository")).toBe(
      KUBERNETES_AI_AGENT_IMAGE_REPOSITORY,
    );
    expect(getTableDefault(KUBERNETES_AGENT_PAGE, "image.repository")).toBe(
      `\`${KUBERNETES_AI_AGENT_IMAGE_REPOSITORY}\``,
    );

    const requestsCpu: string | undefined = getBlockValue(
      block,
      ["resources", "requests"],
      "cpu",
    );
    const requestsMemory: string | undefined = getBlockValue(
      block,
      ["resources", "requests"],
      "memory",
    );
    const limitsCpu: string | undefined = getBlockValue(
      block,
      ["resources", "limits"],
      "cpu",
    );
    const limitsMemory: string | undefined = getBlockValue(
      block,
      ["resources", "limits"],
      "memory",
    );

    expect(getTableDefault(KUBERNETES_AGENT_PAGE, "resources")).toBe(
      `\`${requestsCpu}\` / \`${requestsMemory}\` requests, \`${limitsCpu}\` / \`${limitsMemory}\` limits`,
    );
  });

  /*
   * The carry-over rule needs remediation.* and extraEnv to be unset unless
   * an operator sets them: a default in values.yaml would always win over
   * the stored aiAccess value under --reset-then-reuse-values.
   */
  it("matches values.yaml leaving remediation and extraEnv unset, as the page says", () => {
    const block: Array<string> = getValuesBlock("aiAgent");

    expect(block.length).toBeGreaterThan(0);
    expect(getBlockValue(block, [], "remediation")).toBeUndefined();
    expect(getBlockValue(block, [], "extraEnv")).toBeUndefined();
    expect(readFlat(KUBERNETES_AGENT_PAGE)).toContain(
      "`aiAgent.remediation.*` and `aiAgent.extraEnv` are not set in `values.yaml`, so a value stored under the old `aiAccess` key keeps applying until you set them",
    );
  });

  /*
   * The values left unset get the default the chart falls back to when
   * neither they nor a stored aiAccess value is set, written the way the
   * chart README's table writes it, and the page says when that default
   * applies.
   */
  it("documents the values left unset with the chart README's defaults, and when those apply", () => {
    const readmeRows: Array<string> = read(CHART_README).split("\n");

    for (const value of [
      "remediation.enabled",
      "remediation.namespaces",
      "remediation.nodeOperations",
      "extraEnv",
    ]) {
      const readmeRow: string | undefined = readmeRows.find(
        (line: string): boolean => {
          return line.startsWith(`| \`${value}\` |`);
        },
      );

      expect({ value, inReadme: readmeRow !== undefined }).toEqual({
        value,
        inReadme: true,
      });

      expect({
        value,
        default: getTableDefault(KUBERNETES_AGENT_PAGE, value),
      }).toEqual({ value, default: readmeRow!.split(" | ")[1] });
    }

    expect(getTableDefault(KUBERNETES_AGENT_PAGE, "remediation.enabled")).toBe(
      "`false`",
    );
    expect(
      getTableDefault(KUBERNETES_AGENT_PAGE, "remediation.namespaces"),
    ).toBe("`[]`");
    expect(
      getTableDefault(KUBERNETES_AGENT_PAGE, "remediation.nodeOperations"),
    ).toBe("`true`");
    expect(getTableDefault(KUBERNETES_AGENT_PAGE, "extraEnv")).toBe("`[]`");
    expect(getTableDefault(KUBERNETES_AGENT_PAGE, "imagePullSecrets")).toBe(
      "`[]`",
    );
    expect(readFlat(KUBERNETES_AGENT_PAGE)).toContain(
      "The defaults the table gives for them apply only when neither the `aiAgent` key nor the `aiAccess` one is set.",
    );
  });

  it("says before the table, not after it, that those defaults are conditional", () => {
    const section: string = getSection(
      read(KUBERNETES_AGENT_PAGE),
      "### AI agent values",
    );

    expect(section.indexOf("are not set in `values.yaml`")).toBeGreaterThan(-1);
    expect(section.indexOf("are not set in `values.yaml`")).toBeLessThan(
      section.indexOf("| Value | Default | What it does |"),
    );
  });

  // Harness guards for the values.yaml reader.
  it("reads nested values and stops at the block's end", () => {
    const block: Array<string> = [
      "  enabled: true",
      "  image:",
      "    repository: example/agent",
      '    tag: ""',
      "  resources:",
      "    requests:",
      "      cpu: 50m",
      "    limits:",
      "      cpu: 500m",
    ];

    expect(getBlockValue(block, [], "enabled")).toBe("true");
    expect(getBlockValue(block, ["image"], "repository")).toBe("example/agent");
    expect(getBlockValue(block, ["image"], "tag")).toBe("");
    expect(getBlockValue(block, ["resources", "requests"], "cpu")).toBe("50m");
    expect(getBlockValue(block, ["resources", "limits"], "cpu")).toBe("500m");
    expect(getBlockValue(block, [], "remediation")).toBeUndefined();
    expect(getBlockValue(block, ["image"], "cpu")).toBeUndefined();
    // A `limits:` under another parent is not resources.limits.
    expect(
      getBlockValue(
        [
          "  resources:",
          "    requests:",
          "  other:",
          "    limits:",
          "      cpu: 1",
        ],
        ["resources", "limits"],
        "cpu",
      ),
    ).toBeUndefined();
  });

  it("reads a schema's leaves, keeping resources whole", () => {
    expect(
      getSchemaLeaves(
        {
          properties: {
            enabled: { type: "boolean" },
            image: {
              type: "object",
              properties: { tag: { type: "string" } },
            },
            resources: {
              type: "object",
              properties: { requests: { type: "object" } },
            },
          },
        },
        "",
      ),
    ).toEqual(["enabled", "image.tag", "resources"]);
  });
});

describe("the Runner README's kubectl environment", () => {
  /*
   * The Runner now hands every kubectl command a private kubeconfig (the
   * fix for Test access dialling localhost:8080), and the in-cluster
   * service variables no longer reach kubectl's environment.
   */
  it("describes what the Runner's executor does", () => {
    const executor: string = read(RUNNER_KUBECTL_EXECUTOR);
    const start: number = executor.indexOf("public static buildSpawnEnv(");
    const body: string = executor.slice(
      start,
      executor.indexOf("\n  }\n", start),
    );

    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("KUBECONFIG: data.kubeconfigPath");
    expect(body).not.toContain("KUBERNETES_SERVICE_HOST");

    const readme: string = readFlat(RUNNER_README);

    expect(readme).toContain(
      "Every command gets a private kubeconfig for its own life, passed as both `--kubeconfig` and `KUBECONFIG`",
    );
    expect(readme).toContain(
      "the path of the mounted token file (never the token itself",
    );
    expect(readme).not.toContain(
      "plus the in-cluster API server address (`KUBERNETES_SERVICE_*`)",
    );
  });

  it("sends a Runner's refused command to the cluster's AI Insights page", () => {
    expect(readFlat(RUNNER_README)).toContain(
      "some refusals appear only in the command's result on the cluster's AI Insights page",
    );
  });
});

describe("links on the changed pages", () => {
  for (const file of [
    AI_SRE_PAGE,
    KUBERNETES_AGENT_PAGE,
    UPGRADING_PAGE,
    RUNNER_README,
  ]) {
    it(`resolve to pages and headings that exist, in ${relative(file)}`, () => {
      expect(getUnresolvedLinks(file)).toEqual([]);
    });
  }

  // Negative control: a missing page and a missing heading are reported.
  it("reports a link to a missing page or heading", () => {
    const dir: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "ai-agent-docs-"),
    );
    const scratch: string = path.join(dir, "links.md");

    try {
      fs.writeFileSync(
        scratch,
        "# Here\n\n[a](/docs/ai/ai-sre#no-such-heading) [b](/docs/ai/no-such-page) [c](#here) [d](#nowhere) [e](/docs/ai/ai-sre#cluster-access-let-oneuptime-ai-run-kubectl)\n",
      );

      expect(getUnresolvedLinks(scratch)).toEqual([
        "](/docs/ai/ai-sre#no-such-heading)",
        "](/docs/ai/no-such-page)",
        "](#nowhere)",
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
