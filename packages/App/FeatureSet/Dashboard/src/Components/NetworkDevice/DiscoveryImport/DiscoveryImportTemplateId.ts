import BadDataException from "Common/Types/Exception/BadDataException";
import {
  DiscoveryImportAlerting,
  DiscoveryImportSettings,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import ObjectID from "Common/Types/ObjectID";
import { MonitorCriteriaSeedIds } from "Common/Utils/NetworkDiscovery/PingMonitorBuilder";
import ProjectUtil from "Common/UI/Utils/Project";
import { findOrCreateRecommendedTemplate } from "../RecommendedMonitorTemplate";
import {
  DiscoveryImportTemplateChoice,
  RECOMMENDED_TEMPLATE_CHOICE_VALUE,
} from "./DiscoveryImportOutcome";

/*
 * The monitor template an import is sent with, when it asks for monitors:
 * the one picked, or - for the recommended pack the project does not have
 * yet - the one made for it now. Shared by a scan's import and the
 * Discovered Devices list's (issue #5775), so both make it the same way.
 * Undefined when the import asks for no monitors.
 */
export async function resolveImportMonitorTemplateId(data: {
  settings: DiscoveryImportSettings;
  pickedTemplate: DiscoveryImportTemplateChoice | null;
  seedIds: MonitorCriteriaSeedIds | null | undefined;
}): Promise<string | undefined> {
  if (data.settings.alerting !== DiscoveryImportAlerting.MonitorTemplate) {
    return undefined;
  }

  if (!data.pickedTemplate) {
    throw new BadDataException(
      "Pick the monitor template each device is monitored with.",
    );
  }

  if (data.pickedTemplate.id) {
    return data.pickedTemplate.id;
  }

  if (data.settings.monitorTemplateId !== RECOMMENDED_TEMPLATE_CHOICE_VALUE) {
    return undefined;
  }

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId || !data.seedIds) {
    throw new BadDataException(
      "The recommended template could not be created for this project. Pick another template.",
    );
  }

  return (
    await findOrCreateRecommendedTemplate({
      projectId: projectId,
      seedIds: data.seedIds,
    })
  ).toString();
}
