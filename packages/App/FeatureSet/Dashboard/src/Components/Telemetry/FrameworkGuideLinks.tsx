import React, { FunctionComponent, ReactElement } from "react";
import {
  OpenTelemetryGuideEntry,
  TelemetryGuideLanguageGuides,
  TelemetryGuideLanguageKey,
  getGuidesForTelemetryGuideLanguage,
  getOpenTelemetryGuideUrl,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  language: TelemetryGuideLanguageKey;
}

/*
 * The website's step-by-step OpenTelemetry guide for the language a reader
 * picked in the telemetry guide, and one per framework of that language
 * (Common/Types/Telemetry/OpenTelemetryGuides): what is traced on its own,
 * the mistakes people make with that framework, containers, troubleshooting.
 * Nothing for a language with no guide yet. The guides are on
 * oneuptime.com, which self-hosted installations link to as well.
 */
const FrameworkGuideLinks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const guides: TelemetryGuideLanguageGuides | undefined =
    getGuidesForTelemetryGuideLanguage(props.language);

  if (!guides) {
    return <></>;
  }

  const linkTo: (guide: OpenTelemetryGuideEntry) => ReactElement = (
    guide: OpenTelemetryGuideEntry,
  ): ReactElement => {
    return (
      <a
        key={guide.slug}
        href={getOpenTelemetryGuideUrl(guide.slug)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:text-indigo-500 hover:decoration-indigo-400"
      >
        {guide.name}
      </a>
    );
  };

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm"
      data-testid="telemetry-framework-guides"
    >
      <span className="inline-flex items-center gap-1.5 text-gray-500">
        <Icon icon={IconProp.BookOpen} className="h-4 w-4 text-gray-400" />
        {translator.translateText("Step-by-step guide")}
      </span>
      {linkTo(guides.languageGuide)}
      {guides.frameworkGuides.length > 0 && (
        <>
          <span className="text-gray-300" aria-hidden="true">
            ·
          </span>
          <span className="text-gray-500">
            {translator.translateText("For your framework")}
          </span>
          {guides.frameworkGuides.map(linkTo)}
        </>
      )}
    </div>
  );
};

export default FrameworkGuideLinks;
