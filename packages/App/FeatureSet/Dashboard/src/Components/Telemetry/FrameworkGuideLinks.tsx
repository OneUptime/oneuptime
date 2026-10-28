import React, { FunctionComponent, ReactElement, useId } from "react";
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
import { isProductRenamed } from "Common/UI/Utils/ProductBranding";

export interface ComponentProps {
  language: TelemetryGuideLanguageKey;
}

/*
 * The website's step-by-step OpenTelemetry guide for the language a reader
 * picked in the telemetry guide, and one per framework of that language
 * (Common/Types/Telemetry/OpenTelemetryGuides): what is traced on its own,
 * the mistakes people make with that framework, containers, troubleshooting.
 * Nothing for a language with no guide yet. The guides are on
 * oneuptime.com, which self-hosted installations link to as well - except
 * one that goes by a name of its own (ProductBranding): it does not send
 * people to OneUptime's pages, as its footer does not.
 *
 * One line under the language buttons: a label, then the guides as a list
 * of links with a dot between them - the language's own guide first, then
 * its frameworks' - so the reader scans it for their framework at a glance.
 * Each opens in a new tab, which a screen reader hears after its name.
 */
const FrameworkGuideLinks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const newTabNoteId: string = `telemetry-guides-new-tab-${useId().replace(
    /:/g,
    "",
  )}`;
  const guides: TelemetryGuideLanguageGuides | undefined =
    getGuidesForTelemetryGuideLanguage(props.language);

  if (!guides || isProductRenamed()) {
    return <></>;
  }

  const links: Array<OpenTelemetryGuideEntry> = [
    guides.languageGuide,
    ...guides.frameworkGuides,
  ];

  return (
    <div
      className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
      data-testid="telemetry-framework-guides"
    >
      <span className="inline-flex items-center gap-1.5 self-center text-gray-500">
        <Icon icon={IconProp.Book} className="h-4 w-4 text-gray-400" />
        {links.length > 1
          ? translator.translateText("Step-by-step guides")
          : translator.translateText("Step-by-step guide")}
      </span>
      <ul role="list" className="flex flex-wrap items-baseline gap-y-1">
        {links.map(
          (guide: OpenTelemetryGuideEntry, index: number): ReactElement => {
            return (
              <li key={guide.slug} className="inline-flex items-baseline">
                <a
                  href={getOpenTelemetryGuideUrl(guide.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-describedby={newTabNoteId}
                  className="rounded font-medium text-indigo-600 hover:text-indigo-500 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {guide.name}
                </a>
                {index < links.length - 1 && (
                  <span className="px-1.5 text-gray-300" aria-hidden="true">
                    &middot;
                  </span>
                )}
              </li>
            );
          },
        )}
      </ul>
      <span id={newTabNoteId} className="sr-only">
        {translator.translateText("(opens in a new tab)")}
      </span>
    </div>
  );
};

export default FrameworkGuideLinks;
