import ObjectID from "Common/Types/ObjectID";
import Event from "./Event";

export default interface MonitorEvent extends Event {
  monitorId: ObjectID;
}
