import LlmObservabilityConnection from "Common/Models/DatabaseModels/LlmObservabilityConnection";
import OneUptimeDate from "Common/Types/Date";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  LlmConnectionSummary,
  getLlmConnectionLastReadSummary,
  getLlmConnectionPeopleSummary,
  getLlmConnectionReadingNote,
} from "./LlmConnectionHealth";

/*
 * A connection's Last read, as the list draws it: when it was last read,
 * what that read brought in, a team's members (Cursor), and a read still
 * catching up. Every number in it is written the reader's way, the count
 * and the figure beside it alike.
 */

export interface ComponentProps {
  connection: LlmObservabilityConnection;
}

const LlmConnectionLastRead: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const connection: LlmObservabilityConnection = props.connection;

  if (!connection.lastSuccessfulPullAt) {
    return (
      <span className="text-sm text-gray-500">
        {translator.translateText("Not yet")}
      </span>
    );
  }

  const summary: LlmConnectionSummary | undefined =
    getLlmConnectionLastReadSummary(connection);
  const people: LlmConnectionSummary | undefined =
    getLlmConnectionPeopleSummary(connection, translator.formatNumber);
  const readingNote: string | undefined =
    getLlmConnectionReadingNote(connection);

  const say: (line: LlmConnectionSummary) => string = (
    line: LlmConnectionSummary,
  ): string => {
    return line.plural && line.count !== undefined
      ? translator.translatePlural(line.plural, line.count, line.values)
      : translator.translateTemplate(line.template, line.values);
  };

  return (
    <div className="min-w-0">
      <div className="text-sm text-gray-900">
        {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          connection.lastSuccessfulPullAt,
        )}
      </div>
      {summary ? (
        <div
          className="text-xs text-gray-500"
          data-testid="llm-connection-last-read-summary"
        >
          {say(summary)}
        </div>
      ) : (
        <></>
      )}
      {people ? (
        <div
          className="text-xs text-gray-500"
          data-testid="llm-connection-people-summary"
        >
          {say(people)}
        </div>
      ) : (
        <></>
      )}
      {readingNote ? (
        <div
          className="text-xs text-gray-500"
          data-testid="llm-connection-reading-note"
        >
          {translator.translateText(readingNote)}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default LlmConnectionLastRead;
