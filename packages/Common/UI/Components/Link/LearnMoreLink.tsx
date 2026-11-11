import IconProp from "../../../Types/Icon/IconProp";
import { getDocsPageUrl } from "../../Utils/Glossary";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Learn more": one small link from a hard form - a monitor's criteria, an
 * on-call policy's escalation rules, a schedule's layers - to the docs page
 * that explains it, in a new tab, on this OneUptime instance and in the
 * language the reader picked when the docs have it.
 *
 * The page is written as the docs address it, "/docs/on-call/escalation-rules"
 * (an anchor may follow), so the docs suite DocsLinksResolve reads it in the
 * source and fails when the page or the heading goes away.
 */

export interface ComponentProps {
  // The docs page, as "/docs/<category>/<page>" with an optional "#anchor".
  docsPath: string;
  dataTestId?: string | undefined;
  className?: string | undefined;
}

export const LEARN_MORE_TEXT: string = translationKey("Learn more");

export const LEARN_MORE_LINK_TEST_ID: string = "learn-more-link";

export const LEARN_MORE_LINK_CLASS_NAME: string =
  "inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap text-sm font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:underline";

// The docs page in the reader's language, from its English address.
export const getLearnMoreUrl: (
  docsPath: string,
  language?: string | undefined,
) => string = (docsPath: string, language?: string | undefined): string => {
  return getDocsPageUrl(docsPath.replace(/^\/docs\//, ""), language);
};

const LearnMoreLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <a
      href={getLearnMoreUrl(props.docsPath, translator.language)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={props.dataTestId || LEARN_MORE_LINK_TEST_ID}
      className={`${LEARN_MORE_LINK_CLASS_NAME} ${props.className || ""}`}
    >
      {translator.translateText(LEARN_MORE_TEXT)}
      <Icon
        icon={IconProp.ExternalLink}
        className="h-3.5 w-3.5 flex-shrink-0"
      />
    </a>
  );
};

export default LearnMoreLink;
