import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  Translator,
  getTemplatePlaceholders,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  RunbookTriggersCopy,
  RunbookTriggersTestIds,
  translateCopy,
} from "./RunbookTriggersCopy";

/*
 * A line on a trigger card that says why the trigger starts nothing right
 * now (the runbook is off, it has no steps) or what it is doing (a run is
 * waiting): amber for the first, a quiet grey-blue for the second.
 *
 * Where the sentence says where to fix it - {{settings}}, {{steps}} - that
 * place is a link to the runbook's own page, so the next step is one click
 * away (Settings sits in a folded section of the runbook's menu).
 */
export interface ComponentProps {
  // An English sentence, looked up whole.
  text: string;
  tone: "warning" | "info";
  // The runbook whose pages {{settings}} and {{steps}} link to.
  runbookId?: ObjectID | undefined;
}

// The pages a note can send someone to, by the placeholder that names them.
const NOTE_PAGES: Readonly<Record<string, { page: PageMap; name: string }>> = {
  settings: {
    page: PageMap.RUNBOOK_VIEW_SETTINGS,
    name: RunbookTriggersCopy.settingsPage,
  },
  steps: {
    page: PageMap.RUNBOOK_VIEW_STEPS,
    name: RunbookTriggersCopy.stepsPage,
  },
};

const RunbookTriggerNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isWarning: boolean = props.tone === "warning";

  const getText: () => ReactNode = (): ReactNode => {
    const placeholders: Array<string> = getTemplatePlaceholders(props.text);

    if (!props.runbookId || placeholders.length === 0) {
      return translator.translateText(props.text);
    }

    const slots: Record<string, ReactNode> = {};

    for (const placeholder of placeholders) {
      const target: { page: PageMap; name: string } | undefined =
        NOTE_PAGES[placeholder];

      if (!target) {
        return translator.translateText(props.text);
      }

      slots[placeholder] = (
        <AppLink
          className="font-medium underline underline-offset-2 hover:opacity-80"
          to={RouteUtil.populateRouteParams(RouteMap[target.page] as Route, {
            modelId: props.runbookId,
          })}
        >
          {translateCopy(translator, target.name)}
        </AppLink>
      );
    }

    return <TranslatedSentence template={props.text} slots={slots} />;
  };

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
      <p>{getText()}</p>
    </div>
  );
};

export default RunbookTriggerNote;
