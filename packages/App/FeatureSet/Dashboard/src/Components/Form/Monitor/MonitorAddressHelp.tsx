import URL from "Common/Types/API/URL";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Link from "Common/UI/Components/Link/Link";
import TinyFormDocumentation from "Common/UI/Components/TinyFormDocumentation/TinyFormDocumentation";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { DOCS_URL } from "Common/UI/Config";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE FOLD UNDER A WEBSITE OR API ADDRESS: a value that changes on every
 * check, put in the address to get past a cache - {{timestamp}} and
 * {{random}}. Few people need it, so it stays folded, named for what it is
 * for: it was "URL placeholder help", a word for people who write templates
 * that said nothing of why anyone would open it (#7463).
 */
export const MONITOR_ADDRESS_HELP_TITLE: string = translationKey(
  "Bypass caches on every check",
);

export interface ComponentProps {
  monitorType: MonitorType;
}

// Whether a monitor type's address takes the fold: a Website's or an API's.
export function hasMonitorAddressHelp(monitorType: MonitorType): boolean {
  return monitorType === MonitorType.Website || monitorType === MonitorType.API;
}

const MonitorAddressHelp: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!hasMonitorAddressHelp(props.monitorType)) {
    return <></>;
  }

  return (
    <TinyFormDocumentation title={MONITOR_ADDRESS_HELP_TITLE}>
      <>
        <div>
          <TranslatedSentence
            template="{{placeholder}} — replaced with current Unix timestamp"
            slots={{
              placeholder: (
                <code className="bg-gray-100 px-1 rounded">
                  {"{{timestamp}}"}
                </code>
              ),
            }}
          />
        </div>
        <div>
          <TranslatedSentence
            template="{{placeholder}} — replaced with a random unique string"
            slots={{
              placeholder: (
                <code className="bg-gray-100 px-1 rounded">{"{{random}}"}</code>
              ),
            }}
          />
        </div>
        <div>
          <TranslatedSentence
            template="Example: {{url}}"
            slots={{
              url: (
                <code className="bg-gray-100 px-1 rounded" dir="ltr">
                  {"https://example.com?cb={{timestamp}}"}
                </code>
              ),
            }}
          />
        </div>
        <div>
          {translator.translateText(
            "Useful for busting CDN or proxy caches on each check.",
          )}{" "}
          <Link
            className="underline"
            openInNewTab={true}
            to={URL.fromString(
              DOCS_URL.toString() +
                (props.monitorType === MonitorType.API
                  ? "/monitor/api-monitor"
                  : "/monitor/website-monitor"),
            )}
          >
            {translator.translateText("Learn more.")}
          </Link>
        </div>
      </>
    </TinyFormDocumentation>
  );
};

export default MonitorAddressHelp;
