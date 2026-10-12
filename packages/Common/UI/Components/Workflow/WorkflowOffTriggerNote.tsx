import Icon from "../Icon/Icon";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import { RUN_WORKFLOW_BUTTON_TITLE } from "./ManualTriggerPanel";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /*
   * What the trigger does while the workflow is off, and that Run Workflow
   * still tests it: one whole sentence of the panel's own copy, with
   * {{button}} where the Run Workflow button is named.
   */
  template: string;
  dataTestId: string;
}

/*
 * In a trigger's dialog while the workflow is turned off, above the URL or
 * address the dialog is opened for. Off pauses the trigger
 * (Types/Workflow/WorkflowEnabled): a request to the Webhook's URL is
 * refused, and an email to the Incoming Email address is ignored - while the
 * panel's own Try it, or its address to copy, would suggest otherwise. So it
 * says so before anyone tries, and points at what does work while the
 * workflow is off: Run Workflow, named as the toolbar names it, in bold.
 *
 * Amber, with the power icon, like the notice above the canvas that it
 * echoes.
 */
const WorkflowOffTriggerNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"
      data-testid={props.dataTestId}
    >
      <div aria-hidden="true" className="mt-0.5 shrink-0 text-amber-600">
        <Icon icon={IconProp.Power} className="h-3.5 w-3.5" />
      </div>
      <p className="min-w-0">
        <TranslatedSentence
          template={props.template}
          slots={{
            button: (
              <strong className="font-semibold text-amber-900">
                {translator.translateText(RUN_WORKFLOW_BUTTON_TITLE)}
              </strong>
            ),
          }}
        />
      </p>
    </div>
  );
};

export default WorkflowOffTriggerNote;
