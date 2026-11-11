import { describe, expect, test } from "@jest/globals";
import {
  getDefaultContext,
  getHardcodedStrings,
} from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import { HardcodedString } from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";

/*
 * The two-factor settings (authenticator apps, passkeys, security keys and
 * backup codes), the network topology, the status page's resources, the SLO
 * overview and the Slack, Microsoft Teams and Mattermost pages route every
 * sentence they show through translation (#6658). A German or Arabic reader
 * used to meet "Showing 12 of 40 devices", "Rolling 30 days", "Incident
 * Summary - Slack" and "Passkey added. Use it the next time you sign in."
 * in English, glued together from pieces no other language can read.
 *
 * The second part routes Security Events (connection diagnostics, the
 * connection test, the setup guide, the event panels, the attribute column
 * picker and the Correlate builder) and the Security Case entities card: a
 * reader no longer meets "Find historical detections", "Enabled, every 5
 * minutes" or "Showing 50 of 120 matching attributes" in English.
 *
 * The third part routes the rest of the directories from S to W: Session
 * Replay's events rail and its detail, the telemetry setup guides and the
 * investigation drawer, trace pipelines and trace recording rules, the web
 * vitals cards, user flows, Slack's channel cache, teams, users, the
 * timezone prompt and workflow variables. A reader no longer meets "No
 * requests match this filter", "Next refresh in 5 seconds", "3 pages after
 * /checkout" or "Profiles are flowing! 2 sources reporting." in English.
 *
 * `npm run i18n:hardcoded` lists what is still written as it is; this keeps
 * every directory from S to W at nothing but the reviewed strings below, and
 * the whole list from growing: each file of it may only shrink.
 *
 * Counted per file rather than quoted, so reformatting a file never fails
 * this; a new hard-coded string anywhere does.
 */

const DASHBOARD_SOURCE: string = "packages/App/FeatureSet/Dashboard/src/";

// The directories the three parts of #6658 routed: S to W.
const ROUTED: RegExp = /^Components\/[S-W]/;

const ALLOWED_IN_ROUTED: Record<string, { count: number; why: string }> = {
  "Components/Topology/Export/NetworkTopologyExportDocument.ts": {
    count: 1,
    why: "the exported PDF's document title (`Network topology - ${title}`): the PDF itself is written in English, so its title in the file's metadata is too",
  },
  "Components/SessionReplay/Rail/ReplayRailDetail.tsx": {
    count: 1,
    why: 'the "x" between a viewport\'s width and height (1440x900): a size, written the same in every language',
  },
};

/*
 * Everything `npm run i18n:hardcoded` still lists, file by file, and why it
 * reads the same in every language or is not drawn as a sentence of the
 * page. Each count may only go down.
 */
const ALLOWED_ANYWHERE: Record<string, { count: number; why: string }> = {
  ...ALLOWED_IN_ROUTED,
  "Components/AIChat/Widgets/TraceWaterfallWidget.tsx": {
    count: 2,
    why: '"{n} ms" span durations (unit)',
  },
  "Components/Cloud/Connect/CloudStreamDialog.tsx": {
    count: 1,
    why: "an AWS Region code placeholder (us-east-1, eu-west-1)",
  },
  "Components/Cloud/Connect/CloudStreamGcpDialog.tsx": {
    count: 1,
    why: "a Cloud Logging query placeholder, in Google's query language",
  },
  "Components/Code/CodeContextModal.tsx": {
    count: 2,
    why: "placeholders that are code: a repository path and a trace id",
  },
  "Components/Mcp/McpConnectSetup.ts": {
    count: 7,
    why: "MCP client commands and JSON configs a reader copies as they are",
  },
  "Components/MicrosoftTeams/MicrosoftTeamsIntegration.tsx": {
    count: 1,
    why: "the Teams install guide's markdown body, read from source by its own tests",
  },
  "Components/ProjectBalance/AutoRechargeCard.tsx": {
    count: 1,
    why: '"{n} USD" (currency)',
  },
  "Components/Runbook/Steps/RunbookVariableChips.tsx": {
    count: 1,
    why: "`local.{name}`: a variable reference typed into a runbook step",
  },
  "Pages/Code/Task/Log.tsx": { count: 2, why: '"{n} ms" durations (unit)' },
  "Pages/Database/Utils/DocumentationMarkdown.ts": {
    count: 8,
    why: "setup-guide markdown bodies built around SQL/JS/HTTP code blocks",
  },
  "Pages/Host/View/ProcessView.tsx": {
    count: 1,
    why: '"pid {n}" (process id label)',
  },
  "Pages/IoT/View/Devices.tsx": { count: 1, why: '"{n} °C" (unit)' },
  "Pages/MessageQueue/Utils/DocumentationMarkdown.ts": {
    count: 2,
    why: "a line of setup-guide markdown and an attribute name/value",
  },
  "Pages/OnCallDuty/IncomingCallPolicy/LogView.tsx": {
    count: 2,
    why: '"{m}m {s}s" call duration (units)',
  },
  "Pages/OnCallDuty/IncomingCallPolicy/Logs.tsx": {
    count: 2,
    why: '"{m}m {s}s" call duration (units)',
  },
  "Pages/Settings/Domains.tsx": { count: 1, why: '"TXT" (DNS record type)' },
  "Pages/Settings/LlmProviders.tsx": { count: 1, why: '"USD" (currency)' },
  "Pages/Settings/UsageHistory.tsx": {
    count: 2,
    why: '"{n} GB" and "{n} USD" (units, currency)',
  },
  "packages/Common/UI/Components/Detail/Detail.tsx": {
    count: 1,
    why: '"USD" (currency)',
  },
  "packages/Common/UI/Components/Forms/Fields/ColorPicker.tsx": {
    count: 1,
    why: "the English fallback after a lookup that found no words",
  },
  "packages/Common/UI/Components/Markdown.tsx/LazyMarkdownEditor.tsx": {
    count: 1,
    why: "the English fallback after a lookup that found no words",
  },
  "packages/Common/UI/Components/Table/EmptyTableMessage.ts": {
    count: 3,
    why: "the English sentences a table falls back to when a caller gives no translator",
  },
  "packages/Common/UI/Components/Table/TableRow.tsx": {
    count: 1,
    why: "the English fallback after a lookup that found no words",
  },
  "packages/Common/UI/Components/TableColumnList/TableColumnListComponent.tsx":
    {
      count: 1,
      why: "the English fallback after a lookup that found no words",
    },
  "packages/Common/UI/Components/Workflow/ColumnEditor/ColumnValueInput.tsx": {
    count: 1,
    why: '"abc", the glyph of a text value',
  },
  "packages/Common/UI/Components/Workflow/ValuePicker/ValueSingleField.tsx": {
    count: 1,
    why: '"abc", the glyph of a text value',
  },
  "packages/Common/Types/CloudConnection/CloudAiAgentCost.ts": {
    count: 4,
    why: "a cloud bill's line items, quoted as the cloud's own price sheet names them",
  },
};

type RelativeFileFunction = (entry: HardcodedString) => string;

const relativeFile: RelativeFileFunction = (entry: HardcodedString): string => {
  return entry.file.startsWith(DASHBOARD_SOURCE)
    ? entry.file.slice(DASHBOARD_SOURCE.length)
    : entry.file;
};

let hardcoded: Array<HardcodedString> | null = null;

const getAllHardcoded: () => Array<HardcodedString> =
  (): Array<HardcodedString> => {
    if (!hardcoded) {
      hardcoded = getHardcodedStrings(getDefaultContext(), {});
    }

    return hardcoded;
  };

type CountByFileFunction = (filter: (file: string) => boolean) => {
  counts: Record<string, number>;
  found: Array<string>;
};

const countByFile: CountByFileFunction = (
  filter: (file: string) => boolean,
): { counts: Record<string, number>; found: Array<string> } => {
  const counts: Record<string, number> = {};
  const found: Array<string> = [];

  for (const entry of getAllHardcoded()) {
    const file: string = relativeFile(entry);

    if (!filter(file)) {
      continue;
    }

    counts[file] = (counts[file] || 0) + 1;
    found.push(`${file}:${entry.line} ${entry.reason} ${entry.text}`);
  }

  return { counts, found };
};

describe("the Dashboard's components from S to W route their strings through translation", () => {
  test("only the reviewed PDF title and viewport size are left in S to W", () => {
    const { counts, found } = countByFile((file: string): boolean => {
      return ROUTED.test(file);
    });

    const unexpected: Array<string> = Object.keys(counts)
      .filter((file: string): boolean => {
        return counts[file]! > (ALLOWED_IN_ROUTED[file]?.count || 0);
      })
      .map((file: string): string => {
        return `${file}: ${counts[file]} (allowed ${ALLOWED_IN_ROUTED[file]?.count || 0}) - ${found
          .filter((line: string): boolean => {
            return line.startsWith(`${file}:`);
          })
          .join(" | ")}`;
      });

    expect(unexpected).toEqual([]);

    // Every exception is explained, and still needed.
    for (const file of Object.keys(ALLOWED_IN_ROUTED)) {
      expect(ROUTED.test(file)).toBe(true);
      expect(ALLOWED_IN_ROUTED[file]!.why.length).toBeGreaterThan(0);
      expect(counts[file] || 0).toBe(ALLOWED_IN_ROUTED[file]!.count);
    }
  }, 300000);

  test("the PDF title is the only string the topology export keeps in English", () => {
    const { found } = countByFile((file: string): boolean => {
      return file.startsWith("Components/Topology/");
    });

    expect(
      found.map((line: string): string => {
        return line.slice(line.indexOf(" composed ") + " composed ".length);
      }),
    ).toEqual(["`Network topology - ${title}`"]);
  }, 300000);

  test("the viewport size is the only string the events rail keeps as written", () => {
    const { found } = countByFile((file: string): boolean => {
      return file.startsWith("Components/SessionReplay/");
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(
      /^Components\/SessionReplay\/Rail\/ReplayRailDetail\.tsx:\d+ composed x$/,
    );
  }, 300000);

  test("nothing the scan lists grows: every file keeps at most its reviewed strings", () => {
    const { counts, found } = countByFile((): boolean => {
      return true;
    });

    const grown: Array<string> = Object.keys(counts)
      .filter((file: string): boolean => {
        return counts[file]! > (ALLOWED_ANYWHERE[file]?.count || 0);
      })
      .map((file: string): string => {
        return `${file}: ${counts[file]} (at most ${ALLOWED_ANYWHERE[file]?.count || 0}) - ${found
          .filter((line: string): boolean => {
            return line.startsWith(`${file}:`);
          })
          .join(" | ")}`;
      });

    expect(grown).toEqual([]);

    for (const file of Object.keys(ALLOWED_ANYWHERE)) {
      expect(ALLOWED_ANYWHERE[file]!.why.length).toBeGreaterThan(0);
    }
  }, 300000);

  test("the routed scope reaches every directory from S to W and nothing else", () => {
    expect(ROUTED.test("Components/SessionReplay/Rail/ReplayRail.tsx")).toBe(
      true,
    );
    expect(ROUTED.test("Components/Workflow/WorkflowVariableView.tsx")).toBe(
      true,
    );
    expect(ROUTED.test("Components/UserFlow/UserFlowMap.tsx")).toBe(true);
    expect(ROUTED.test("Components/Runner/RunnerElement.tsx")).toBe(false);
    expect(ROUTED.test("Pages/Slo/Index.tsx")).toBe(false);
  });
});
