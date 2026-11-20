import { AskAiAnswerPageLink, getAnswerPageLinks } from "./AskAiPageLinks";
import { navigateToCitationTarget } from "./CitationTargetNav";
import useProjectProducts from "../../Utils/ProjectProducts/UseProjectProducts";
import { getProductsOfPath } from "../../Utils/ProjectProducts/ProductOfRoute";
import { ProjectProductsState } from "../../Utils/ProjectProducts/ProjectProductsStore";
import { AIChatCitation } from "Common/Types/AI/AIChatTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ProductKey from "Common/Types/Product/ProductKey";
import { ServerProductsOff } from "Common/Types/Product/ServerProducts";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
  citations: Array<AIChatCitation>;
}

/*
 * The links of an answer that open: none of a product switched off on the
 * server (#6815), whose page would only say it is off - an answer written
 * before the product was switched off keeps its words, not its button.
 */
export const getOpenablePageLinks: (data: {
  links: Array<AskAiAnswerPageLink>;
  offOnServer: ServerProductsOff;
}) => Array<AskAiAnswerPageLink> = (data: {
  links: Array<AskAiAnswerPageLink>;
  offOnServer: ServerProductsOff;
}): Array<AskAiAnswerPageLink> => {
  return data.links.filter((link: AskAiAnswerPageLink): boolean => {
    const path: string = String(link.target.params?.["path"] || "");

    return getProductsOfPath(path.split(/[?#]/)[0] || "").every(
      (product: ProductKey): boolean => {
        return !data.offOnServer[product];
      },
    );
  });
};

/*
 * "Go to Notification Methods": the pages of this project an answer to
 * "how do I...?" sends the reader to, as buttons under it (issue #6828).
 * Only pages the answer cites, each a route of the Dashboard's own
 * (AskAiPageLinks). Named as Search names them, in the reader's language:
 * by the page's own key, so an explorer's Insights tab reads the tab's
 * word ("Análisis"), not OneUptime AI's findings' ("Hallazgos", #8817).
 * A page of one record (#7065) says whose it is beside its name: "Go to
 * Custom Domains · Acme Status".
 */
const AskAiPageButtons: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const products: ProjectProductsState = useProjectProducts();
  const links: Array<AskAiAnswerPageLink> = getOpenablePageLinks({
    links: getAnswerPageLinks(props.text, props.citations),
    offOnServer: products.answer.offOnServer || {},
  });

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
            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span className="min-w-0 truncate">
              {translator.translateTemplate("Go to {{page}}", {
                // A template's values are another product's name, as written (#8834).
                page: link.titleValues
                  ? translator.translateTemplate(
                      link.titleKey,
                      link.titleValues,
                    )
                  : translator.translateText(link.titleKey) || link.title,
              })}
              {link.recordTitle ? (
                <>
                  <InlineSeparator />
                  {/*
                   * The record's name as it was written, read its own
                   * way: an English name on a Persian page.
                   */}
                  <bdi
                    data-testid="ask-ai-page-button-record"
                    className="font-normal text-indigo-600"
                  >
                    {link.recordTitle}
                  </bdi>
                </>
              ) : (
                <></>
              )}
            </span>
            <Icon
              icon={IconProp.ArrowRight}
              className="h-3.5 w-3.5 flex-shrink-0"
            />
          </button>
        );
      })}
    </div>
  );
};

export default AskAiPageButtons;
