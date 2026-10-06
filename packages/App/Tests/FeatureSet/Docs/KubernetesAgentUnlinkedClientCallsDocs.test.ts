import {
  CHART_README,
  CHART_SCHEMA,
  CHART_VALUES,
  KUBERNETES_AGENT_PAGE,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import { describe, expect, test } from "@jest/globals";

/*
 * The kubernetes-agent chart's ebpf.dropUnlinkedClientCalls drops OBI's
 * client calls that belong to no trace (other than database, messaging and
 * GenAI calls). Unlike the database switches next to it, it is OFF by
 * default, because the collector cannot see what hangs under a span: a call
 * that OBI linked a same-node request under is the root of that trace, and
 * dropping it leaves the trace without its root. The chart's helm-unittest
 * suite (tests/traces-unlinked-client-spans_test.yaml) pins the render; this
 * keeps every copy an operator reads in step with it — the default, and the
 * cost they are told about before turning it on.
 */

const KEY: string = "dropUnlinkedClientCalls";

describe("kubernetes-agent docs: ebpf.dropUnlinkedClientCalls", () => {
  test("values.yaml ships it off", () => {
    expect(read(CHART_VALUES)).toMatch(new RegExp(`\\n  ${KEY}: false\\n`));
  });

  test("the schema takes a boolean and says it is off by default", () => {
    const schema: {
      properties: {
        ebpf: {
          properties: Record<string, { type: string; description: string }>;
        };
      };
    } = JSON.parse(read(CHART_SCHEMA));
    const entry: { type: string; description: string } | undefined =
      schema.properties.ebpf.properties[KEY];

    expect(entry?.type).toBe("boolean");
    expect(entry?.description).toContain("Off by default");
    expect(entry?.description).toContain("loses its root");
  });

  test("the README values table lists it with its default, false", () => {
    const rows: Array<string> = read(CHART_README)
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith(`| \`ebpf.${KEY}\` |`);
      });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("| `false` |");
    expect(rows[0]).toContain("never database, messaging or GenAI calls");
  });

  test("the README explains what it costs before anyone turns it on", () => {
    const section: string = getSection(
      read(CHART_README),
      "#### What eBPF traces look like",
    );

    expect(section).toContain(`\`ebpf.${KEY}=true\``);
    expect(section).toContain("It is off by default");
    expect(section).toContain("leaves that trace without its root");
    expect(section).toContain("service graph metrics");
  });

  test("the docs page says it is off by default and what it costs", () => {
    const page: string = read(KUBERNETES_AGENT_PAGE);

    expect(page).toContain(`\`ebpf.${KEY}=true\``);
    expect(page).toContain("It is off by default");
    expect(page).toContain("leaves the trace without its root");
    expect(page).toContain("database, messaging and GenAI calls are never");
  });
});
