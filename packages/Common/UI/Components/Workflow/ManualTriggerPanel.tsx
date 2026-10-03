import ComponentSettingsSection from "./ComponentSettingsSection";
import IconProp from "../../../Types/Icon/IconProp";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

/*
 * The Manual trigger has no settings, so its dialog used to open on a card
 * saying exactly that. What someone opening it wants to know is how it is
 * started. The two names below are the builder toolbar's button and the
 * component's title; ManualTriggerPanel.test.tsx fails if either is renamed
 * without this.
 */
export const RUN_WORKFLOW_BUTTON_TITLE: string = translationKey("Run Workflow");
export const EXECUTE_WORKFLOW_COMPONENT_TITLE: string = "Execute Workflow";

const ManualTriggerPanel: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ComponentSettingsSection
      id="how-to-run"
      icon={IconProp.Play}
      title="How to run it"
      tone="primary"
    >
      <ul
        className="list-disc space-y-1 pl-5 text-sm text-gray-700"
        data-testid="manual-trigger-how-to-run"
      >
        <li>
          {/*
            The toolbar's button reads in the reader's language; the step's name
            is the catalog's, as the canvas shows it.
          */}
          <TranslatedSentence
            template="Click {{button}} in the builder's toolbar and enter the JSON this run starts with."
            slots={{
              button: (
                <strong>
                  {translator.translateText(RUN_WORKFLOW_BUTTON_TITLE)}
                </strong>
              ),
            }}
          />
        </li>
        <li>
          <TranslatedSentence
            template="Or start it from another workflow with an {{step}} step, which passes the JSON for you."
            slots={{
              step: <strong>{EXECUTE_WORKFLOW_COMPONENT_TITLE}</strong>,
            }}
          />
        </li>
      </ul>
    </ComponentSettingsSection>
  );
};

export default ManualTriggerPanel;
