import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Color from "Common/Types/Color";
import VerticalFlowSteps, {
  FlowStep,
} from "Common/UI/Components/Diagram/VerticalFlowSteps";
import HorizontalStepChain, {
  ChainStep,
  ChainEndStep,
} from "Common/UI/Components/Diagram/HorizontalStepChain";
import NumberedSteps, {
  NumberedStep,
} from "Common/UI/Components/Diagram/NumberedSteps";
import ConceptCards, {
  ConceptCard,
} from "Common/UI/Components/Diagram/ConceptCards";

const IncidentEpisodeDocs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // How Incident Grouping Works Flow Steps
  const flowSteps: Array<FlowStep> = [
    {
      title: "Incident is Created",
      description:
        "A new incident is triggered from monitoring, alerts, or manual creation",
      icon: IconProp.Alert,
      iconColor: new Color("#ef4444"), // red-500
    },
    {
      title: "Grouping Rules Evaluated",
      description:
        "Incident is matched against enabled grouping rules in priority order",
      icon: IconProp.Filter,
      iconColor: new Color("#3b82f6"), // blue-500
    },
    {
      title: "Find Matching Episode",
      description:
        "System looks for an active episode with matching criteria within the time window",
      icon: IconProp.Search,
      iconColor: new Color("#f59e0b"), // amber-500
    },
    {
      title: "Join or Create Episode",
      description:
        "Incident joins existing episode or creates a new one if no match found",
      icon: IconProp.SquareStack,
      iconColor: new Color("#22c55e"), // green-500
    },
    {
      title: "Notifications Sent",
      description:
        "On-call policies are executed for the episode and/or individual incident",
      icon: IconProp.Bell,
      iconColor: new Color("#8b5cf6"), // violet-500
    },
  ];

  // Episode Lifecycle Steps
  const lifecycleSteps: Array<ChainStep> = [
    {
      stepNumber: 1,
      title: "Active",
      description: "New incidents arriving",
      color: new Color("#ef4444"), // red-500
    },
    {
      stepNumber: 2,
      title: "Acknowledged",
      description: "Being investigated",
      color: new Color("#f59e0b"), // amber-500
    },
    {
      stepNumber: 3,
      title: "Resolved",
      description: "All incidents resolved",
      color: new Color("#22c55e"), // green-500
    },
  ];

  const lifecycleEndStep: ChainEndStep = {
    title: "Closed",
    description: "Episode complete",
    icon: IconProp.CheckCircle,
    color: new Color("#6b7280"), // gray-500
  };

  // Setup Steps
  const setupSteps: Array<NumberedStep> = [
    {
      title: "Navigate to Grouping Rules",
      description:
        "Go to Incidents > Settings > Grouping Rules to configure how incidents are automatically grouped.",
    },
    {
      title: "Create a Grouping Rule",
      description:
        "Define match criteria (monitors, severity, labels, title patterns) to identify which incidents should be grouped together.",
    },
    {
      title: "Configure Time Window",
      description:
        "Set the rolling time window (e.g., 60 minutes). Incidents within this gap of the last incident will be grouped together.",
    },
    {
      title: "Set Episode Template",
      description:
        "Optionally configure an episode title template using placeholders like {incidentTitle}, {monitorName}, {incidentSeverity}.",
    },
    {
      title: "Assign On-Call Policies",
      description:
        "Link on-call duty policies to be notified when new episodes are created by this rule.",
      icon: IconProp.CheckCircle,
      color: new Color("#22c55e"), // green-500
    },
  ];

  // Concept Cards
  const conceptCards: Array<ConceptCard> = [
    {
      title: "Episodes",
      description:
        "Logical containers that group related incidents together. Instead of seeing 50 individual incidents, you see one episode with 50 incidents.",
      icon: IconProp.SquareStack,
      iconColor: new Color("#3b82f6"), // blue-500
    },
    {
      title: "Grouping Rules",
      description:
        "Configurable rules that define how incidents are automatically matched and grouped into episodes based on criteria like monitor, severity, or labels.",
      icon: IconProp.Filter,
      iconColor: new Color("#22c55e"), // green-500
    },
    {
      title: "Time Window",
      description:
        "Optional rolling window that limits how long an episode stays open. When enabled, incidents are only grouped if they arrive within the time gap. When disabled, all matching incidents are grouped into a single ongoing episode regardless of time.",
      icon: IconProp.Clock,
      iconColor: new Color("#f59e0b"), // amber-500
    },
    {
      title: "Priority Order",
      description:
        "Rules are evaluated in priority order (lower number = higher priority). The first matching rule wins and groups the incident.",
      icon: IconProp.BarsArrowDown,
      iconColor: new Color("#8b5cf6"), // violet-500
    },
  ];

  // Flapping Prevention Cards
  const flappingCards: Array<ConceptCard> = [
    {
      title: "Resolve Delay",
      description:
        "Grace period after all incidents resolve before auto-resolving the episode. Helps prevent unnecessary state changes during incident flapping - when incidents rapidly toggle between triggered and resolved states.",
      icon: IconProp.Clock,
      iconColor: new Color("#f59e0b"), // amber-500
    },
    {
      title: "Reopen Window",
      description:
        "Time window after resolution where a matching incident will reopen the episode instead of creating a new one.",
      icon: IconProp.Refresh,
      iconColor: new Color("#3b82f6"), // blue-500
    },
    {
      title: "Inactivity Timeout",
      description:
        "Automatically resolve episodes after a period of no new incidents being added.",
      icon: IconProp.Time,
      iconColor: new Color("#6b7280"), // gray-500
    },
  ];

  // On-Call Policy Flow Steps
  const onCallFlowSteps: Array<FlowStep> = [
    {
      title: "Incident Created",
      description:
        "A new incident is triggered and may have its own on-call policy configured",
      icon: IconProp.Alert,
      iconColor: new Color("#ef4444"), // red-500
    },
    {
      title: "Incident Policy Executes",
      description:
        "If the incident has an on-call policy, it executes immediately to notify responders",
      icon: IconProp.Bell,
      iconColor: new Color("#f59e0b"), // amber-500
    },
    {
      title: "Incident Joins Episode",
      description:
        "The incident is grouped into an existing or new episode based on grouping rules",
      icon: IconProp.SquareStack,
      iconColor: new Color("#3b82f6"), // blue-500
    },
    {
      title: "Episode Policy Executes",
      description:
        "If this creates a NEW episode, the grouping rule's on-call policy executes",
      icon: IconProp.Bell,
      iconColor: new Color("#22c55e"), // green-500
    },
    {
      title: "Responders Notified",
      description:
        "On-call engineers receive notifications from both incident and episode policies",
      icon: IconProp.Team,
      iconColor: new Color("#8b5cf6"), // violet-500
    },
  ];

  // On-Call Notification Scenarios
  const onCallScenarioCards: Array<ConceptCard> = [
    {
      title: "New Episode Created",
      description:
        "When an incident creates a NEW episode, both the incident's on-call policy AND the grouping rule's on-call policy are executed.",
      icon: IconProp.Add,
      iconColor: new Color("#22c55e"), // green-500
    },
    {
      title: "Incident Joins Existing Episode",
      description:
        "When an incident joins an EXISTING episode, only the incident's on-call policy executes. The episode policy does NOT re-execute.",
      icon: IconProp.Link,
      iconColor: new Color("#3b82f6"), // blue-500
    },
    {
      title: "No On-Call Policy",
      description:
        "If neither the incident nor the grouping rule has an on-call policy configured, no notifications are sent automatically.",
      icon: IconProp.NoSignal,
      iconColor: new Color("#6b7280"), // gray-500
    },
    {
      title: "Dual Notifications",
      description:
        "Be aware that if both incident and episode have policies, responders may receive two notifications - one for each policy execution.",
      icon: IconProp.Notification,
      iconColor: new Color("#f59e0b"), // amber-500
    },
  ];

  // Postmortem Cards
  const postmortemCards: Array<ConceptCard> = [
    {
      title: "Episode Postmortem",
      description:
        "Document lessons learned, timeline of events, and action items at the episode level for comprehensive incident analysis.",
      icon: IconProp.Book,
      iconColor: new Color("#3b82f6"), // blue-500
    },
    {
      title: "Root Cause Analysis",
      description:
        "Track the underlying cause of the episode to identify patterns and prevent future occurrences.",
      icon: IconProp.Search,
      iconColor: new Color("#ef4444"), // red-500
    },
    {
      title: "Remediation Notes",
      description:
        "Document the steps taken to resolve the episode and prevent recurrence for future reference.",
      icon: IconProp.Wrench,
      iconColor: new Color("#22c55e"), // green-500
    },
  ];

  return (
    <Fragment>
      {/* Overview */}
      <Card
        title="What is Incident Grouping?"
        description="Automatically combine related incidents into logical containers called Episodes"
      >
        <div className="p-6">
          <p className="text-gray-600 mb-4">
            Incident Grouping helps reduce incident fatigue by automatically combining
            related incidents into <strong>Episodes</strong>. Instead of seeing 50
            individual &quot;database connection timeout&quot; incidents, operators see one
            episode: &quot;Database Connectivity Issues (50 incidents)&quot;.
          </p>
          <p className="text-gray-600">
            Episodes follow the same state lifecycle as incidents (Active,
            Acknowledged, Resolved) and can have their own on-call policies,
            owners, root cause documentation, and postmortems.
          </p>
        </div>
      </Card>

      {/* How It Works */}
      <div className="mt-5">
        <Card
          title="How It Works"
          description="The journey of an incident through the grouping engine"
        >
          <div className="p-6">
            <VerticalFlowSteps steps={flowSteps} />
          </div>
        </Card>
      </div>

      {/* Episode Lifecycle */}
      <div className="mt-5">
        <Card
          title="Episode Lifecycle"
          description="Episodes follow the same state progression as incidents"
        >
          <div className="p-6">
            <HorizontalStepChain
              steps={lifecycleSteps}
              endStep={lifecycleEndStep}
              defaultStepLabel="State"
            />
            <div className="mt-4 text-sm text-gray-500">
              <p>
                <strong>State Cascade:</strong> Acknowledging or resolving an
                episode will acknowledge or resolve all member incidents.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Key Concepts */}
      <div className="mt-5">
        <Card
          title="Key Concepts"
          description="Understanding the components of incident grouping"
        >
          <div className="p-6">
            <ConceptCards cards={conceptCards} columns={2} />
          </div>
        </Card>
      </div>

      {/* Setup Steps */}
      <div className="mt-5">
        <Card
          title="Setup Guide"
          description="Follow these steps to configure incident grouping"
        >
          <div className="p-6">
            <NumberedSteps steps={setupSteps} />
          </div>
        </Card>
      </div>

      {/* Flapping Prevention */}
      <div className="mt-5">
        <Card
          title="Flapping Prevention"
          description="Settings to prevent rapid state changes and incident noise"
        >
          <div className="p-6">
            <ConceptCards cards={flappingCards} columns={3} />
          </div>
        </Card>
      </div>

      {/* Postmortem & Documentation */}
      <div className="mt-5">
        <Card
          title="Postmortem & Documentation"
          description="Comprehensive documentation features for incident episodes"
        >
          <div className="p-6">
            <p className="text-gray-600 mb-4">
              Incident Episodes support comprehensive postmortem documentation,
              allowing teams to capture lessons learned and prevent future incidents.
            </p>
            <ConceptCards cards={postmortemCards} columns={3} />
          </div>
        </Card>
      </div>

      {/* On-Call Policies Overview */}
      <div className="mt-5">
        <Card
          title="On-Call Policies & Notifications"
          description="How on-call policies work with incidents and episodes"
        >
          <div className="p-6">
            <p className="text-gray-600 mb-4">
              On-call policies can be configured at two levels: on individual{" "}
              <strong>incidents</strong> (via monitors or manual configuration) and
              on <strong>grouping rules</strong> (for episodes). Understanding
              how these interact is important for managing notification volume.
            </p>
            <VerticalFlowSteps steps={onCallFlowSteps} />
          </div>
        </Card>
      </div>

      {/* On-Call Notification Scenarios */}
      <div className="mt-5">
        <Card
          title="Notification Scenarios"
          description="When and how on-call policies are triggered"
        >
          <div className="p-6">
            <ConceptCards cards={onCallScenarioCards} columns={2} />
            <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <h4 className="font-semibold text-blue-800 mb-2">
                Recommendation
              </h4>
              <p className="text-blue-700 text-sm">
                To avoid duplicate notifications, consider using{" "}
                <strong>only episode-level on-call policies</strong> for grouped
                incidents. Configure on-call policies on your grouping rules and
                leave individual incident on-call policies empty. This way,
                responders are notified once per episode rather than for every
                individual incident.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* On-Call Policy Configuration */}
      <div className="mt-5">
        <Card
          title="Configuring On-Call for Episodes"
          description="How to set up on-call policies for incident grouping"
        >
          <div className="p-6">
            <ul className="list-disc list-inside space-y-3 text-gray-600">
              <li>
                <strong>Grouping Rule On-Call Policy:</strong> When creating or
                editing a grouping rule, you can assign one or more on-call duty
                policies. These policies execute when a NEW episode is created
                by the rule.
              </li>
              <li>
                <strong>Default Team/User Assignment:</strong> Grouping rules
                can also specify default team or user ownership for episodes.
                This determines who is responsible for the episode even if
                on-call policies aren&apos;t configured.
              </li>
              <li>
                <strong>Incident-Level Policies:</strong> Individual incidents can
                still have their own on-call policies (configured on monitors).
                These execute regardless of whether the incident is grouped into an
                episode.
              </li>
              <li>
                <strong>State Change Notifications:</strong> When an episode
                state changes (e.g., acknowledged or resolved), owners are
                notified based on the episode&apos;s configured notification
                settings.
              </li>
            </ul>
          </div>
        </Card>
      </div>

      {/* Best Practices */}
      <div className="mt-5">
        <Card
          title="Best Practices"
          description="Tips for effective incident grouping"
        >
          <div className="p-6">
            <ul className="list-disc list-inside space-y-2 text-gray-600">
              <li>
                <strong>Start with high-priority rules</strong> - Create
                specific rules for critical services first, then add broader
                catch-all rules with lower priority.
              </li>
              <li>
                <strong>Use appropriate time windows</strong> - High-frequency
                incidents may need shorter windows (5-15 min), while
                standard monitoring can use longer windows (30-60 min).
              </li>
              <li>
                <strong>Group by service or component</strong> - Configure rules
                to group incidents from the same monitor or service together for
                easier triage.
              </li>
              <li>
                <strong>Set meaningful episode titles</strong> - Use title
                templates to create descriptive episode names that help
                operators understand the issue at a glance.
              </li>
              <li>
                <strong>Configure on-call policies</strong> - Assign on-call
                policies to grouping rules so the right team is notified when
                episodes are created.
              </li>
              <li>
                <strong>Document root causes</strong> - Use the root cause field
                on episodes to document findings for future reference.
              </li>
              <li>
                <strong>Write postmortems</strong> - After resolving major episodes,
                document the timeline, root cause, and action items in the postmortem
                to improve future incident response.
              </li>
            </ul>
          </div>
        </Card>
      </div>
    </Fragment>
  );
};

export default IncidentEpisodeDocs;
