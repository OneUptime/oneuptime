import {
  AGENT_AI_SETTINGS_COMMANDS_TITLE,
  AGENT_AI_SETTINGS_DIALOG_INTRO,
  AGENT_AI_SETTINGS_DONE_TEXT,
  AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS,
  AI_ACCESS_FIXES_ROW_TITLE,
  AI_ACCESS_INVESTIGATION_ROW_TITLE,
  AI_FIXES_MODE_ICONS,
  AgentAiSettingsChoice,
  AiFixesMode,
} from "./AiAccessModes";
import {
  AGENT_AI_SETTINGS_FIXES_ORDER,
  AgentAiSettingsInstructions,
  AgentAiSettingsStep,
  AgentAiSettingsWay,
  getInitialAgentAiSettingsChoice,
} from "./AgentAiSettingsInstructions";
import SetupGuideSteps, {
  SetupGuideStepVariants,
  SetupGuideStepView,
} from "../SetupGuide/SetupGuideSteps";
import { AgentAiSettingsSource } from "Common/Types/AI/AgentAiSettings";
import IconProp from "Common/Types/Icon/IconProp";
import CardSelect, {
  CardSelectOption,
} from "Common/UI/Components/CardSelect/CardSelect";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useMemo,
  useState,
} from "react";

/*
 * "Change what AI may do", for settings an agent's configuration sets.
 *
 * "This particular thing should be synced with the agent, and I should not
 * be able to manually edit it. When I try to edit it, show me options and
 * commands to update the agent based on which option I want to select."
 *
 * Nothing here saves anything. The reader picks what AI may do — the same
 * two questions the page shows (Investigation, Fixes) — and the dialog
 * shows the command that sets exactly that in the agent, as the page's
 * setup guide writes it (props.getInstructions), with a tab per way where
 * there is more than one. The agent restarts with it, reports it, and the
 * page follows. The one button is Close.
 *
 * Shared by a Kubernetes cluster's AI agent page and every other
 * resource's; each hands in its own words and commands.
 */

export interface ComponentProps {
  // The agent, as the intro names it ("Kubernetes AI agent").
  agentName: string;
  // Where the settings are set now; the intro says so.
  source: AgentAiSettingsSource;
  // What is in effect now; the choices start here.
  current: AgentAiSettingsChoice;
  // Start with investigation on (the "Needs attention" step that opened it).
  turnOnInvestigation?: boolean | undefined;
  fixesShortNames: Readonly<Record<AiFixesMode, string>>;
  fixesDescriptions: Readonly<Record<AiFixesMode, string>>;
  getInstructions: (
    choice: AgentAiSettingsChoice,
  ) => AgentAiSettingsInstructions;
  onClose: () => void;
}

const AgentAiSettingsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const investigationLabelId: string = `agent-ai-investigation-${useId()}`;
  const fixesLabelId: string = `agent-ai-fixes-${useId()}`;

  const [choice, setChoice] = useState<AgentAiSettingsChoice>(() => {
    return getInitialAgentAiSettingsChoice({
      current: props.current,
      turnOnInvestigation: props.turnOnInvestigation,
    });
  });

  const instructions: AgentAiSettingsInstructions = useMemo(() => {
    return props.getInstructions(choice);
  }, [choice, props.getInstructions]);

  const investigationOptions: Array<CardSelectOption> = [
    {
      value: "on",
      title: AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS.on.title,
      description: AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS.on.description,
      icon: IconProp.MagnifyingGlass,
    },
    {
      value: "off",
      title: AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS.off.title,
      description: AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS.off.description,
      icon: IconProp.NoSymbol,
    },
  ];

  const fixesOptions: Array<CardSelectOption> =
    AGENT_AI_SETTINGS_FIXES_ORDER.map((mode: AiFixesMode): CardSelectOption => {
      return {
        value: mode,
        title: props.fixesShortNames[mode],
        description: props.fixesDescriptions[mode],
        icon: AI_FIXES_MODE_ICONS[mode],
      };
    });

  const inEffect: string = props.current.investigation
    ? translator.translateTemplate(
        "In effect now: investigation on, fixes {{fixes}}.",
        { fixes: translatableTerm(props.fixesShortNames[props.current.fixes]) },
      )
    : translator.translateTemplate(
        "In effect now: investigation off, fixes {{fixes}}.",
        { fixes: translatableTerm(props.fixesShortNames[props.current.fixes]) },
      );

  const renderWay: (way: AgentAiSettingsWay) => ReactElement = (
    way: AgentAiSettingsWay,
  ): ReactElement => {
    return (
      <div className="space-y-2" data-testid={way.dataTestId}>
        {way.intro ? (
          <p className="text-sm leading-6 text-gray-600">
            {translator.translateText(way.intro) || way.intro}
          </p>
        ) : (
          <></>
        )}
        {way.code ? <CodeBlock language="bash" code={way.code} /> : <></>}
        {way.note ? (
          <p className="text-xs leading-5 text-gray-500">
            {translator.translateText(way.note) || way.note}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const steps: Array<SetupGuideStepView> = instructions.steps.map(
    (step: AgentAiSettingsStep): SetupGuideStepView => {
      return {
        title: translator.translateText(step.title) || step.title,
        description: step.description
          ? translator.translateText(step.description) || step.description
          : undefined,
        content: (
          <div data-testid={step.dataTestId}>
            <SetupGuideStepVariants
              variants={step.ways.map((way: AgentAiSettingsWay) => {
                return {
                  label: translator.translateText(way.label) || way.label,
                  content: renderWay(way),
                };
              })}
            />
          </div>
        ),
      };
    },
  );

  return (
    <Modal
      title="Change what AI may do"
      description={translator.translateTemplate(
        AGENT_AI_SETTINGS_DIALOG_INTRO[props.source],
        { agent: translatableTerm(props.agentName) },
      )}
      onClose={props.onClose}
      closeButtonText="Close"
      modalWidth={ModalWidth.Medium}
    >
      <div
        className="space-y-6"
        data-testid="agent-ai-settings-dialog"
        data-source={props.source}
      >
        <p
          className="text-sm text-gray-500"
          data-testid="agent-ai-settings-in-effect"
        >
          {inEffect}
        </p>

        <div className="space-y-2">
          <p
            id={investigationLabelId}
            className="text-sm font-semibold text-gray-900"
          >
            {translator.translateText(AI_ACCESS_INVESTIGATION_ROW_TITLE)}
          </p>
          <CardSelect
            options={investigationOptions}
            value={choice.investigation ? "on" : "off"}
            maxColumns={2}
            ariaLabelledby={investigationLabelId}
            dataTestId="agent-ai-settings-investigation"
            onChange={(value: string) => {
              setChoice((previous: AgentAiSettingsChoice) => {
                return { ...previous, investigation: value === "on" };
              });
            }}
          />
        </div>

        <div className="space-y-2">
          <p id={fixesLabelId} className="text-sm font-semibold text-gray-900">
            {translator.translateText(AI_ACCESS_FIXES_ROW_TITLE)}
          </p>
          <CardSelect
            options={fixesOptions}
            value={choice.fixes}
            singleColumn={true}
            ariaLabelledby={fixesLabelId}
            dataTestId="agent-ai-settings-fixes"
            onChange={(value: string) => {
              setChoice((previous: AgentAiSettingsChoice) => {
                return { ...previous, fixes: value as AiFixesMode };
              });
            }}
          />
        </div>

        <div className="space-y-4" data-testid="agent-ai-settings-commands">
          <p className="text-sm font-semibold text-gray-900">
            {translator.translateText(AGENT_AI_SETTINGS_COMMANDS_TITLE)}
          </p>
          {(instructions.intro || []).map(
            (line: { text: string; dataTestId: string }): ReactElement => {
              return (
                <p
                  key={line.dataTestId}
                  className="text-sm leading-6 text-gray-600"
                  data-testid={line.dataTestId}
                >
                  {translator.translateText(line.text) || line.text}
                </p>
              );
            },
          )}
          <SetupGuideSteps steps={steps} />
          {instructions.notes.map(
            (note: { text: string; dataTestId: string }): ReactElement => {
              return (
                <p
                  key={note.dataTestId}
                  className="text-xs leading-5 text-gray-700"
                  data-testid={note.dataTestId}
                >
                  {translator.translateText(note.text) || note.text}
                </p>
              );
            },
          )}
          <p
            className="text-sm text-gray-500"
            data-testid="agent-ai-settings-done"
          >
            {translator.translateText(AGENT_AI_SETTINGS_DONE_TEXT)}
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default AgentAiSettingsModal;
