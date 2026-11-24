import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AIChatUnavailableReason, {
  AIChatUnavailableCopy,
  getAIChatUnavailableCopy,
} from "./AIChatAvailability";
import AskAiDocsResults from "./AskAiDocsResults";
import Route from "Common/Types/API/Route";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  reason: AIChatUnavailableReason;
  /*
   * The question Ask AI was opened with - from Search, a page's "Ask AI",
   * a guided setup's Describe it instead - looked up in the docs at once
   * (#7063). Empty when it was opened with none.
   */
  question?: string | undefined;
}

/*
 * What Ask AI shows INSTEAD of the composer when AI is switched off for the
 * project.
 *
 * Ask AI used to look completely ready in this state: the hero invited a
 * question, the suggested prompts were clickable, and the only sign that AI
 * was off arrived as a red error banner after the user had already written
 * something. This view replaces the whole surface, so the answer to "why did
 * nothing happen?" is on screen before the question is asked — and it names
 * the settings page that owns the switch, because the person who hits this is
 * usually not the person who flipped it.
 *
 * And it still helps (#7063): first the docs, searched for the question
 * Ask AI was opened with or one typed here, then why Ask AI is not
 * answering and what turns it on.
 */
const AIChatUnavailableView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copy: AIChatUnavailableCopy = getAIChatUnavailableCopy(props.reason);
  // In the reader's language: the copy is English text keys.
  const translator: Translator = useTranslator();

  const actionRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[copy.actionPage as PageMap] as Route,
  );

  return (
    <div
      className="flex min-h-full w-full flex-1 flex-col items-center justify-center px-6 py-12"
      data-testid="ask-ai-unavailable"
    >
      <div className="w-full max-w-md">
        <AskAiDocsResults
          question={props.question || ""}
          isInPlaceOfAskAi={true}
        />
      </div>

      <div
        className="mt-8 flex w-full max-w-md flex-col items-center border-t border-gray-100 pt-8 text-center"
        role="status"
        data-testid="ask-ai-unavailable-reason"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
          <Icon icon={copy.icon} className="h-5 w-5 text-gray-400" />
        </div>

        <h3 className="mt-4 text-base font-semibold tracking-tight text-gray-900">
          {translator.translateText(copy.title)}
        </h3>

        <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-500">
          {translator.translateText(copy.description)}
        </p>

        <Link
          to={actionRoute}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        >
          <Icon icon={copy.actionIcon} className="h-4 w-4" />
          <span>{translator.translateText(copy.actionLabel)}</span>
        </Link>
      </div>
    </div>
  );
};

export default AIChatUnavailableView;
