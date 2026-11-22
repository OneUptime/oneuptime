import { NO_EVENTS_BUT_REFUSED } from "./RefusedTelemetryCopy";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The line under "No security events" over a time range in which an
 * ingestion budget or rate refused some of the logs or traces Security
 * Events reads (#10431): events from then are missing, so "none" is not
 * "nothing happened". The events list's and Correlate's.
 */

export interface ComponentProps {
  dataTestId: string;
}

const RefusedTelemetryRangeNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <p
      className="flex items-start justify-center gap-1.5 text-sm text-amber-800"
      data-testid={props.dataTestId}
    >
      <Icon
        icon={IconProp.SignalSlash}
        className="mt-0.5 h-4 w-4 flex-none text-amber-600"
      />
      <span className="text-pretty">
        {translator.translateText(NO_EVENTS_BUT_REFUSED) ||
          NO_EVENTS_BUT_REFUSED}
      </span>
    </p>
  );
};

export default RefusedTelemetryRangeNote;
