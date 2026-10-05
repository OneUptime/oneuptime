import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SetupGuideSteps, {
  SetupGuideStepVariants,
  SetupGuideStepView,
} from "../SetupGuide/SetupGuideSteps";
import { AGENT_KINDS, AgentKind, AgentKindDefinition } from "./AgentKind";
import {
  AgentUpgradeGuide,
  AgentUpgradeGuideContext,
  AgentUpgradeMethod,
  AgentUpgradeStep,
  getAgentUpgradeGuide,
} from "./AgentUpgradeGuides";

/*
 * How to upgrade one agent: the dialog the sign beside an outdated agent
 * version opens (AgentVersion).
 *
 * It names the agent and both versions, then shows this kind of agent's
 * upgrade as the numbered steps the setup guides use, each command with a
 * copy button. An agent that may have been installed more than one way (the
 * Docker CLI or Compose, an install script or Compose) gets a tab per way,
 * labelled like the setup guide's own choices. Nothing to fill in, so the one
 * button is Close.
 *
 * Loaded lazily by AgentVersion; reusable anywhere an agent version is drawn.
 */

export interface ComponentProps {
  kind: AgentKind;
  currentVersion: string;
  latestVersion: string;
  setupGuideRoute?: Route | undefined;
  upgradeGuideContext?: AgentUpgradeGuideContext | undefined;
  onClose: () => void;
}

const AgentUpgradeModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const definition: AgentKindDefinition = AGENT_KINDS[props.kind];
  const guide: AgentUpgradeGuide | null = getAgentUpgradeGuide(
    props.kind,
    props.upgradeGuideContext,
  );

  const title: string = translator.translateTemplate(
    "Upgrade the {{agentName}}",
    { agentName: definition.name },
  );

  const description: string = definition.isRunner
    ? translator.translateTemplate(
        "This Runner runs version {{current}}. Version {{latest}} is available.",
        { current: props.currentVersion, latest: props.latestVersion },
      )
    : translator.translateTemplate(
        "This agent runs version {{current}}. Version {{latest}} is available.",
        { current: props.currentVersion, latest: props.latestVersion },
      );

  const renderStep: (step: AgentUpgradeStep) => SetupGuideStepView = (
    step: AgentUpgradeStep,
  ): SetupGuideStepView => {
    return {
      title: translator.translateText(step.title) || step.title,
      description: step.description
        ? translator.translateTemplate(step.description, step.values || {})
        : undefined,
      content: (
        <div className="space-y-3">
          {step.code ? (
            <CodeBlock language={step.language || "bash"} code={step.code} />
          ) : (
            <></>
          )}
          {step.needsSetupGuide && props.setupGuideRoute ? (
            <Link
              to={props.setupGuideRoute}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
            >
              <Icon icon={IconProp.BookOpen} className="h-4 w-4" />
              <span>{translator.translateText("Open the setup guide")}</span>
            </Link>
          ) : (
            <></>
          )}
        </div>
      ),
    };
  };

  const renderMethod: (method: AgentUpgradeMethod) => ReactElement = (
    method: AgentUpgradeMethod,
  ): ReactElement => {
    return (
      <div className="space-y-4">
        <SetupGuideSteps steps={method.steps.map(renderStep)} />
        {method.note ? (
          <p
            className="text-sm text-gray-500"
            data-testid="agent-upgrade-method-note"
          >
            {translator.translateTemplate(method.note, method.noteValues || {})}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Modal
      title={title}
      description={description}
      onClose={props.onClose}
      closeButtonText="Close"
      modalWidth={ModalWidth.Medium}
    >
      <div className="space-y-5" data-testid="agent-upgrade-dialog">
        {guide && guide.methods.length > 0 ? (
          <SetupGuideStepVariants
            variants={guide.methods.map((method: AgentUpgradeMethod) => {
              return {
                label: translator.translateText(method.label) || method.label,
                content: renderMethod(method),
              };
            })}
          />
        ) : (
          <></>
        )}
        <p className="text-sm text-gray-500">
          {translator.translateText(
            "The new version shows here a few minutes after the upgrade.",
          )}
        </p>
      </div>
    </Modal>
  );
};

export default AgentUpgradeModal;
