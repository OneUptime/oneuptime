import {
  AI_AGENT_DIR,
  AI_SRE_PAGE,
  CHART_NOTES,
  CHART_README,
  CHART_SCHEMA,
  CHART_TEMPLATE,
  CHART_VALUES,
  EMPTY_LIST_RESET_FLAG,
  KUBERNETES_AGENT_PAGE,
  PACKAGES_ROOT,
  RUNNER_README,
  UPGRADING_PAGE,
  getClusterAccessSection,
  getSection,
  read,
  readFlat,
  relative,
} from "./KubernetesAiAgentDocsSupport";
import {
  KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  KUBERNETES_AI_AGENT_COMPONENT,
  KUBERNETES_AI_AGENT_IMAGE_REPOSITORY,
  TRANSIENT_KUBERNETES_AI_AGENT_REGISTRATION_REFUSALS,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import TelemetryIngestSurface, {
  IDENTITY_REGISTRATION_SURFACES,
} from "Common/Types/Telemetry/TelemetryIngestSurface";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs say about the kubernetes-agent chart's write scope and the
 * Kubernetes AI agent's identity, against what the chart, the agent and the
 * server do:
 *
 * - aiAgent.remediation.namespaces renders one RoleBinding per listed
 *   namespace and the chart never creates a namespace, so a missing one
 *   fails the whole install or upgrade (collector included). Every copy
 *   that offers the value says the namespaces must already exist, and how
 *   to go back to cluster-wide on a release that stores a list
 *   (`--set-json 'aiAgent.remediation.namespaces=[]'`; `={}` is one empty
 *   name and fails the schema, and leaving the flag out under --reuse-values
 *   keeps the list; KubernetesAiAccessDocsRoundFour.test.ts holds every copy
 *   to the `=null` rules).
 * - aiAgent.remediation.nodeOperations=false reaches the agent
 *   (ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS), which then refuses node
 *   operations; the docs say so rather than "RBAC only".
 * - Patch access to workloads is as good as running any image: the policy
 *   refuses some ways to do that, but not `set image`, which is a riskier
 *   change a human approves (or that Bypass approval runs). No copy may
 *   claim the refused commands are all of them.
 * - The agent registers with the chart's ingestion key, so a key with a
 *   Pinned Service Name cannot register it (the pinned-key refusal covers
 *   the agent's surface); a refused registration says whether it clears on
 *   its own; settings an operator picked before installing the chart are
 *   kept; Reset agent replaces the old "delete the Runner, then select the
 *   new one" remedy; and a server that predates the agent's API is named in
 *   the agent's own words.
 */

// Every copy that offers aiAgent.remediation.namespaces.
const NAMESPACES_COPY: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
  CHART_NOTES,
  CHART_VALUES,
  CHART_SCHEMA,
];

// Everything an operator reads about what the write access amounts to.
const WRITE_ACCESS_COPY: Array<string> = [
  AI_SRE_PAGE,
  KUBERNETES_AGENT_PAGE,
  CHART_README,
  CHART_NOTES,
  CHART_VALUES,
  CHART_SCHEMA,
  CHART_TEMPLATE,
];

// The docs pages that explain the agent's registration.
const REGISTRATION_COPY: Array<string> = [AI_SRE_PAGE, KUBERNETES_AGENT_PAGE];

const TELEMETRY_INGESTION_KEY_MODEL: string = path.join(
  PACKAGES_ROOT,
  "Common/Models/DatabaseModels/TelemetryIngestionKey.ts",
);
const RUNNER_MODEL: string = path.join(
  PACKAGES_ROOT,
  "Common/Models/DatabaseModels/Runner.ts",
);

const MUST_EXIST_PATTERN: RegExp = /must already exist/;
const EMPTY_LIST_RESET_PATTERN: RegExp =
  /--set-json 'aiAgent\.remediation\.namespaces=\[\]'/;
// A reset written the way Helm reads as one empty namespace name.
const EMPTY_BRACES_RESET_PATTERN: RegExp =
  /--set "?aiAgent\.remediation\.namespaces=\{\}/;
const WORKLOAD_PATCH_EQUIVALENCE_PATTERN: RegExp =
  /any image as any ServiceAccount/;
// `set image` named as a riskier, human-approved change.
const SET_IMAGE_IS_APPROVAL_GATED_PATTERN: RegExp =
  /set image\b[^.]{0,200}(riskier change|a human approves)/;
// The old NOTES claim that the refused commands are all of them.
const COMPLETE_REFUSAL_CLAIM_PATTERN: RegExp =
  /refuses the commands that would do that/;
const CLEARS_ON_ITS_OWN_PATTERN: RegExp = /clears on its own/;
const PINNED_SERVICE_NAME_PATTERN: RegExp = /Pinned Service Name/;
// Settings picked on the AI agent page before the install survive it.
const PRE_INSTALL_SETTINGS_PATTERN: RegExp =
  /before the (install|chart was installed)[^.]{0,80}kept|kept (exactly )?as (chosen|they are)/;
/*
 * The remedy the in-cluster Runner needed after its row was deleted:
 * select the fresh Runner on the cluster's AI page. The agent has no row to
 * delete or select; Reset agent replaces it.
 */
const SELECT_NEW_RUNNER_PATTERN: RegExp =
  /select the new( `kubernetes-agent\/<[a-zA-Z]+>`)? Runner on the cluster's AI page/;
// What the agent logs when the server has no agent API (Registration.ts).
const API_MISSING_LOG_LINE: string =
  "This OneUptime server does not have the Kubernetes AI agent API";
// The server that refuses a second agent for a cluster, and what it says.
const AI_AGENT_SERVICE: string = path.join(
  PACKAGES_ROOT,
  "Common/Server/Services/KubernetesAiAgentService.ts",
);
// The template of that refusal's message, up to the cluster's name.
const PREVIOUS_INSTANCE_MESSAGE_PATTERN: RegExp =
  /`(Another Kubernetes AI agent for cluster )"\$\{clusterIdentifier\}"( is online)\./;
const NOT_CONNECTING_HEADING: string = "### If the AI agent does not connect";
// The two troubleshooting bullets, by their bold lead.
const CLEARS_ON_ITS_OWN_BULLET: string =
  "- **A refusal that clears on its own**";
const NEEDS_YOU_BULLET: string = "- **A refusal that needs you**";
// A second install with the same clusterName, however it is worded.
const DUPLICATE_INSTALL_PATTERN: RegExp =
  /second install|two installs|installed twice|same `clusterName`/;

// The `title: "..."` of every column a model declares.
function getColumnTitles(modelPath: string): Array<string> {
  return Array.from(read(modelPath).matchAll(/title: "([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// Every TypeScript source of the agent, tests and build output left out.
function getAgentSources(directory: string): Array<string> {
  const sources: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "build", "Tests"].includes(entry.name)) {
      continue;
    }

    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      sources.push(...getAgentSources(entryPath));
    } else if (entry.name.endsWith(".ts")) {
      sources.push(entryPath);
    }
  }

  return sources;
}

describe("aiAgent.remediation.namespaces in the docs", () => {
  for (const file of NAMESPACES_COPY) {
    it(`says every listed namespace must already exist and how to reset the list, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        mustExist: MUST_EXIST_PATTERN.test(text),
        emptyListReset: EMPTY_LIST_RESET_PATTERN.test(text),
        emptyBracesReset: EMPTY_BRACES_RESET_PATTERN.test(text),
      }).toEqual({
        file: relative(file),
        mustExist: true,
        emptyListReset: true,
        emptyBracesReset: false,
      });
    });
  }

  it("names the error a missing namespace fails the upgrade with on every docs page", () => {
    for (const file of [AI_SRE_PAGE, KUBERNETES_AGENT_PAGE, CHART_README]) {
      expect({
        file: relative(file),
        named: read(file).includes('namespaces "'),
        notFound: read(file).includes('" not found`'),
      }).toEqual({ file: relative(file), named: true, notFound: true });
    }
  });

  it("says on the AI SRE page that leaving the namespaces flag out keeps a stored list", () => {
    const section: string = getClusterAccessSection();

    // True only the first time: --reuse-values keeps a stored list.
    expect(section).not.toContain(
      "Leave out the last line to grant it cluster-wide. ",
    );
    expect(section).toContain(
      "With `--reuse-values`, leaving the flag out keeps the list stored on the release",
    );
  });

  it("tells an operator whose upgrade failed on a missing namespace what to change, in both Upgrading sections", () => {
    for (const [file, heading] of [
      [CHART_README, "## Upgrading"],
      [KUBERNETES_AGENT_PAGE, "## Upgrading the Agent"],
    ] as Array<[string, string]>) {
      const section: string = getSection(read(file), heading);

      expect({
        file: relative(file),
        notFound: section.includes('namespaces "<name>" not found'),
        reset: EMPTY_LIST_RESET_PATTERN.test(section),
      }).toEqual({ file: relative(file), notFound: true, reset: true });
    }
  });

  // Negative control: the patterns read the reset forms as intended.
  it("tells the empty-list reset from the empty-braces one", () => {
    expect(EMPTY_LIST_RESET_PATTERN.test(EMPTY_LIST_RESET_FLAG)).toBe(true);
    expect(
      EMPTY_BRACES_RESET_PATTERN.test(
        '--set "aiAgent.remediation.namespaces={}"',
      ),
    ).toBe(true);
    expect(EMPTY_BRACES_RESET_PATTERN.test(EMPTY_LIST_RESET_FLAG)).toBe(false);
    // The old key's reset is not the new one.
    expect(
      EMPTY_LIST_RESET_PATTERN.test(
        "--set-json 'aiAccess.remediation.namespaces=[]'",
      ),
    ).toBe(false);
  });
});

describe("aiAgent.remediation.nodeOperations in the docs", () => {
  it("says the switch reaches the agent, not only RBAC", () => {
    for (const file of [
      AI_SRE_PAGE,
      KUBERNETES_AGENT_PAGE,
      CHART_README,
      CHART_VALUES,
      CHART_SCHEMA,
      CHART_TEMPLATE,
    ]) {
      expect({
        file: relative(file),
        env: read(file).includes(KUBECTL_ALLOW_NODE_OPERATIONS_ENV),
      }).toEqual({ file: relative(file), env: true });
    }
  });

  it("says in NOTES.txt that turning node operations off grants no node RBAC", () => {
    const notes: string = readFlat(CHART_NOTES);

    expect(notes).toContain("aiAgent.remediation.nodeOperations");
    expect(notes).toMatch(/no node RBAC/);
  });
});

describe("what the write access amounts to, in the docs", () => {
  for (const file of WRITE_ACCESS_COPY) {
    it(`names set image as a riskier change wherever patch access is called running any image, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        equivalence: WORKLOAD_PATCH_EQUIVALENCE_PATTERN.test(text),
        setImageGated: SET_IMAGE_IS_APPROVAL_GATED_PATTERN.test(text),
        completeRefusalClaim: COMPLETE_REFUSAL_CLAIM_PATTERN.test(text),
      }).toEqual({
        file: relative(file),
        equivalence: true,
        setImageGated: true,
        completeRefusalClaim: false,
      });
    });
  }
});

describe("the Kubernetes AI agent's identity and registration, in the docs", () => {
  it("uses the ingestion key's column title, and the pinned-key refusal really covers the agent", () => {
    expect(getColumnTitles(TELEMETRY_INGESTION_KEY_MODEL)).toContain(
      "Pinned Service Name",
    );
    /*
     * TelemetryIngest refuses a key with a pinned service name on every
     * identity-registration surface; the docs' claim holds only while the
     * agent's surface is one of them.
     */
    expect(
      IDENTITY_REGISTRATION_SURFACES.has(
        TelemetryIngestSurface.KubernetesAiAgent,
      ),
    ).toBe(true);
  });

  for (const file of REGISTRATION_COPY) {
    it(`says a pinned key cannot register the agent, a refusal says whether it clears on its own, and settings picked before the install are kept, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        pinnedServiceName: PINNED_SERVICE_NAME_PATTERN.test(text),
        clearsOnItsOwn: CLEARS_ON_ITS_OWN_PATTERN.test(text),
        preInstallSettingsKept: PRE_INSTALL_SETTINGS_PATTERN.test(text),
        resetAgent: text.includes("**Reset agent**"),
      }).toEqual({
        file: relative(file),
        pinnedServiceName: true,
        clearsOnItsOwn: true,
        preInstallSettingsKept: true,
        resetAgent: true,
      });
    });

    it(`says the agent is not a Runner and lives on the cluster's AI agent page, in ${relative(file)}`, () => {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        notARunner: text.includes(
          "never appears under Project Settings → Runners",
        ),
        agentPage: text.includes("**AI agent** page"),
      }).toEqual({ file: relative(file), notARunner: true, agentPage: true });
    });
  }

  /*
   * The two refusals that clear on their own: a previous agent pod that
   * still reports in (previous_instance_online) and the old in-cluster
   * Runner still online during an upgrade (legacy_runner_online). A new
   * transient reason needs a line in the docs too.
   */
  it("explains each refusal that clears on its own", () => {
    expect(
      [...TRANSIENT_KUBERNETES_AI_AGENT_REGISTRATION_REFUSALS].sort(),
    ).toEqual(["legacy_runner_online", "previous_instance_online"]);

    for (const file of REGISTRATION_COPY) {
      const text: string = readFlat(file);

      expect({
        file: relative(file),
        previousInstance: text.includes(
          "a previous agent pod that still reports in",
        ),
        legacyRunner: text.includes(
          "the old in-cluster Runner still shutting down during an upgrade",
        ),
      }).toEqual({
        file: relative(file),
        previousInstance: true,
        legacyRunner: true,
      });
    }
  });

  /*
   * previous_instance_online is transient for a pod replaced without a
   * clean shutdown, but a second install with the same clusterName is
   * refused for as long as the first one heartbeats: it never clears
   * without someone acting, so the docs list it with the refusals that
   * need you, in the words the agent's log shows.
   */
  describe("a second install with the same clusterName", () => {
    const section: string = getSection(
      read(KUBERNETES_AGENT_PAGE),
      NOT_CONNECTING_HEADING,
    );

    function getBullet(lead: string): string {
      const line: string | undefined = section
        .split("\n")
        .find((candidate: string): boolean => {
          return candidate.startsWith(lead);
        });

      expect({ lead, found: line !== undefined }).toEqual({
        lead,
        found: true,
      });

      return line!;
    }

    it("is not listed as a refusal that clears on its own", () => {
      expect(
        DUPLICATE_INSTALL_PATTERN.test(getBullet(CLEARS_ON_ITS_OWN_BULLET)),
      ).toBe(false);
    });

    it("is listed as a refusal that needs you, with what to change", () => {
      const needsYou: string = getBullet(NEEDS_YOU_BULLET);

      for (const expected of [
        "two installs share one `clusterName`",
        "the one already connected keeps it for as long as it runs",
        "give each cluster its own `clusterName` or remove the extra release",
      ]) {
        expect({ expected, said: needsYou.includes(expected) }).toEqual({
          expected,
          said: true,
        });
      }
    });

    it("quotes the server's refusal message as the agent logs it", () => {
      const match: RegExpMatchArray | null = read(AI_AGENT_SERVICE).match(
        PREVIOUS_INSTANCE_MESSAGE_PATTERN,
      );

      expect(match).not.toBeNull();
      expect(getBullet(NEEDS_YOU_BULLET)).toContain(
        `\`${match![1]!}"<name>"${match![2]!}\``,
      );
    });

    // Negative control: the old wording is caught.
    it("catches the duplicate install in the old wording", () => {
      expect(
        DUPLICATE_INSTALL_PATTERN.test(
          "- **A refusal that clears on its own** — a previous agent pod that still reports in (a pod replaced without a clean shutdown, or a second install with the same `clusterName`).",
        ),
      ).toBe(true);
    });
  });

  it("names the agent's pod label and image as Common does", () => {
    for (const file of [AI_SRE_PAGE, KUBERNETES_AGENT_PAGE, UPGRADING_PAGE]) {
      const text: string = read(file);

      expect({
        file: relative(file),
        label: text.includes(`component=${KUBERNETES_AI_AGENT_COMPONENT}`),
        image: text.includes(KUBERNETES_AI_AGENT_IMAGE_REPOSITORY),
      }).toEqual({ file: relative(file), label: true, image: true });
    }
  });

  it("points the log command at the agent's pod, not the old Runner's", () => {
    for (const file of [AI_SRE_PAGE, KUBERNETES_AGENT_PAGE, CHART_NOTES]) {
      const text: string = read(file);

      expect({
        file: relative(file),
        agentLogs: text.includes(
          `-l component=${KUBERNETES_AI_AGENT_COMPONENT}`,
        ),
        runnerLogs: text.includes("-l component=ai-runner"),
      }).toEqual({ file: relative(file), agentLogs: true, runnerLogs: false });
    }
  });

  it("no longer tells anyone to select a new Runner on the cluster's AI page", () => {
    for (const file of [
      AI_SRE_PAGE,
      KUBERNETES_AGENT_PAGE,
      UPGRADING_PAGE,
      RUNNER_README,
      CHART_README,
      CHART_NOTES,
      CHART_VALUES,
    ]) {
      expect({
        file: relative(file),
        selectNewRunner: SELECT_NEW_RUNNER_PATTERN.test(readFlat(file)),
      }).toEqual({ file: relative(file), selectNewRunner: false });
    }
  });

  // Negative control: the old remedy is flagged.
  it("reads the old re-select step as one", () => {
    expect(
      SELECT_NEW_RUNNER_PATTERN.test(
        "select the new `kubernetes-agent/<cluster>` Runner on the cluster's AI page afterwards",
      ),
    ).toBe(true);
  });

  /*
   * The docs quote what the agent logs against a server without its API
   * (an older OneUptime, or a proxy page). Quoted wrong, an operator
   * searching the log for it finds nothing.
   */
  it("quotes the agent's own log line for a server without the agent API", () => {
    const sources: Array<string> = getAgentSources(AI_AGENT_DIR);

    expect(sources.length).toBeGreaterThan(0);
    expect(
      sources.some((source: string): boolean => {
        return read(source).includes(API_MISSING_LOG_LINE);
      }),
    ).toBe(true);

    for (const file of [KUBERNETES_AGENT_PAGE, UPGRADING_PAGE]) {
      expect({
        file: relative(file),
        quoted: readFlat(file).includes(`"${API_MISSING_LOG_LINE}"`),
      }).toEqual({ file: relative(file), quoted: true });
    }
  });

  it("says how often the agent retries against such a server, as the agent does", () => {
    const retry: RegExpMatchArray | undefined = getAgentSources(AI_AGENT_DIR)
      .map((source: string): RegExpMatchArray | null => {
        return read(source).match(
          /API_MISSING_RETRY_MS\b[^=\n]*=\s*(\d+)\s*\*\s*60_?000\b/,
        );
      })
      .find((match: RegExpMatchArray | null): boolean => {
        return match !== null;
      }) as RegExpMatchArray | undefined;

    expect(retry).toBeDefined();

    const minutes: string = retry![1]!;

    for (const file of [KUBERNETES_AGENT_PAGE, UPGRADING_PAGE]) {
      expect({
        file: relative(file),
        interval: readFlat(file).includes(`retries every ${minutes} minutes`),
      }).toEqual({ file: relative(file), interval: true });
    }
  });
});

describe("the legacy in-cluster Runner, in the Runner README", () => {
  const readme: string = read(RUNNER_README);

  it("uses the capability titles the Runner model shows", () => {
    const titles: Array<string> = getColumnTitles(RUNNER_MODEL);

    expect(titles).toContain("Runs Runbooks");
    expect(titles).toContain("Runs AI Code Fixes");
  });

  it("says the kubernetes-agent mode is deprecated and superseded by the Kubernetes AI agent", () => {
    const section: string = getSection(
      readme,
      "## The Kubernetes agent mode is deprecated",
    );

    expect(section).toContain("That mode is **deprecated**.");
    expect(section).toContain(
      `the **Kubernetes AI agent** (\`${KUBERNETES_AI_AGENT_IMAGE_REPOSITORY}\`)`,
    );
    expect(section).toContain("is not a Runner");
    expect(section).toContain("carries its settings over");
  });

  it("keeps what is still true for a legacy install", () => {
    const section: string = readFlat(RUNNER_README);

    for (const expected of [
      "cannot be renamed",
      "**Runs Runbooks**",
      "**Runs AI Code Fixes**",
      "never accepted as an auto-remediation rule's command Runner",
    ]) {
      expect({ expected, said: section.includes(expected) }).toEqual({
        expected,
        said: true,
      });
    }
  });

  /*
   * superseded_by_ai_agent is refused only while the agent is online and
   * is transient, so a rolled-back chart's Runner registers again — but
   * after a week offline the server may have deleted its row, and a Runner
   * registered after that is not bound to its cluster again
   * (KubernetesAiAccessDocsUpgrade.test.ts checks both against the server).
   */
  it("says the server refuses the legacy Runner only while the agent is online", () => {
    expect(readFlat(RUNNER_README)).toContain(
      "While the cluster's Kubernetes AI agent is online, the server refuses the legacy Runner's registration; the Runner keeps retrying, so a `helm rollback` of the chart within a week of the upgrade brings it back once the AI agent has stopped.",
    );
  });

  it("says a Runner rolled back after its row was removed must be bound again", () => {
    for (const expected of [
      "After a week offline, OneUptime removes the old Runner's row if nothing else uses it (no credentials or secrets, runbooks, code fixes or remediation rules).",
      "A Runner rolled back after that registers again but is not bound to its cluster: bind it with the API or Terraform (the cluster's **AI Access Runner**), or upgrade the chart again.",
    ]) {
      expect({
        expected,
        said: readFlat(RUNNER_README).includes(expected),
      }).toEqual({
        expected,
        said: true,
      });
    }
  });
});
