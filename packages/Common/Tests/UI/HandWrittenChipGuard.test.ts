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
 * hold, and why. A count may only go down: move a chip to the Pill and lower
 * it, or remove the file once it holds none.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// Chips not yet moved to the Pill (#9137): this list only shrinks.
const NOT_YET_MOVED: string = "Not yet moved to the Pill (#9137).";

export const HAND_WRITTEN_CHIP_EXCEPTIONS: Record<
  string,
  { count: number; reason: string }
> = {
  "ee/Dashboard/TelemetryRetention/TelemetryRetentionConfigSummary.tsx": {
    count: 1,
    reason:
      "Several parts in different weights (a name and its count or value), not one text.",
  },
  "packages/App/FeatureSet/Dashboard/src/Components/AI/CallSummary/CallSummarySection.tsx":
    { count: 3, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionTiles.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/AIInsights/InsightPresentation.tsx":
    { count: 5, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppHeader.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo.tsx": {
    count: 1,
    reason: NOT_YET_MOVED,
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionTiles.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Code/CodeConnectDialog.tsx":
    { count: 3, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoriesTable.tsx":
    { count: 3, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/CodeRepository/RepositoryConnectionStatus.tsx":
    { count: 6, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/CustomDomain/PublicAddresses.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistPlayerBar.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/DataSecurity/StoreDataTypeList.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/EnterpriseEdition/EnterpriseFeatureUpgrade.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodePickerList.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembersCard.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/NoteCard.tsx": {
    count: 2,
    reason: NOT_YET_MOVED,
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAIExplanation.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSimilar.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsDashboard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/OccuranceTable.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerToolList.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplatePicker.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/QuestionCard.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/QuestionInputPreview.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/QuestionPalette.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/FormBuilder/Templates/FormTemplates.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageGuidedSetup.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Host/HostFilesystemsTable.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsTable.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesRecentWarningsCard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmTranscriptStepView.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Logs/LogsDashboard.tsx": {
    count: 1,
    reason: NOT_YET_MOVED,
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Mattermost/MattermostTeamsCard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx": {
    count: 1,
    reason: NOT_YET_MOVED,
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricFormula.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricFormulaConfig.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig.tsx":
    { count: 3, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricView.tsx": {
    count: 2,
    reason: NOT_YET_MOVED,
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricsDashboard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChatsCard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveredHostTable.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/MultiDeviceSnmpWalkResults.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkResults.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkEvents/SyslogSetupGuide.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/ImportSitesFromCsvModal.tsx":
    { count: 3, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteCard.tsx": {
    count: 1,
    reason: NOT_YET_MOVED,
  },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteGeoMap.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteStatusHero.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiApplianceLinkModal.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkTraffic/TrafficSetupGuide.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTable.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleReadiness.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules.tsx":
    { count: 4, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationSummary.tsx":
    { count: 3, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable.tsx":
    { count: 5, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/NotifiedVia.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicySummary.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ActiveOverridesCard.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/FinalScheduleSummary.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerCard.tsx":
    { count: 3, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerUser.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/Layers.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/CoverageMatrix.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ResponderReadinessCard.tsx":
    { count: 3, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackServiceGroupCard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackServicesCard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackBlastRadiusCard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackNetworkCountsCard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Owners/OwnersCard.tsx": {
    count: 1,
    reason: NOT_YET_MOVED,
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Postmortem/ActionItems/PostmortemActionItems.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Profiles/ProfileScopeBar.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Profiles/ProfileTable.tsx":
    { count: 3, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsList.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetFilterBar.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartAlertsCard.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartHero.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcaseCard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Runbook/RunbookVariablesTable.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseImpactCard.tsx":
    { count: 3, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateFilterBuilder.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleSummary.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskHeader.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntHeader.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryRulePanel.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryTable.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepFlag.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayCorrelationPanel.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPinControl.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideOptionPicker.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Slack/SlackOrganizationCard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Slo/SloErrorBudgetPolicyTierCard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Slo/SloMonthlyReportTable.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Slo/SloRecommendedPolicyTiersModal.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/StatusPage/ImportGroupsFromCsvModal.tsx":
    { count: 3, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceGraph.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceHeader.tsx":
    { count: 4, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceSpanPanel.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/TracesDashboard.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/TwoFactorAuth/WebAuthnCredentials.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowJourneys.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/SetupChecklistTile.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/VMware/Host/VMwareHostBusiestVirtualMachines.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallProviderGallery.tsx":
    { count: 2, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCondition.tsx":
    { count: 1, reason: NOT_YET_MOVED },
  "packages/App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceConnectionsOverview.tsx":
    { count: 1, reason: NOT_YET_MOVED },
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

      /*
       * A chip moved to the Pill lowers its count; an exception that is not
       * a chip not yet moved must be exact, so its reason stays true.
       */
      const isExact: boolean = exception.reason !== NOT_YET_MOVED;

      if (count > exception.count || (isExact && count !== exception.count)) {
        stale.push(
          `${file} holds ${count}, the exception lists ${exception.count}`,
        );
      }

      if (!isExact && count < exception.count) {
        stale.push(
          `${file} holds ${count} now: lower its count to ${count}${count === 0 ? " by removing it" : ""}`,
        );
      }
    }

    expect(stale).toEqual([]);
  });
});
