import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { DashboardPageContext } from "./PageContext";

export interface ComponentProps {
  context: DashboardPageContext;
  isAttached: boolean;
  onAttach: () => void;
  onDetach: () => void;
}

/*
 * The composer's page-context pill: the page Ask AI was opened from, kept
 * in view as what the question is about. Attached, it says so ("This
 * incident · INC-42 Payment API down") with a remove button; removed, Ask AI
 * answers about the whole project, and the pill becomes a quiet way to
 * bring the page back ("+ This incident"), so a misclick is never final.
 * Both read the page's own words ("This incident", "Logs"), worded whole
 * in each language - never a noun put into a sentence that has to agree
 * with it.
 */
const PageContextChip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { context } = props;
  const chipLabel: string = translator.translateText(
    context.chipLabel,
  ) as string;

  if (!props.isAttached) {
    return (
      <button
        type="button"
        title={translator.translateText(
          "Attach this page as context for your questions",
        )}
        data-testid="ai-chat-context-attach"
        onClick={props.onAttach}
        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Icon icon={IconProp.Add} className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{chipLabel}</span>
      </button>
    );
  }

  /*
   * The record's title as it was written, isolated so it reads its own
   * way: an English title on a Persian page keeps its "INC-42" at its start.
   */
  return (
    <div
      title={translator.translateText(
        "Your questions will use this page as context",
      )}
      data-testid="ai-chat-context"
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-indigo-50 py-1 pe-1 ps-2 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-100"
    >
      <Icon
        icon={context.icon}
        className="h-3.5 w-3.5 flex-shrink-0 text-indigo-500"
      />
      <span className="truncate">
        {chipLabel}
        {context.entityTitle ? (
          <>
            {" · "}
            <bdi>{context.entityTitle}</bdi>
          </>
        ) : (
          <></>
        )}
      </span>
      <button
        type="button"
        title={translator.translateText("Remove page context")}
        aria-label={translator.translateText("Remove page context")}
        onClick={props.onDetach}
        className="flex-shrink-0 rounded-md p-0.5 text-indigo-500 transition-colors hover:bg-indigo-100 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Icon icon={IconProp.Close} className="h-3 w-3" />
      </button>
    </div>
  );
};

export default PageContextChip;
