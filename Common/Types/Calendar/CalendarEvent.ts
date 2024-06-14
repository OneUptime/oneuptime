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
}
