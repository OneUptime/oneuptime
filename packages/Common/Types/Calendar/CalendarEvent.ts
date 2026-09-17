import { JSONObject } from "../JSON";

export default interface CalendarEvent extends JSONObject {
  id: number;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean | undefined;
  desc?: string | undefined;
  color?: string | undefined;
  textColor?: string | undefined;
  /*
   * A SECOND colour for the block, painted as a stripe down its leading edge.
   * Used when a block is about two people rather than one — an on-call shift
   * covered by a substitute is drawn in the substitute's colour with the
   * overridden person's colour on the edge, so the swap is legible at a glance
   * and, crucially, survives the label being truncated to nothing in a narrow
   * week-view column.
   */
  accentColor?: string | undefined;
  /*
   * Extra class names for the rendered block. The calendar itself defines no
   * semantics for these; it forwards them so a caller can attach its own
   * treatment (see .oneuptime-calendar-event--override in Calendar.css) without
   * the generic component learning what an override is.
   */
  className?: string | undefined;
}
