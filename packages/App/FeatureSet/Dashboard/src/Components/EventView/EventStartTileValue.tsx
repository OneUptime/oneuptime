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
 * the same zone every time on the page is in. A narrow tile (three in a row
 * at 640px) puts the date and the time on a line each; the zone stays on the
 * time's line while it fits and goes under it, whole, when it does not.
 * Nothing breaks inside the date, the time or the zone.
 */
const EventStartTileValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const parts: EventStartTileParts = getEventStartTileParts(props.startedAt);

  return (
    <span data-testid="event-start-tile-value">
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
