import { describe, expect, test } from "@jest/globals";
import {
  CLUSTER_TOOL_NAMES,
  ClusterToolOutcome,
  describeClusterEvidenceTool,
  describeClusterToolOutcome,
  formatEvidenceOutcome,
  getClusterEvidenceNote,
  isClusterToolName,
  isKubectlResultUnknownMessage,
  KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ClusterToolFormat";
import {
  CLUSTER_TOOL_NAMES as FEED_CLUSTER_TOOL_NAMES,
  isClusterToolName as feedIsClusterToolName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import {
  describeEvidenceTool,
  EvidenceToolDescription,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import IconProp from "../../../Types/Icon/IconProp";
import {
  KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX as SHARED_KUBECTL_RESULT_UNKNOWN_PREFIX,
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";

// The shared formatter's fallback for a tool it does not know: "Ran <words>".
const RAN_FALLBACK_PATTERN: RegExp =
  /^Ran run kubectl$|^Ran list cluster access$/;

/*
 * The one place the dashboard words a cluster tool call — the activity
 * feed, the Evidence tab and the usage line all read it, so they cannot
 * drift apart (IP-6).
 */

describe("describeClusterToolOutcome", () => {
  test.each<[string, number | undefined, ClusterToolOutcome]>([
    [
      RUN_KUBECTL_TOOL_NAME,
      1,
      { label: "Succeeded", detail: "succeeded", isError: false },
    ],
    [
      RUN_KUBECTL_TOOL_NAME,
      0,
      {
        label: "kubectl returned an error",
        detail: "kubectl returned an error",
        isError: true,
      },
    ],
    [
      RUN_KUBECTL_TOOL_NAME,
      undefined,
      {
        label: "kubectl returned an error",
        detail: "kubectl returned an error",
        isError: true,
      },
    ],
    [
      LIST_CLUSTER_ACCESS_TOOL_NAME,
      2,
      { label: "2 clusters", detail: "2 clusters", isError: false },
    ],
    [
      LIST_CLUSTER_ACCESS_TOOL_NAME,
      1,
      { label: "1 cluster", detail: "1 cluster", isError: false },
    ],
    [
      LIST_CLUSTER_ACCESS_TOOL_NAME,
      0,
      { label: "No clusters", detail: "no clusters", isError: false },
    ],
  ])(
    "%s with rowCount %p",
    (
      toolName: string,
      rowCount: number | undefined,
      expected: ClusterToolOutcome,
    ) => {
      expect(describeClusterToolOutcome(toolName, rowCount)).toEqual(expected);
    },
  );

  // Negative control: every other tool's rowCount is rows.
  test("leaves other tools alone", () => {
    expect(describeClusterToolOutcome("query_metrics", 5)).toBeNull();
    expect(describeClusterToolOutcome(undefined, 5)).toBeNull();
  });
});

describe("formatEvidenceOutcome", () => {
  test("words cluster calls by what they did", () => {
    expect(formatEvidenceOutcome(RUN_KUBECTL_TOOL_NAME, 1)).toBe("Succeeded");
    expect(formatEvidenceOutcome(RUN_KUBECTL_TOOL_NAME, 0)).toBe(
      "kubectl returned an error",
    );
    expect(formatEvidenceOutcome(LIST_CLUSTER_ACCESS_TOOL_NAME, 2)).toBe(
      "2 clusters",
    );
  });

  // Negative control: telemetry queries keep their rows.
  test("keeps rows for telemetry queries", () => {
    expect(formatEvidenceOutcome("query_metrics", 1)).toBe("1 row");
    expect(formatEvidenceOutcome("query_metrics", 0)).toBe("No rows");
    expect(formatEvidenceOutcome("search_logs", 1234)).toBe("1,234 rows");
  });
});

describe("describeClusterEvidenceTool", () => {
  test("describes the two cluster tools in their own words", () => {
    expect(
      describeClusterEvidenceTool(RUN_KUBECTL_TOOL_NAME)?.description,
    ).toBe("Ran a read-only kubectl command");
    expect(
      describeClusterEvidenceTool(LIST_CLUSTER_ACCESS_TOOL_NAME)?.description,
    ).toBe("Listed the clusters OneUptime AI can inspect");
  });

  /*
   * The shared evidence formatter knows the cluster tools itself (it used
   * to fall back to "Ran run kubectl" under "Other"), so a surface that
   * only calls describeEvidenceTool — the citation chip — words them the
   * same way the Evidence tab does.
   */
  test.each<[string, string, IconProp]>([
    [
      RUN_KUBECTL_TOOL_NAME,
      "Ran a read-only kubectl command",
      IconProp.Terminal,
    ],
    [
      LIST_CLUSTER_ACCESS_TOOL_NAME,
      "Listed the clusters OneUptime AI can inspect",
      IconProp.Cube,
    ],
  ])(
    "the shared formatter describes %s under Kubernetes",
    (toolName: string, description: string, icon: IconProp) => {
      const expected: EvidenceToolDescription = {
        description,
        icon,
        category: "Kubernetes",
      };

      expect(describeEvidenceTool(toolName)).toEqual(expected);
      expect(describeClusterEvidenceTool(toolName)).toEqual(expected);
      // Case and surrounding space do not change the answer.
      expect(describeEvidenceTool(` ${toolName.toUpperCase()} `)).toEqual(
        expected,
      );
      expect(describeEvidenceTool(toolName).description).not.toMatch(
        RAN_FALLBACK_PATTERN,
      );
    },
  );

  test("returns a copy, so a caller cannot change the shared table", () => {
    const first: EvidenceToolDescription | null = describeClusterEvidenceTool(
      RUN_KUBECTL_TOOL_NAME,
    );
    first!.description = "changed";

    expect(
      describeClusterEvidenceTool(RUN_KUBECTL_TOOL_NAME)?.description,
    ).toBe("Ran a read-only kubectl command");
    expect(describeEvidenceTool(RUN_KUBECTL_TOOL_NAME).description).toBe(
      "Ran a read-only kubectl command",
    );
  });

  // Negative control: an unknown tool still falls back to its own words.
  test("still humanises a tool the table does not know", () => {
    expect(describeEvidenceTool("query_kubernetes_pods")).toEqual({
      description: "Ran query kubernetes pods",
      icon: IconProp.Database,
      category: "Other",
    });
    expect(describeClusterEvidenceTool("query_kubernetes_pods")).toBeNull();
  });

  test("leaves other tools to the shared formatter", () => {
    expect(describeClusterEvidenceTool("query_metrics")).toBeNull();
    expect(getClusterEvidenceNote("query_metrics")).toBeNull();
  });

  test("never promises rows for a cluster call", () => {
    for (const toolName of CLUSTER_TOOL_NAMES) {
      const note: string | null = getClusterEvidenceNote(toolName);
      expect(note).toBeTruthy();
      expect(note).not.toContain("its rows");
    }
  });
});

describe("the cluster tool names", () => {
  test("are the feed's too", () => {
    expect(FEED_CLUSTER_TOOL_NAMES).toBe(CLUSTER_TOOL_NAMES);
    expect(feedIsClusterToolName(RUN_KUBECTL_TOOL_NAME)).toBe(true);
    expect(isClusterToolName(LIST_CLUSTER_ACCESS_TOOL_NAME)).toBe(true);
    expect(isClusterToolName("query_metrics")).toBe(false);
    expect(isClusterToolName(null)).toBe(false);
  });
});

describe("isKubectlResultUnknownMessage", () => {
  test("recognises the server's result-unknown event", () => {
    expect(
      isKubectlResultUnknownMessage(
        `${SHARED_KUBECTL_RESULT_UNKNOWN_PREFIX} the Runner of cluster "prod-us" took the command, but no result came back, so whether it ran is unknown.`,
      ),
    ).toBe(true);
  });

  // The panel re-exports the one shared definition for its readers.
  test("reads the marker defined next to the shared tool names", () => {
    expect(KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX).toBe(
      SHARED_KUBECTL_RESULT_UNKNOWN_PREFIX,
    );
    expect(
      isKubectlResultUnknownMessage(
        `  ${SHARED_KUBECTL_RESULT_UNKNOWN_PREFIX} leading space is not the event`,
      ),
    ).toBe(false);
  });

  test("never reads a never-ran event as unknown", () => {
    expect(
      isKubectlResultUnknownMessage(
        'kubectl was not run on cluster "prod-us": its Runner did not pick up the command in time.',
      ),
    ).toBe(false);
    expect(isKubectlResultUnknownMessage("")).toBe(false);
    expect(isKubectlResultUnknownMessage(null)).toBe(false);
  });
});
