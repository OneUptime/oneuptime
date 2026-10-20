import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import StatusPageTheme from "Common/Types/StatusPage/StatusPageTheme";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PublicPageThemeCard from "../PublicPageTheme/PublicPageThemeCard";
import StatusPageThemeCopy, {
  STATUS_PAGE_THEME_CARD_TEST_ID,
  STATUS_PAGE_THEME_CHOICES,
  STATUS_PAGE_THEME_CUSTOM_CODE_NOTE_TEST_ID,
  StatusPageThemeNotePart,
  getStatusPageThemeNoteParts,
  hasStatusPageCustomCode,
} from "./StatusPageThemeCopy";
import StatusPageThemePreview from "./StatusPageThemePreview";

/*
 * Theme, on a status page's Branding page: Light, Dark, or as each
 * visitor's device is set - one choice of three (StatusPageThemeCopy), each
 * beside a small picture of the page in it (StatusPageThemePreview).
 *
 * The card is every public page's Theme card (PublicPageThemeCard): a pick
 * saves at once and says "Saved", a refused one goes back with the reason,
 * and someone who may not edit the page sees the choices locked. What is
 * the status page's own: a page with custom CSS or header / footer HTML is
 * told, under the choices, that its code applies in both themes and how to
 * style the dark one - the code was written for the light page.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

// Under the choices, for a page whose custom code is drawn on it.
const CustomCodeNote: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <p
      className="border-t border-gray-200 px-5 py-3 text-sm text-gray-500 md:px-6"
      data-testid={STATUS_PAGE_THEME_CUSTOM_CODE_NOTE_TEST_ID}
    >
      {/* The CSS prefix it names is drawn as code, in every language. */}
      {getStatusPageThemeNoteParts(
        translator.translateText(StatusPageThemeCopy.customCodeNote) ||
          StatusPageThemeCopy.customCodeNote,
      ).map((part: StatusPageThemeNotePart, index: number): ReactElement => {
        return part.isCode ? (
          <code
            key={index}
            className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-700"
          >
            {part.text}
          </code>
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        );
      })}
    </p>
  );
};

const StatusPageThemeCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <PublicPageThemeCard<StatusPage>
      modelType={StatusPage}
      modelId={props.statusPageId}
      select={{
        theme: true,
        customCSS: true,
        headerHTML: true,
        footerHTML: true,
      }}
      copy={StatusPageThemeCopy}
      choices={STATUS_PAGE_THEME_CHOICES}
      renderPreview={(
        theme: StatusPageTheme,
        isSelected: boolean,
      ): ReactElement => {
        return <StatusPageThemePreview theme={theme} isSelected={isSelected} />;
      }}
      getNote={(page: StatusPage): ReactElement | null => {
        return hasStatusPageCustomCode(page) ? <CustomCodeNote /> : null;
      }}
      testId={STATUS_PAGE_THEME_CARD_TEST_ID}
    />
  );
};

export default StatusPageThemeCard;
