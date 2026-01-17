import PageComponentProps from "../../PageComponentProps";
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

const IncomingCallPolicyDocs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // How It Works Flow Steps
  const flowSteps: Array<FlowStep> = [
    {
      title: "Caller Dials Your Number",
      description: "External caller dials your dedicated incoming call number",
      icon: IconProp.User,
      iconColor: new Color("#2563eb"), // blue-600
      iconBackgroundColor: new Color("#dbeafe"), // blue-100
    },
    {
      title: "Twilio Receives the Call",
      description: "Twilio routes the call to OneUptime via webhook",
      icon: IconProp.Call,
      iconColor: new Color("#dc2626"), // red-600
      iconBackgroundColor: new Color("#fee2e2"), // red-100
    },
    {
      title: "OneUptime Processes the Call",
      description: "Plays greeting message and loads escalation rules",
      icon: IconProp.AltGlobe,
      iconColor: new Color("#16a34a"), // green-600
      iconBackgroundColor: new Color("#dcfce7"), // green-100
    },
    {
      title: "Escalation Rules Execute",
      description: "Tries each rule in order until someone answers",
      icon: IconProp.BarsArrowDown,
      iconColor: new Color("#ca8a04"), // yellow-600
      iconBackgroundColor: new Color("#fef9c3"), // yellow-100
    },
    {
      title: "Caller Connected to Engineer",
      description: "Call is connected when an on-call engineer answers",
      icon: IconProp.CheckCircle,
      iconColor: new Color("#9333ea"), // purple-600
      iconBackgroundColor: new Color("#f3e8ff"), // purple-100
    },
  ];

  // Escalation Chain Steps
  const escalationSteps: Array<ChainStep> = [
    {
      stepNumber: 1,
      title: "Primary On-Call",
      description: "Wait 30 seconds",
      backgroundColor: new Color("#3b82f6"), // blue-500
    },
    {
      stepNumber: 2,
      title: "Backup Team",
      description: "Wait 30 seconds",
      backgroundColor: new Color("#eab308"), // yellow-500
    },
    {
      stepNumber: 3,
      title: "Manager",
      description: "Wait 30 seconds",
      backgroundColor: new Color("#ef4444"), // red-500
    },
  ];

  const escalationEndStep: ChainEndStep = {
    title: "No Answer",
    description: "Play message",
    icon: IconProp.Stop,
    backgroundColor: new Color("#9ca3af"), // gray-400
  };

  // Setup Steps
  const setupSteps: Array<NumberedStep> = [
    {
      title: "Configure Twilio Account",
      description:
        "Go to Project Settings > Call & SMS > Custom Call/SMS Config and add your Twilio credentials (Account SID and Auth Token).",
    },
    {
      title: "Select Twilio Configuration",
      description:
        "On the Overview page, select which Twilio configuration to use for this incoming call policy.",
    },
    {
      title: "Configure Phone Number",
      description:
        "Purchase a new phone number from Twilio or use an existing one. The webhook will be automatically configured.",
    },
    {
      title: "Add Escalation Rules",
      description:
        "Define how calls should be routed. Add on-call schedules, teams, or specific users to handle incoming calls.",
    },
    {
      title: "Ready to Receive Calls",
      description:
        "Your incoming call policy is now active. Share the phone number with your team and customers.",
      icon: IconProp.CheckCircle,
      backgroundColor: new Color("#16a34a"), // green-600
    },
  ];

  // Concept Cards
  const conceptCards: Array<ConceptCard> = [
    {
      title: "Escalation Rules",
      description:
        "Define the order in which on-call users, teams, or schedules are contacted. If one doesn't answer, the call moves to the next rule.",
      icon: IconProp.BarsArrowDown,
      iconColor: new Color("#ffffff"),
      iconBackgroundColor: new Color("#3b82f6"), // blue-500
      cardBackgroundColor: new Color("#eff6ff"), // blue-50
    },
    {
      title: "On-Call Schedules",
      description:
        "Automatically route calls to whoever is currently on-call based on your rotation schedules.",
      icon: IconProp.Clock,
      iconColor: new Color("#ffffff"),
      iconBackgroundColor: new Color("#22c55e"), // green-500
      cardBackgroundColor: new Color("#f0fdf4"), // green-50
    },
    {
      title: "Voice Messages",
      description:
        "Customize the greeting message, no-answer message, and other voice prompts callers hear.",
      icon: IconProp.Microphone,
      iconColor: new Color("#ffffff"),
      iconBackgroundColor: new Color("#eab308"), // yellow-500
      cardBackgroundColor: new Color("#fefce8"), // yellow-50
    },
    {
      title: "Call Logs",
      description:
        "View detailed logs of all incoming calls including caller info, status, who answered, and call duration.",
      icon: IconProp.Logs,
      iconColor: new Color("#ffffff"),
      iconBackgroundColor: new Color("#a855f7"), // purple-500
      cardBackgroundColor: new Color("#faf5ff"), // purple-50
    },
  ];

  return (
    <Fragment>
      {/* How It Works Overview */}
      <Card
        title="How Incoming Call Policy Works"
        description="Understand how callers reach your on-call engineers through this policy"
      >
        <div className="p-6">
          <VerticalFlowSteps steps={flowSteps} />
        </div>
      </Card>

      {/* Escalation Flow */}
      <div className="mt-5">
        <Card
          title="Escalation Flow"
          description="How calls are routed through your escalation rules"
        >
          <div className="p-6">
            <HorizontalStepChain
              steps={escalationSteps}
              endStep={escalationEndStep}
              defaultStepLabel="Rule"
            />
          </div>
        </Card>
      </div>

      {/* Setup Steps */}
      <div className="mt-5">
        <Card
          title="Setup Steps"
          description="Follow these steps to configure your incoming call policy"
        >
          <div className="p-6">
            <NumberedSteps
              steps={setupSteps}
              defaultBackgroundColor={new Color("#2563eb")}
            />
          </div>
        </Card>
      </div>

      {/* Key Concepts */}
      <div className="mt-5">
        <Card
          title="Key Concepts"
          description="Understanding the components of an incoming call policy"
        >
          <div className="p-6">
            <ConceptCards cards={conceptCards} columns={2} />
          </div>
        </Card>
      </div>
    </Fragment>
  );
};

export default IncomingCallPolicyDocs;
