import {
  SHOWS_FROM_TEXT,
  getWaitingPublishAt,
} from "./ScheduledMaintenancePublishing";
import StatusPagesElement from "../StatusPage/StatusPagesElement";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { useWriteDatesInSentenceLanguage } from "Common/UI/Utils/SentenceLanguage";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Shown on Status Page cell of the list of events: the pages that show
 * the event - and, for one kept to the team until its publish time (#5249),
 * a quiet line under them saying from when: "Shows from <time>". An event
 * waiting for its time is on none of them yet, and the list says so.
 */

export const SHOWS_FROM_TEST_ID: string = "scheduled-maintenance-shows-from";

export interface ComponentProps {
  item: ScheduledMaintenance;
}

// The time in the line, written in the line's language.
const ShowsFromTime: FunctionComponent<{ date: Date }> = (props: {
  date: Date;
}): ReactElement => {
  const writeDates: <T>(write: () => T) => T =
    useWriteDatesInSentenceLanguage();

  return (
    <time dateTime={props.date.toISOString()}>
      {writeDates((): string => {
        return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          props.date,
        );
      })}
    </time>
  );
};

const ScheduledMaintenanceStatusPagesCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const waitingPublishAt: Date | null = getWaitingPublishAt(props.item);

  return (
    <div>
      <StatusPagesElement statusPages={props.item.statusPages || []} />
      {waitingPublishAt ? (
        <p
          className="mt-1 flex items-center gap-1 text-xs text-gray-500"
          data-testid={SHOWS_FROM_TEST_ID}
        >
          <Icon
            icon={IconProp.Clock}
            className="h-3.5 w-3.5 shrink-0 text-gray-400"
          />
          <span>
            <TranslatedSentence
              template={SHOWS_FROM_TEXT}
              slots={{
                time: <ShowsFromTime date={waitingPublishAt} />,
              }}
            />
          </span>
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ScheduledMaintenanceStatusPagesCell;
