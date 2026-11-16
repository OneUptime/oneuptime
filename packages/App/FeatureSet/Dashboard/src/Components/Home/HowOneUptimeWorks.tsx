import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  CORE_CONCEPTS_DOCS_PAGE,
  GLOSSARY_INDEX_DOCS_PAGE,
  getDocsPageUrl,
} from "Common/UI/Utils/Glossary";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * HOW ONEUPTIME WORKS: ITS NAME, THE TWO WORDS IT DEFINES, AND ITS DOCS.
 *
 * OneUptime ships dozens of products, and a new user cannot tell which of
 * them they need or how they relate. One dialog answers that, from any page
 * and however old the project (HowOneUptimeWorksDialog): the four steps a
 * problem moves through, with the products that do each, then every
 * product, by category (HowOneUptimeWorksOverview, #8891). Help, Search,
 * Explore OneUptime on Home and a new project's Welcome checklist open it.
 *
 * The checklist used to draw a strip of its own from here - four numbered
 * products, what fed them, and a footnote - an older, shorter shape of the
 * same story. A newcomer met both, so the checklist opens the dialog now
 * (#8995), and what is left here is what the dialog and Home share: the
 * name, the two words Detect defines, and the docs that explain it all.
 *
 * Strings are English literals looked up as flat keys in the locale files
 * (useTranslateValue), the same convention the rest of the dashboard uses.
 */

export const HOW_IT_WORKS_TITLE: string = "How OneUptime works";

/*
 * The two words Detect's sentence defines (telemetry, infrastructure): what
 * they are is the Glossary's to say. The words the dashboard already names
 * them by (the Products menu's Infrastructure; French writes it as English
 * does).
 */
export const FEEDS_TELEMETRY_TEXT: string = "Telemetry";

export const FEEDS_INFRASTRUCTURE_TEXT: string = "Infrastructure";

/*
 * The docs pages that explain it all, in the reader's language, by the
 * titles those pages have there.
 */
export const HOW_IT_WORKS_CORE_CONCEPTS: string =
  translationKey("Core Concepts");

export const HOW_IT_WORKS_GLOSSARY: string = translationKey("Glossary");

export const DOCS_LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:underline";

export const HOW_ONEUPTIME_WORKS_DOCS_TEST_ID: string =
  "how-oneuptime-works-docs";

export interface DocsLinksProps {
  // Size and spacing where they are drawn.
  className?: string | undefined;
}

/*
 * Core Concepts and the Glossary, in a new tab, in the reader's language
 * where the docs have it, under the dialog's overview.
 */
export const HowOneUptimeWorksDocsLinks: FunctionComponent<DocsLinksProps> = (
  props: DocsLinksProps,
): ReactElement => {
  const { translateString, language } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  const docsLinks: Array<{ key: string; text: string; url: string }> = [
    {
      key: "core-concepts",
      text: HOW_IT_WORKS_CORE_CONCEPTS,
      url: getDocsPageUrl(CORE_CONCEPTS_DOCS_PAGE, language),
    },
    {
      key: "glossary",
      text: HOW_IT_WORKS_GLOSSARY,
      url: getDocsPageUrl(GLOSSARY_INDEX_DOCS_PAGE, language),
    },
  ];

  return (
    <div
      className={`flex flex-wrap gap-x-4 gap-y-1 ${props.className || ""}`}
      data-testid={HOW_ONEUPTIME_WORKS_DOCS_TEST_ID}
    >
      {docsLinks.map(
        (link: { key: string; text: string; url: string }): ReactElement => {
          return (
            <a
              key={link.key}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`${HOW_ONEUPTIME_WORKS_DOCS_TEST_ID}-${link.key}`}
              className={DOCS_LINK_CLASS_NAME}
            >
              {tx(link.text)}
              <Icon
                icon={IconProp.ExternalLink}
                className="h-3.5 w-3.5 flex-shrink-0"
              />
            </a>
          );
        },
      )}
    </div>
  );
};
