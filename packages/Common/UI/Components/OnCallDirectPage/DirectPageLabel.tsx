/*
 * What the on-call logs say of a DIRECT PAGE where a run's policy would be
 * named.
 *
 * A direct page is people paged with no on-call policy behind the page - a
 * workflow's Page Users, Page a Team or Page Whoever Is On Call step. It is
 * kept where an on-call run is, so it is listed with the runs: under the
 * incident or the alert it is about, in On-Call Duty's logs, and in the
 * logs of each person it paged. A list that named the policy of every other
 * row said "No on-call policy." of these, which reads as something that
 * went wrong. This says what the row is, and what started it.
 *
 * The page's colour is the Page steps' own on the workflow canvas.
 */

import IconProp from "../../../Types/Icon/IconProp";
import { translationKey, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export const DIRECT_PAGE_LABEL: string = translationKey("Direct page");

// What the label means, on hover and to a screen reader.
export const DIRECT_PAGE_EXPLANATION: string = translationKey(
  "People were paged directly, with no on-call policy: everybody at once, and no escalation.",
);

// The workflow whose step started the page, by the name it had then.
export const DIRECT_PAGE_WORKFLOW_TEMPLATE: string = translationKey(
  "Workflow: {{workflowName}}",
);

export interface ComponentProps {
  /*
   * The workflow whose step started the page (the run's
   * triggeredByWorkflowName), when a workflow did.
   */
  workflowName?: string | null | undefined;
  /*
   * Who started the page, when a person did, as the page draws people.
   * Shown under the label.
   */
  startedBy?: ReactElement | undefined;
  dataTestId?: string | undefined;
}

const DirectPageLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const dataTestId: string = props.dataTestId || "on-call-direct-page";

  const explanation: string =
    translator.translateText(DIRECT_PAGE_EXPLANATION) ||
    DIRECT_PAGE_EXPLANATION;
  const workflowName: string = (props.workflowName || "").trim();

  return (
    <div data-testid={dataTestId} className="flex flex-col items-start gap-1">
      <span
        title={explanation}
        data-testid={`${dataTestId}-label`}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-pink-50 px-2 py-1 text-xs font-medium text-pink-700 ring-1 ring-inset ring-pink-200"
      >
        <Icon icon={IconProp.Call} className="h-3.5 w-3.5 flex-shrink-0" />
        {translator.translateText(DIRECT_PAGE_LABEL) || DIRECT_PAGE_LABEL}
        <span className="sr-only">{`. ${explanation}`}</span>
      </span>
      {workflowName ? (
        <span
          data-testid={`${dataTestId}-workflow`}
          className="max-w-full break-words text-xs text-gray-500"
        >
          {translator.translateTemplate(DIRECT_PAGE_WORKFLOW_TEMPLATE, {
            workflowName: workflowName,
          })}
        </span>
      ) : (
        <></>
      )}
      {props.startedBy ? (
        <div data-testid={`${dataTestId}-started-by`}>{props.startedBy}</div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default DirectPageLabel;
