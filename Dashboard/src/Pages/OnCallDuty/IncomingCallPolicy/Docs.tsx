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
      iconColor: new Color("#3b82f6"), // blue-500
    },
    {
      title: "Twilio Receives the Call",
      description: "Twilio routes the call to OneUptime via webhook",
      icon: IconProp.Call,
      iconColor: new Color("#ef4444"), // red-500
    },
    {
      title: "OneUptime Processes the Call",
      description: "Plays greeting message and loads escalation rules",
      icon: IconProp.AltGlobe,
      iconColor: new Color("#22c55e"), // green-500
    },
    {
      title: "Escalation Rules Execute",
      description: "Tries each rule in order until someone answers",
      icon: IconProp.BarsArrowDown,
      iconColor: new Color("#f59e0b"), // amber-500
    },
    {
      title: "Caller Connected to Engineer",
      description: "Call is connected when an on-call engineer answers",
      icon: IconProp.CheckCircle,
      iconColor: new Color("#8b5cf6"), // violet-500
    },
  ];

  // Escalation Chain Steps
  const escalationSteps: Array<ChainStep> = [
    {
      stepNumber: 1,
      title: "Primary On-Call",
      description: "Wait 30 seconds",
      color: new Color("#3b82f6"), // blue-500
    },
    {
      stepNumber: 2,
      title: "Backup Team",
      description: "Wait 30 seconds",
      color: new Color("#f59e0b"), // amber-500
    },
    {
      stepNumber: 3,
      title: "Manager",
      description: "Wait 30 seconds",
      color: new Color("#ef4444"), // red-500
    },
  ];

  const escalationEndStep: ChainEndStep = {
    title: "No Answer",
    description: "Play voicemail message",
    icon: IconProp.Stop,
    color: new Color("#6b7280"), // gray-500
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
      color: new Color("#22c55e"), // green-500
    },
  ];

  // Concept Cards
  const conceptCards: Array<ConceptCard> = [
    {
      title: "Escalation Rules",
      description:
        "Define the order in which on-call users, teams, or schedules are contacted. If one doesn't answer, the call moves to the next rule.",
      icon: IconProp.BarsArrowDown,
      iconColor: new Color("#3b82f6"), // blue-500
    },
    {
      title: "On-Call Schedules",
      description:
        "Automatically route calls to whoever is currently on-call based on your rotation schedules.",
      icon: IconProp.Clock,
      iconColor: new Color("#22c55e"), // green-500
    },
    {
      title: "Voice Messages",
      description:
        "Customize the greeting message, no-answer message, and other voice prompts callers hear.",
      icon: IconProp.Microphone,
      iconColor: new Color("#f59e0b"), // amber-500
    },
    {
      title: "Call Logs",
      description:
        "View detailed logs of all incoming calls including caller info, status, who answered, and call duration.",
      icon: IconProp.Logs,
      iconColor: new Color("#8b5cf6"), // violet-500
    },
  ];

  return (
    <Fragment>
      {/* How It Works Overview */}
      <Card
        title="How It Works"
        description="How callers reach your on-call engineers"
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
            <NumberedSteps steps={setupSteps} />
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
