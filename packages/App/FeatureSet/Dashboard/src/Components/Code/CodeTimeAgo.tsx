import OneUptimeDate from "Common/Types/Date";
import {
  FeedClock,
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import { useSentenceLanguage } from "Common/UI/Utils/SentenceLanguage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // An ISO date, as the Code API sends it.
  date: string | undefined;
  className?: string | undefined;
}

/*
 * "5 minutes ago", in the reader's language (FeedTime, not moment's
 * English), with the full date and time on hover.
 */
const CodeTimeAgo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Inside a sentence, the sentence's language.
  const sentenceLanguage: string | null = useSentenceLanguage();

  if (!props.date) {
    return <></>;
  }

  const date: Date = new Date(props.date);

  if (Number.isNaN(date.getTime())) {
    return <></>;
  }

  const clock: FeedClock = getFeedClock({
    language: sentenceLanguage ?? translator.language,
  });

  return (
    <time
      dateTime={date.toISOString()}
      title={OneUptimeDate.getDateAsLocalFormattedString(date)}
      className={props.className}
    >
      {formatFeedTimeAgo(date, clock) || ""}
    </time>
  );
};

export default CodeTimeAgo;
