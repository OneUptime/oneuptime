import EnableRealtimeEventsOn from "../Realtime/EnableRealtimeEventsOn";
import GenericFunction from "../GenericFunction";
import IconProp from "../Icon/IconProp";

export default (props: {
  tableName: string;
  singularName: string;
  pluralName: string;
  icon: IconProp;
  tableDescription: string;
  enableRealtimeEventsOn?: EnableRealtimeEventsOn | undefined;
}) => {
  return (ctr: GenericFunction) => {
    ctr.prototype.singularName = props.singularName;
    ctr.prototype.tableName = props.tableName;
    ctr.prototype.icon = props.icon;
    ctr.prototype.tableDescription = props.tableDescription;
    ctr.prototype.pluralName = props.pluralName;
    if (props.enableRealtimeEventsOn) {
      ctr.prototype.enableRealtimeEventsOn = props.enableRealtimeEventsOn;
    }
  };
};
