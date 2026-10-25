import OneUptimeDate from "Common/Types/Date";
import { useWriteDatesInSentenceLanguage } from "Common/UI/Utils/SentenceLanguage";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  date: Date;
  className?: string | undefined;
}

// Relative labels ("5 minutes ago") are coarse, so a minute is plenty.
export const RELATIVE_TIME_REFRESH_INTERVAL_IN_MS: number = 60 * 1000;

/*
 * "5 minutes ago", with the exact local date and time on hover and in the
 * machine readable dateTime attribute. It re-renders once a minute so a page
 * left open does not keep saying "a few seconds ago".
 *
 * In the reader's language ("vor 5 Minuten"); inside a sentence, in the
 * sentence's - English while the reader's language has not worded it.
 */
const RelativeTime: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const writeDates: <T>(write: () => T) => T =
    useWriteDatesInSentenceLanguage();
  const [, setTick] = useState<number>(0);

  useEffect(() => {
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      setTick((tick: number): number => {
        return tick + 1;
      });
    }, RELATIVE_TIME_REFRESH_INTERVAL_IN_MS);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const date: Date = OneUptimeDate.fromString(props.date);

  return (
    <time
      dateTime={date.toISOString()}
      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date)}
      className={props.className}
    >
      {writeDates((): string => {
        return OneUptimeDate.fromNow(date);
      })}
    </time>
  );
};

export default RelativeTime;
