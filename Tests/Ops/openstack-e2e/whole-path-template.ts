/*
 * The monitor steps the dashboard's template picker saves, from the template's own code, because a
 * monitor written out by hand here would prove nothing about the one a person gets.
 *
 * Bundled with the esbuild in packages/Common, and run by whole-path.py:
 *   node template.js <template id> <cloud> <online status> <offline status> <incident severity> <alert severity>
 */
import MonitorSteps from "../../../packages/Common/Types/Monitor/MonitorSteps";
import {
  OpenStackAlertTemplate,
  getOpenStackAlertTemplateById,
} from "../../../packages/Common/Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "../../../packages/Common/Types/ObjectID";

const [
  templateId,
  cloud,
  online,
  offline,
  incidentSeverity,
  alertSeverity,
]: Array<string> = process.argv.slice(2) as Array<string>;

const template: OpenStackAlertTemplate | undefined =
  getOpenStackAlertTemplateById(templateId as string);

if (!template) {
  throw new Error(`No OpenStack alert template is called ${templateId}`);
}

const steps: MonitorSteps = new MonitorSteps();

steps.data = {
  monitorStepsInstanceArray: [
    template.getMonitorStep({
      cloudIdentifier: cloud as string,
      onlineMonitorStatusId: new ObjectID(online as string),
      offlineMonitorStatusId: new ObjectID(offline as string),
      defaultIncidentSeverityId: new ObjectID(incidentSeverity as string),
      defaultAlertSeverityId: new ObjectID(alertSeverity as string),
      monitorName: template.name,
    }),
  ],
  defaultMonitorStatusId: new ObjectID(online as string),
};

process.stdout.write(
  JSON.stringify({ name: template.name, monitorSteps: steps.toJSON() }),
);
