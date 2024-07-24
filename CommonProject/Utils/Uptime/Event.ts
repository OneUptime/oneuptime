import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";

export default interface Event {
  startDate: Date;
  endDate: Date;
  label: string;
  priority: number;
  color: Color;
  eventStatusId: ObjectID; // this is the id of the event status. for example, monitor status id.
}
