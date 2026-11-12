import { AskAiAnswerPageLink, getAnswerPageLinks } from "./AskAiPageLinks";
import { navigateToCitationTarget } from "./CitationTargetNav";
import { AIChatCitation } from "Common/Types/AI/AIChatTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
  citations: Array<AIChatCitation>;
}

/*
 * "Go to Notification Methods": the pages of this project an answer to
 * "how do I...?" sends the reader to, as buttons under it (issue #6828).
 * Only pages the answer cites, each a route of the Dashboard's own
 * (AskAiPageLinks). Named as Search names them, in the reader's language.
 */
const AskAiPageButtons: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const links: Array<AskAiAnswerPageLink> = getAnswerPageLinks(
    props.text,
    props.citations,
  );

  if (links.length === 0) {
    return <></>;
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid="ask-ai-page-buttons">
      {links.map((link: AskAiAnswerPageLink): ReactElement => {
        return (
          <button
            key={link.citationId}
            type="button"
            data-citation-id={link.citationId}
            onClick={() => {
              navigateToCitationTarget(link.target);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span>
              {translator.translateTemplate("Go to {{page}}", {
                page: translator.translateText(link.title) || link.title,
              })}
            </span>
            <Icon
              icon={IconProp.ArrowRight}
              className="h-3.5 w-3.5 flex-shrink-0 rtl:rotate-180"
            />
          </button>
        );
      })}
    </div>
  );
};

export default AskAiPageButtons;
