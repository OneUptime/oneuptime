import OneUptimeDate from "Common/Types/Date";
import { isEnglishDateLanguage } from "Common/Types/DateLanguage";
import { useSentenceLanguage } from "Common/UI/Utils/SentenceLanguage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  EventDurationPart,
  LESS_THAN_A_MINUTE,
  TABLE_DURATION_MAX_UNITS,
  formatEventDurationParts,
  getEventDurationParts,
} from "../../Utils/EventDuration";

export interface ComponentProps {
  startDate: Date;
  endDate?: Date | undefined; // when undefined, ticks live against "now".
  /*
   * A table's Duration column: the two largest units ("10 days, 23
   * hours"), the whole duration under the pointer.
   */
  isCompact?: boolean | undefined;
}

const LiveDuration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * The reader's language; inside a sentence, the sentence's, so an
   * English one ("for {{duration}}") never holds "10 Tage".
   */
  const language: string = useSentenceLanguage() ?? translator.language;
  const [now, setNow] = useState<Date>(OneUptimeDate.getCurrentDate());

  useEffect(() => {
    if (props.endDate) {
      return () => {};
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(OneUptimeDate.getCurrentDate());
    }, 30 * 1000);

    return () => {
      clearInterval(interval);
    };
  }, [props.endDate]);

  const endDate: Date = props.endDate || now;

  /*
   * In the reader's language: "10 Tage, 23 Stunden", "10 jours et 23
   * heures" - a German or French list read "10 days, 23 hours".
   */
  const getText: (maxUnits?: number | undefined) => string = (
    maxUnits?: number | undefined,
  ): string => {
    const parts: Array<EventDurationPart> = getEventDurationParts(
      props.startDate,
      endDate,
      maxUnits ? { maxUnits: maxUnits } : undefined,
    );

    if (parts.length === 0) {
      return isEnglishDateLanguage(language)
        ? LESS_THAN_A_MINUTE
        : translator.translateText(LESS_THAN_A_MINUTE) || LESS_THAN_A_MINUTE;
    }

    return formatEventDurationParts(parts, language);
  };

  const text: string = getText();

  if (props.isCompact) {
    const compactText: string = getText(TABLE_DURATION_MAX_UNITS);

    return (
      <span
        title={compactText === text ? undefined : text}
        data-testid="live-duration"
      >
        {compactText}
      </span>
    );
  }

  return <span>{text}</span>;
};

export default LiveDuration;
