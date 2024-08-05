import ObjectID from "../../Types/ObjectID";
import Event from "./Event";

export default interface MonitorEvent extends Event {
  monitorId: ObjectID;
}
