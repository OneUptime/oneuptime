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
  /*
   * The column that names one record - what a delete confirmation calls it.
   * Leave it out and the name is worked out from the model (its slug's source
   * column, else name, title and the like; see UI/Utils/ModelDisplayName).
   * Set it only where that would pick the wrong column, or none.
   */
  displayNameColumn?: string | undefined;
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
    if (props.displayNameColumn) {
      ctr.prototype.displayNameColumn = props.displayNameColumn;
    }
  };
};
