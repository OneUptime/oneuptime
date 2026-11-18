// UX rule: Docs/ux/README.md#one-control-for-one-job
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";
import {
  findHandWrittenChips,
  HandWrittenChip,
  isHandWrittenChipClass,
} from "./HandWrittenChipFinder";

/*
 * ONE CHIP (#9137).
 *
 * A coloured status or label chip was drawn four ways: the Pill, a
 * StatusBadge with a gradient and bold text, a Badge with a shadow, and some
 * three hundred <span>s written by hand, rounded-full in one file and
 * rounded-md in the next, each with its own green. One page could show
 * "Active" in two shapes and two colours, and each handled the dark theme
 * its own way, or not at all.
 *
 * Every chip is now the Pill (Common/UI/Components/Pill): a `tone`
 * (PillTone: Neutral, Info, Success, Warning, Danger, and Paused for what
 * someone switched off) or a colour someone picked, one size and shape,
 * text at 4.5:1 or better in both themes, an optional icon or no dot, and
 * words that end in "..." with the whole of them on hover. StatusBadge is a
 * Pill underneath; Badge is kept for counts beside a menu's entries.
 *
 * This reads every frontend's browser source (and Common/UI, and ee/ when
 * present) and fails on a chip drawn by hand: an element whose classes are
 * an inline flex box, rounded-full or rounded-md, px-0.5 to px-3, text-xs
 * (or 10 or 11px) and a pale bg-<colour>-50/100/200, with no hover or focus
 * classes, click handler or role (HandWrittenChipFinder).
 *
 * HAND_WRITTEN_CHIP_EXCEPTIONS lists a file, how many such chips it may
 * hold, and why: the chips that are not a status or a label (a count
 * bubble, a code token, a chip with a remove button inside). Each count is
 * exact, so its reason stays true; a chip that can be the Pill is the Pill.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

export const HAND_WRITTEN_CHIP_EXCEPTIONS: Record<
  string,
  { count: number; reason: string }
> = {
  "ee/Dashboard/TelemetryRetention/TelemetryRetentionConfigSummary.tsx": {
    count: 1,
    reason:
      "Several parts in different weights (a name and its count or value), not one text.",
  },
  "packages/App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker.tsx":
    {
      count: 1,
      reason:
        "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppHeader.tsx":
    {
      count: 1,
      reason:
        "A monospace code token (a port, an architecture, a URL, a variable), not a status or label.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar.tsx":
    {
      count: 1,
      reason:
        "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmTranscriptStepView.tsx":
    {
      count: 1,
      reason:
        "A transcript step marker (kind, model, duration) whose ring marks the current step.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Logs/LogsDashboard.tsx": {
    count: 1,
    reason:
      "A saved view's scope: a sentence with a bold slot and a remove button.",
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricFormula.tsx":
    {
      count: 1,
      reason:
        "A monospace code token (a port, an architecture, a URL, a variable), not a status or label.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricView.tsx": {
    count: 2,
    reason:
      "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricsDashboard.tsx":
    {
      count: 1,
      reason:
        "A saved view's scope: a sentence with a bold slot and a remove button.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkEvents/SyslogSetupGuide.tsx":
    {
      count: 1,
      reason:
        "A monospace code token (a port, an architecture, a URL, a variable), not a status or label.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkTraffic/TrafficSetupGuide.tsx":
    {
      count: 1,
      reason:
        "A monospace code token (a port, an architecture, a URL, a variable), not a status or label.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules.tsx":
    {
      count: 1,
      reason:
        "A step connector whose sentence holds a bold duration, which a Pill's plain text cannot.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationSummary.tsx":
    {
      count: 1,
      reason: "A responder of several parts with a readiness dot.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ResponderReadinessCard.tsx":
    {
      count: 1,
      reason:
        "A notification method's name and its masked number in their own style.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackNetworkCountsCard.tsx":
    {
      count: 1,
      reason:
        "Several parts in different weights (a name and its count or value), not one text.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Owners/OwnersCard.tsx": {
    count: 1,
    reason:
      "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Profiles/ProfileTable.tsx":
    {
      count: 3,
      reason:
        "A removable filter chip: its words, a value in another weight, and a remove button inside.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetFilterBar.tsx":
    {
      count: 1,
      reason:
        "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateFilterBuilder.tsx":
    {
      count: 1,
      reason:
        "An AND / OR operator token in a query builder, coloured to match its connector toggle.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayCorrelationPanel.tsx":
    {
      count: 1,
      reason:
        "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPinControl.tsx":
    {
      count: 1,
      reason:
        "Its visible words and what a screen reader hears differ (aria-hidden and sr-only).",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Slo/SloErrorBudgetPolicyTierCard.tsx":
    {
      count: 1,
      reason:
        "Holds a <time dateTime> with its own hover title inside the sentence.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer.tsx":
    {
      count: 1,
      reason:
        "A monospace code token (a port, an architecture, a URL, a variable), not a status or label.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/TracesDashboard.tsx":
    {
      count: 1,
      reason:
        "A saved view's scope: a sentence with a bold slot and a remove button.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowJourneys.tsx":
    {
      count: 1,
      reason:
        "A monospace code token (a port, an architecture, a URL, a variable), not a status or label.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCondition.tsx":
    {
      count: 1,
      reason:
        "An AND / OR operator token in a query builder, coloured to match its connector toggle.",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/Overview.tsx": {
    count: 1,
    reason:
      "A monospace code token (a port, an architecture, a URL, a variable), not a status or label.",
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index.tsx": {
    count: 1,
    reason:
      "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Volumes.tsx": {
    count: 1,
    reason:
      "Several parts in different weights (a name and its count or value), not one text.",
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps.tsx": {
    count: 2,
    reason:
      "An icon alone on a phone, its words sr-only there (max-sm:sr-only), which the Pill does not do.",
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/TelemetryIngestionKeyView.tsx":
    {
      count: 1,
      reason:
        "A monospace code token (a port, an architecture, a URL, a variable), not a status or label.",
    },
  "packages/Common/UI/Components/EditionLabel/EditionLabel.tsx": {
    count: 1,
    reason:
      "The uppercase Evaluation license stamp inside the edition button, part of that button's own look.",
  },
  "packages/Common/UI/Components/EntityDropdown/EntityDropdown.tsx": {
    count: 2,
    reason:
      "A picked option with a remove button and an Archived tag inside, and a count bubble on a tab.",
  },
  "packages/Common/UI/Components/FilterButtons/FilterButtons.tsx": {
    count: 1,
    reason:
      "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
  },
  "packages/Common/UI/Components/FoldedSection/FoldedSection.tsx": {
    count: 1,
    reason:
      "A setting's title and value in two weights, read by its data-item-key.",
  },
  "packages/Common/UI/Components/ModelTable/TableView.tsx": {
    count: 1,
    reason:
      "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
  },
  "packages/Common/UI/Components/OsVersionDisplay/OsVersionDisplay.tsx": {
    count: 1,
    reason:
      "A monospace code token (a port, an architecture, a URL, a variable), not a status or label.",
  },
  "packages/Common/UI/Components/SavedViews/SavedViewsFacetSection.tsx": {
    count: 1,
    reason:
      "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
  },
  "packages/Common/UI/Components/TelemetryViewer/components/FacetSectionHeader.tsx":
    {
      count: 1,
      reason:
        "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
    },
  "packages/Common/UI/Components/TelemetryViewer/components/TelemetryDetailPanel.tsx":
    {
      count: 1,
      reason:
        "A count bubble: a fixed height and min-width, centred beside a tab, button or heading, which is a number, not a chip.",
    },
  "packages/Common/UI/Components/Workflow/Condition/ConditionEditor.tsx": {
    count: 1,
    reason:
      "A fixed-width Yes key lined up with its No key in an if / else summary, not a status.",
  },
  "packages/Common/UI/Components/Workflow/Switch/SwitchEditor.tsx": {
    count: 1,
    reason: "A case's number in a fixed box, hidden from screen readers.",
  },
};

describe("the guard reads the shapes it is meant to", () => {
  test("a hand-written chip is caught, in a string, a template and a choice", () => {
    const code: string = `
      const A = () => (
        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Connected</span>
      );
      const B = (props) => (
        <div
          className={\`inline-flex items-center gap-1 rounded-md \${props.isOk ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"} px-1.5 py-0.5 text-[11px]\`}
        >
          {props.text}
        </div>
      );
      const C = () => (
        <span className="ml-auto inline-flex rounded-full bg-indigo-100/60 px-2.5 text-xs">Beta</span>
      );
    `;

    expect(
      findHandWrittenChips("Fixture.tsx", code).map(
        (chip: HandWrittenChip): number => {
          return chip.line;
        },
      ),
    ).toEqual([3, 6, 13]);
  });

  test("a control, a plain box and the Pill are left alone", () => {
    const code: string = `
      const A = () => (
        <span className="inline-flex rounded-md bg-gray-50 px-2 text-xs hover:bg-gray-100">Filter</span>
      );
      const B = () => (
        <span onClick={() => {}} className="inline-flex rounded-full bg-gray-50 px-2 text-xs">x</span>
      );
      const C = () => (
        <button className="inline-flex rounded-full bg-gray-50 px-2 text-xs">Go</button>
      );
      const D = () => (
        <div className="inline-flex rounded-lg bg-gray-50 px-4 py-3 text-sm">A card</div>
      );
      const E = () => <Pill text="Connected" tone={PillTone.Success} />;
      const F = () => (
        <span className="inline-flex rounded-full bg-white px-2 text-xs ring-1">Plain</span>
      );
    `;

    expect(findHandWrittenChips("Fixture.tsx", code)).toEqual([]);
  });

  test("the class test needs every part of the chip's look", () => {
    const chip: Array<string> = [
      "inline-flex",
      "rounded-full",
      "px-2",
      "text-xs",
      "bg-amber-50",
    ];

    expect(isHandWrittenChipClass(chip)).toBe(true);

    for (const part of chip) {
      expect(
        isHandWrittenChipClass(
          chip.filter((token: string): boolean => {
            return token !== part;
          }),
        ),
      ).toBe(false);
    }
  });
});

describe("every status or label chip is the Pill", () => {
  const roots: Array<string> = listScanRoots(REPOSITORY_ROOT);
  const files: Array<string> = roots.flatMap((root: string): Array<string> => {
    return listSourceFiles(root);
  });
  const hasEnterprise: boolean = fs.existsSync(
    path.join(REPOSITORY_ROOT, "ee"),
  );

  const foundByFile: Map<string, Array<HandWrittenChip>> = new Map();

  for (const file of files) {
    const relative: string = toRelativePath(REPOSITORY_ROOT, file);
    const found: Array<HandWrittenChip> = findHandWrittenChips(
      relative,
      fs.readFileSync(file, "utf8"),
    );

    if (found.length > 0) {
      foundByFile.set(relative, found);
    }
  }

  if (process.env["PRINT_HAND_WRITTEN_CHIPS"]) {
    // Prints the current count per file, to write the exceptions from.
    const counts: Record<string, number> = {};
    for (const [file, found] of [...foundByFile.entries()].sort()) {
      counts[file] = found.length;
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(counts, null, 1));
    // eslint-disable-next-line no-console
    console.log(
      [...foundByFile.values()]
        .flat()
        .map((chip: HandWrittenChip): string => {
          return `CHIP ${chip.file}:${chip.line}`;
        })
        .join("\n"),
    );
  }

  test("the scan reads the frontends", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  test("no file draws more chips by hand than its exception allows", () => {
    const unexplained: Array<string> = [];

    foundByFile.forEach((found: Array<HandWrittenChip>, file: string): void => {
      const allowed: number = HAND_WRITTEN_CHIP_EXCEPTIONS[file]?.count || 0;

      if (found.length > allowed) {
        for (const chip of found) {
          unexplained.push(
            `${chip.file}:${chip.line} draws a chip by hand: use <Pill text="..." tone={PillTone.Success} /> (Common/UI/Components/Pill), isDotHidden for a tag, icon for an icon`,
          );
        }
      }
    });

    expect(unexplained).toEqual([]);
  });

  test("every exception says why, and none lists more than its file holds", () => {
    const stale: Array<string> = [];

    for (const [file, exception] of Object.entries(
      HAND_WRITTEN_CHIP_EXCEPTIONS,
    )) {
      expect(exception.reason.length).toBeGreaterThan(10);

      if (file.startsWith("ee/") && !hasEnterprise) {
        continue;
      }

      const count: number = foundByFile.get(file)?.length || 0;

      if (count !== exception.count) {
        stale.push(
          `${file} holds ${count}, the exception lists ${exception.count}${count === 0 ? ": remove it" : ""}`,
        );
      }
    }

    expect(stale).toEqual([]);
  });
});
