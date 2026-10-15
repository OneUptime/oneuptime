import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { RunbookTriggersTestIds } from "./RunbookTriggersCopy";

/*
 * A line on a trigger card that says why the trigger starts nothing right
 * now (the runbook is off, it has no steps) or what it is doing (a run is
 * waiting): amber for the first, a quiet grey-blue for the second.
 */
export interface ComponentProps {
  // An English sentence, looked up whole.
  text: string;
  tone: "warning" | "info";
}

const RunbookTriggerNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isWarning: boolean = props.tone === "warning";

  return (
    <div
      className={`flex min-w-0 items-start gap-2 rounded-md border px-3 py-2 text-sm ${
        isWarning
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-indigo-100 bg-indigo-50 text-indigo-700"
      }`}
      data-testid={RunbookTriggersTestIds.note}
      data-tone={props.tone}
    >
      <div className="mt-0.5 shrink-0">
        <Icon
          icon={isWarning ? IconProp.Alert : IconProp.Clock}
          className={`h-4 w-4 ${isWarning ? "text-amber-500" : "text-indigo-500"}`}
        />
      </div>
      <p>{translator.translateText(props.text)}</p>
    </div>
  );
};

export default RunbookTriggerNote;
