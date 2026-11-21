import NotEqualOrNull from "../../Types/BaseDatabase/NotEqualOrNull";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";

/*
 * THE MONITORS LINK EXISTING MONITORS OFFERS (#10399).
 *
 * A template links monitors of its own type (MonitorTemplateService
 * .linkMonitor refuses any other), and a monitor linked to another template
 * moves to this one, so the dialog offers every monitor of the project that
 * is of the template's type and not linked to it already: linked to another
 * template or to none. Archived monitors are left out, as the Monitors list
 * and the template's own Linked Monitors table leave them out (MonitorTable
 * pins isArchived): one linked from here would join the template without
 * ever showing in its table.
 *
 * The dialog's picker (EntityDropdown) sends this query to the server with
 * every search, 50 names at a time, and the server filters, searches and
 * sorts: at any number of monitors, a monitor is found by any part of its
 * name. The dialog used to read the first 10,000 monitors of the type, by
 * name, and drop the linked ones and search what was left in the browser, so
 * in a project with more a monitor whose name sorted late - "WB1500KSK02",
 * linked to nothing - was never offered, and a search for it said "No
 * matches found".
 *
 * "Not linked to this template" has to keep the monitors linked to none, and
 * NotEqual (`<>`) leaves an empty column out: NotEqualOrNull keeps it.
 * React-free and server-safe, so the server's tests list monitors with the
 * very query the dialog sends. The project is the request's own (its
 * tenant), as for every list the Dashboard reads.
 */
// A type rather than an interface: a form field's query takes it as it is.
export type LinkableMonitorsQuery = {
  monitorType: MonitorType;
  monitorTemplateId: NotEqualOrNull<string>;
  isArchived: false;
};

export const getLinkableMonitorsQuery: (data: {
  monitorTemplateId: ObjectID | string;
  monitorType: MonitorType;
}) => LinkableMonitorsQuery = (data: {
  monitorTemplateId: ObjectID | string;
  monitorType: MonitorType;
}): LinkableMonitorsQuery => {
  return {
    monitorType: data.monitorType,
    monitorTemplateId: new NotEqualOrNull<string>(
      data.monitorTemplateId.toString(),
    ),
    isArchived: false,
  };
};
