import React, { FunctionComponent, ReactElement } from "react";
import {
  EventStartTileParts,
  getEventStartTileParts,
} from "../../Utils/EventOverview";

export interface ComponentProps {
  startedAt: Date;
}

/*
 * The value of the Declared / Created tile that opens an overview's stat
 * bar: "Sep 14, 06:01 PM", then the time zone, smaller and quieter - it is
 * the same zone every time on the page is in. A tile too narrow for one line
 * (an episode's four tiles beside the side menu at 1280px, three in a row at
 * 640px) puts the date over the time and its zone: the lines are balanced
 * (text-balance), so the break goes after the date's comma rather than
 * leaving the zone alone on a line, and the zone goes under the time, whole,
 * only where even that does not fit. Nothing breaks inside the date, the time
 * or the zone.
 */
const EventStartTileValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const parts: EventStartTileParts = getEventStartTileParts(props.startedAt);

  return (
    <span data-testid="event-start-tile-value" className="block text-balance">
      {parts.dateTime}
      {parts.zone ? (
        <>
          {" "}
          <span
            data-testid="event-start-tile-zone"
            className="text-sm font-medium text-gray-500"
          >
            {parts.zone}
          </span>
        </>
      ) : (
        <></>
      )}
    </span>
  );
};

export default EventStartTileValue;
