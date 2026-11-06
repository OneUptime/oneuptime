import { SubscriberFormCopy } from "./SubscriberFormChoices";
import {
  getStatusPageLanguageLabelOfCode,
  getStatusPageLanguageNativeName,
} from "./StatusPageLanguageOptions";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import { DEFAULT_STATUS_PAGE_LANGUAGE } from "Common/Types/StatusPage/StatusPageLanguage";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Column from "Common/UI/Components/ModelTable/Column";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A SUBSCRIBER'S LANGUAGE, ON THE EMAIL, SMS, SLACK AND MICROSOFT TEAMS
 * SUBSCRIBER LISTS.
 *
 * Each subscriber is written to in their own language, else in the status
 * page's default language (Common/Server/Utils/StatusPage/
 * SubscriberLanguage): a visitor who read the page in another language
 * when they subscribed keeps it, and the team can set or clear one under
 * More fields (getSubscriberLanguageField). The list says which: the
 * subscriber's own language by name ("Deutsch (German)"), or "Page default
 * (Deutsch)", quieter, for one who follows the page - so a change of the
 * page's default language is seen to move them with it.
 */

// The page's default language as a status page has it: English for none.
const getPageLanguage: (pageLanguage: string | null | undefined) => string = (
  pageLanguage: string | null | undefined,
): string => {
  return pageLanguage || DEFAULT_STATUS_PAGE_LANGUAGE;
};

/*
 * "Page default (Deutsch)": what an empty language reads as, in the field
 * and in the list.
 */
export const getSubscriberPageDefaultLanguageText: (
  translator: Translator,
  pageLanguage: string | null | undefined,
) => string = (
  translator: Translator,
  pageLanguage: string | null | undefined,
): string => {
  return translator.translateTemplate(SubscriberFormCopy.pageDefaultLanguage, {
    language: getStatusPageLanguageNativeName(getPageLanguage(pageLanguage)),
  });
};

/*
 * A subscriber's language as text, for the list's export: their own by
 * name, or the page's default.
 */
export const getSubscriberLanguageText: (data: {
  translator: Translator;
  language: string | null | undefined;
  pageLanguage: string | null | undefined;
}) => string = (data: {
  translator: Translator;
  language: string | null | undefined;
  pageLanguage: string | null | undefined;
}): string => {
  return data.language
    ? getStatusPageLanguageLabelOfCode(data.language)
    : getSubscriberPageDefaultLanguageText(data.translator, data.pageLanguage);
};

export interface SubscriberLanguageCellProps {
  language: string | null | undefined;
  pageLanguage: string | null | undefined;
}

// A list's Language cell.
export const SubscriberLanguageCell: FunctionComponent<
  SubscriberLanguageCellProps
> = (props: SubscriberLanguageCellProps): ReactElement => {
  if (props.language) {
    return (
      <IsolatedText
        text={getStatusPageLanguageLabelOfCode(props.language)}
        dataTestId="subscriber-language-own"
      />
    );
  }

  return (
    <span className="text-gray-500" data-testid="subscriber-language-default">
      <TranslatedSentence
        template={SubscriberFormCopy.pageDefaultLanguage}
        slots={{
          language: (
            <IsolatedText
              text={getStatusPageLanguageNativeName(
                getPageLanguage(props.pageLanguage),
              )}
            />
          ),
        }}
      />
    </span>
  );
};

/*
 * The lists' Language column, after Status. On a phone's cards it is left
 * out, as Subscribed At is: it matters less than who and whether.
 */
export const getSubscriberLanguageColumn: (data: {
  translator: Translator;
  pageLanguage: string | null | undefined;
}) => Column<StatusPageSubscriber> = (data: {
  translator: Translator;
  pageLanguage: string | null | undefined;
}): Column<StatusPageSubscriber> => {
  return {
    field: {
      language: true,
    },
    title: SubscriberFormCopy.languageTitle,
    type: FieldType.Text,
    hideOnMobile: true,
    getElement: (item: StatusPageSubscriber): ReactElement => {
      return (
        <SubscriberLanguageCell
          language={item.language}
          pageLanguage={data.pageLanguage}
        />
      );
    },
    getExportValue: (item: StatusPageSubscriber): string => {
      return getSubscriberLanguageText({
        translator: data.translator,
        language: item.language,
        pageLanguage: data.pageLanguage,
      });
    },
  };
};
