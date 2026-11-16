import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import MonitorStep from "./MonitorStep";
import MonitorSteps from "./MonitorSteps";

/*
 * THE MONITOR TYPES JSON READING BUILDS, FOR A PROGRAM THAT READS MONITORS.
 *
 * A monitor's steps, a step, its criteria and a criterion each join JSON
 * reading when their module loads (Types/JoinedSerializableObjects), rather
 * than JSON reading importing them for every page. A program that reads a
 * monitor imports this module from its entry, before anything is read: the
 * Dashboard, whose pages are files of their own that would otherwise read
 * a monitor's steps only once a page that imports them had loaded. The
 * sign-in pages, a status page, a public dashboard and the Admin Dashboard
 * never read one, and leave them out of what they download (issue #8821).
 *
 * On the server the models bring them: the Monitor, MonitorTemplate and
 * MonitorTest models' steps column (MonitorStepsColumnTransformer).
 */
const MONITOR_JSON_TYPES: ReadonlyArray<{ name: string }> = [
  MonitorSteps,
  MonitorStep,
  MonitorCriteria,
  MonitorCriteriaInstance,
];

export default MONITOR_JSON_TYPES;
