import RadioButtons from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  DELETE_CHOICE_DESCRIPTIONS,
  DELETE_CHOICE_TITLES,
  DELETE_LINKED_QUESTION,
  DELETE_MOVE_FIRST_HINT,
  DeleteChoice,
  WHAT_STAYS,
} from "./MonitorTemplateChangeModel";

/*
 * WHAT A TEMPLATE'S DELETE LEAVES ON ITS MONITORS, ASKED BEFORE IT (issues
 * #11260, #11266).
 *
 * A deleted template's criteria stayed on its monitors, still checking and
 * still firing, and nothing said so first. The delete's own dialog
 * (ModelDelete) now asks, while monitors are linked to the template:
 *
 *   - keep their settings (the default): the delete unlinks them, and they
 *     go on checking and alerting with the criteria they have;
 *   - clear this template's criteria from them: each is unlinked with its
 *     criteria cleared - what they left open resolved - and the template is
 *     deleted once nothing is linked to it, as a change on the server with
 *     its progress (MonitorTemplateChangeRunner).
 *
 * Either way they keep their names, history, labels, owners and incidents.
 */
export interface ComponentProps {
  templateName: string;
  linkedMonitorCount: number;
  onChange: (choice: DeleteChoice) => void;
}

const MonitorTemplateDeleteChoice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="mt-4 space-y-3 text-start"
      data-testid="monitor-template-delete-choice"
    >
      <p className="text-sm text-gray-600">
        {translator.translatePlural(
          DELETE_LINKED_QUESTION,
          props.linkedMonitorCount,
          {
            count: translator.formatNumber(props.linkedMonitorCount),
            templateName: props.templateName,
          },
        )}
      </p>
      {/*
       * Each time the delete asks, it starts from keeping their settings,
       * and the choice says so to the page as it opens: a clear chosen in a
       * delete that was cancelled is not carried into the next.
       */}
      <RadioButtons
        dataTestId="monitor-template-delete-choice-options"
        initialValue={DeleteChoice.KeepSettings}
        onChange={(value: string) => {
          props.onChange(
            value === DeleteChoice.ClearCriteria
              ? DeleteChoice.ClearCriteria
              : DeleteChoice.KeepSettings,
          );
        }}
        options={[DeleteChoice.KeepSettings, DeleteChoice.ClearCriteria].map(
          (choice: DeleteChoice) => {
            return {
              value: choice,
              title: translator.translateText(
                DELETE_CHOICE_TITLES[choice],
              ) as string,
              description: translator.translateText(
                DELETE_CHOICE_DESCRIPTIONS[choice],
              ) as string,
            };
          },
        )}
      />
      <div className="space-y-1 text-xs text-gray-500">
        <p>
          {translator.translatePlural(WHAT_STAYS, props.linkedMonitorCount)}
        </p>
        <p>{translator.translateText(DELETE_MOVE_FIRST_HINT)}</p>
      </div>
    </div>
  );
};

export default MonitorTemplateDeleteChoice;
