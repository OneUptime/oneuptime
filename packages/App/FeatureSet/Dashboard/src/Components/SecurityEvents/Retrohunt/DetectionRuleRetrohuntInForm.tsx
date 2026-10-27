import {
  CLOSE_RUN_ON_PAST_EVENTS,
  NEEDS_RULE,
  RETROHUNT_TEST_IDS,
  RUN_ON_PAST_EVENTS,
  RUN_ON_PAST_EVENTS_DESCRIPTION,
} from "./RetrohuntCopy";
import {
  RetrohuntRuleInput,
  buildRetrohuntRequest,
  canRunRetrohunt,
} from "./RetrohuntModel";
import DetectionRuleRetrohuntPanel from "./DetectionRuleRetrohuntPanel";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  // The rule as the form holds it now, and the saved rule's id on an edit.
  rule: RetrohuntRuleInput;
}

/*
 * RUN ON PAST EVENTS under the Detection Rules form's YAML: the rule as it
 * stands in the form - new, or changed and not saved yet - run over past
 * events, with the saved rule's exceptions on an edit. One quiet button
 * beside Draft with AI until it is wanted; open, the answer, with an x to
 * put it away. Nothing is saved by running.
 */
const DetectionRuleRetrohuntInForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const canRun: boolean = canRunRetrohunt(props.rule);

  if (!isOpen) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          data-testid={RETROHUNT_TEST_IDS.open}
          disabled={!canRun}
          title={
            canRun ? undefined : translator.translateText(NEEDS_RULE) || ""
          }
          onClick={() => {
            setIsOpen(true);
          }}
          className="-ml-2.5 inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <Icon icon={IconProp.Backward} className="h-4 w-4 text-indigo-500" />
          <span>{translator.translateText(RUN_ON_PAST_EVENTS)}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
      <div className="flex items-start justify-between gap-3">
        {/* The mark beside the title, not in it: Icon draws a div. */}
        <div className="flex min-w-0 items-start gap-1.5">
          <Icon
            icon={IconProp.Backward}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">
              {translator.translateText(RUN_ON_PAST_EVENTS)}
            </p>
            <p className="text-xs text-gray-500">
              {translator.translateText(RUN_ON_PAST_EVENTS_DESCRIPTION)}
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label={translator.translateText(CLOSE_RUN_ON_PAST_EVENTS)}
          title={translator.translateText(CLOSE_RUN_ON_PAST_EVENTS)}
          onClick={() => {
            setIsOpen(false);
          }}
          data-testid={RETROHUNT_TEST_IDS.close}
          className="-my-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon icon={IconProp.Close} className="h-4 w-4" />
        </button>
      </div>
      <DetectionRuleRetrohuntPanel
        getRequest={(periodInHours: number): JSONObject => {
          return buildRetrohuntRequest(props.rule, periodInHours);
        }}
      />
    </div>
  );
};

export default DetectionRuleRetrohuntInForm;
