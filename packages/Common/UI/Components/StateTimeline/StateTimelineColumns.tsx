import StateTimelineDuration from "./StateTimelineDuration";
import StateTimelineEndsAt from "./StateTimelineEndsAt";
import Column from "../ModelTable/Column";
import { PillSize } from "../Pill/Pill";
import FieldType from "../Types/FieldType";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OneUptimeDate from "../../../Types/Date";
import { getLiveDuration } from "../../Utils/UseLiveDuration";
import React, { ReactElement } from "react";

/*
 * ---------------------------------------------------------------------------
 * The "Ends At" and "Duration" columns of every state and status timeline
 * ---------------------------------------------------------------------------
 *
 * Monitor, incident, incident episode, alert, alert episode and scheduled
 * maintenance timelines each declared these two columns by hand, identically:
 * a DateTime column whose empty value read "Currently Active" in plain grey,
 * and a duration worked out once, at render, so the current row's never
 * moved. They are declared here once instead, so each timeline gets the
 * pulsing "Currently Active" marker and the live duration, and a fix to
 * either reaches all of them.
 *
 * Both columns read `endsAt` as their primary field, as they always have:
 * that is what a viewer's saved column layout is keyed by
 * (ColumnPreference.getColumnIds), so the layouts survive the move. The
 * duration also declares `startsAt`, which it cannot be worked out without.
 */

// The two dates every timeline row carries.
export interface StateTimelineRow {
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
}

export type StateTimelineModel = BaseModel & StateTimelineRow;

export const STATE_TIMELINE_ENDS_AT_TITLE: string = "Ends At";
export const STATE_TIMELINE_DURATION_TITLE: string = "Duration";

export interface StateTimelineEndsAtColumnOptions {
  // The header. "Ends At" unless the page words its columns differently.
  title?: string | undefined;
  // Match the status pill in the same row. Normal unless given.
  indicatorSize?: PillSize | undefined;
}

export type GetStateTimelineEndsAtColumnFunction = <
  TModel extends StateTimelineModel,
>(
  options?: StateTimelineEndsAtColumnOptions | undefined,
) => Column<TModel>;

/*
 * When the row ended, or the pulsing "Currently Active" marker. Still a
 * DateTime column underneath, so filtering, sorting and the CSV export treat
 * it exactly as before (a row with no end exports an empty cell).
 */
export const getStateTimelineEndsAtColumn: GetStateTimelineEndsAtColumnFunction =
  <TModel extends StateTimelineModel>(
    options?: StateTimelineEndsAtColumnOptions | undefined,
  ): Column<TModel> => {
    return {
      field: {
        endsAt: true,
      } as Column<TModel>["field"],
      title: options?.title || STATE_TIMELINE_ENDS_AT_TITLE,
      type: FieldType.DateTime,
      getElement: (item: TModel): ReactElement => {
        return (
          <StateTimelineEndsAt
            endDate={item.endsAt}
            indicatorSize={options?.indicatorSize}
          />
        );
      },
    };
  };

export type GetStateTimelineDurationTextFunction = (
  item: StateTimelineRow,
  now?: Date | undefined,
) => string;

/*
 * The duration as text, at `now` (the current time unless given): what the
 * Duration column writes into a CSV export. It used to write the row's end
 * date, the only value the column's `endsAt` field held.
 */
export const getStateTimelineDurationText: GetStateTimelineDurationTextFunction =
  (item: StateTimelineRow, now?: Date | undefined): string => {
    return getLiveDuration({
      startDate: item.startsAt,
      endDate: item.endsAt,
      now: now || OneUptimeDate.getCurrentDate(),
    }).formattedDuration;
  };

export interface StateTimelineDurationColumnOptions {
  // The header. "Duration" unless the page words its columns differently.
  title?: string | undefined;
}

export type GetStateTimelineDurationColumnFunction = <
  TModel extends StateTimelineModel,
>(
  options?: StateTimelineDurationColumnOptions | undefined,
) => Column<TModel>;

// How long the row lasted, counting up every second for the current one.
export const getStateTimelineDurationColumn: GetStateTimelineDurationColumnFunction =
  <TModel extends StateTimelineModel>(
    options?: StateTimelineDurationColumnOptions | undefined,
  ): Column<TModel> => {
    return {
      field: {
        endsAt: true,
        startsAt: true,
      } as Column<TModel>["field"],
      title: options?.title || STATE_TIMELINE_DURATION_TITLE,
      type: FieldType.Text,
      getElement: (item: TModel): ReactElement => {
        return (
          <StateTimelineDuration
            startDate={item.startsAt}
            endDate={item.endsAt}
          />
        );
      },
      getExportValue: (item: TModel): string => {
        return getStateTimelineDurationText(item);
      },
    };
  };
