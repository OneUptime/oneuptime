import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import ObjectID from "../../Types/ObjectID";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import { createTranslator, Translator } from "../../Types/Translator";

/*
 * THE STATUS PAGE A GUIDED SETUP PUBLISHES, AND THE MONITORS ON IT.
 *
 * "Publish a status page" is set up two ways: the guided setup's page in the
 * Dashboard (#6806, Components/GuidedSetup/StatusPage) and a sentence to Ask
 * AI (#6829, Server/Utils/AI/Toolbox/SetupTools). Both build the page and
 * each monitor's place on it here, as Create Status Page and Add Multiple
 * Monitors build them, so for the same answers they make the same records:
 *
 *   - the page: its name and project, everything else the server's defaults
 *     (public, at <host>/status-page/<id>); a page the person does not name
 *     is named after the project, in the person's language (below);
 *   - each monitor: a resource named after the monitor, showing its current
 *     status, its uptime and its history.
 *
 * Pure: the Dashboard writes through the model API (StatusPageSetupApi and
 * BulkAddStatusPageResources), the server through StatusPageService and
 * StatusPageResourceService (SetupTools), as the person either way.
 */

// Create Status Page's own rule (StatusPageCreateForm): at least two letters.
export const STATUS_PAGE_NAME_MIN_LENGTH: number = 2;

/*
 * THE NAME A PAGE STARTS WITH: the project's, so a new project's owner can
 * keep it and type nothing ("Acme Status"), in the language of the person
 * it is made for - the Dashboard's translator in the guided setup, and the
 * server's for the language the person reads the Dashboard in when Ask AI
 * publishes it (#7247, ServerTranslation's getRecordWordsTranslator), so
 * both name it "Status von Acme" for a reader of German. No translator is
 * English. Empty when the project's name is not known: the person names it.
 *
 * The Dashboard's extractor reads this file as a "keys" root, and the
 * server's locale set copies the Dashboard's wording of its sentences
 * (Scripts/I18n/ServerLocales' DASHBOARD_SHARED_TEXT_SOURCES): after
 * changing one, translate it in the Dashboard's files and run
 * `npm run i18n:server-sync` from the repository's root.
 */
export const getDefaultStatusPageName: (data: {
  translator?: Translator | undefined;
  projectName: string | undefined;
}) => string = (data: {
  translator?: Translator | undefined;
  projectName: string | undefined;
}): string => {
  const projectName: string = (data.projectName || "").trim();

  if (!projectName) {
    return "";
  }

  return (data.translator || createTranslator(undefined)).translateTemplate(
    "{{project}} Status",
    { project: projectName },
  );
};

/*
 * What a status page shows of a monitor, set by the resource form or a bulk
 * add. Display name and description come from the monitor itself.
 */
export interface StatusPageResourceOptions {
  displayTooltip?: string | undefined;
  showCurrentStatus?: boolean | undefined;
  showUptimePercent?: boolean | undefined;
  uptimePercentPrecision?: UptimePrecision | undefined;
  showStatusHistoryChart?: boolean | undefined;
}

// How a guided setup shows each monitor: its status, its uptime and its history.
export const GUIDED_SETUP_RESOURCE_OPTIONS: StatusPageResourceOptions = {
  showCurrentStatus: true,
  showUptimePercent: true,
  showStatusHistoryChart: true,
};

// Where on the status page a new resource goes: the same for every one of a bulk add.
export interface StatusPageResourcePlacement {
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPageGroupId?: ObjectID | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
  resourceOptions?: StatusPageResourceOptions | undefined;
}

/*
 * The page as Create Status Page makes it: the name, trimmed, and the
 * project; everything else the server's defaults.
 */
export const buildGuidedStatusPage: (data: {
  name: string;
  projectId: ObjectID;
}) => StatusPage = (data: {
  name: string;
  projectId: ObjectID;
}): StatusPage => {
  const statusPage: StatusPage = new StatusPage();
  statusPage.name = data.name.trim();
  statusPage.projectId = data.projectId;

  return statusPage;
};

/*
 * One new resource, placed and set up as the bulk add says. Its name and
 * description are its monitor's (or monitor group's); the caller points it
 * at what it shows (monitorId or monitorGroupId).
 */
export const buildStatusPageResource: (data: {
  placement: StatusPageResourcePlacement;
  displayName: string;
  displayDescription: string | undefined;
}) => StatusPageResource = (data: {
  placement: StatusPageResourcePlacement;
  displayName: string;
  displayDescription: string | undefined;
}): StatusPageResource => {
  const placement: StatusPageResourcePlacement = data.placement;
  const resource: StatusPageResource = new StatusPageResource();
  resource.projectId = placement.projectId;
  resource.statusPageId = placement.statusPageId;
  resource.displayName = data.displayName;

  if (data.displayDescription !== undefined) {
    resource.displayDescription = data.displayDescription;
  }

  if (placement.statusPageGroupId) {
    resource.statusPageGroupId = placement.statusPageGroupId;
  }

  if (placement.rowAxisValue) {
    resource.rowAxisValue = placement.rowAxisValue;
  }

  if (placement.columnAxisValue) {
    resource.columnAxisValue = placement.columnAxisValue;
  }

  const resourceOptions: StatusPageResourceOptions =
    placement.resourceOptions || {};

  if (resourceOptions.displayTooltip) {
    resource.displayTooltip = resourceOptions.displayTooltip;
  }

  if (resourceOptions.showCurrentStatus !== undefined) {
    resource.showCurrentStatus = resourceOptions.showCurrentStatus;
  }

  if (resourceOptions.showUptimePercent !== undefined) {
    resource.showUptimePercent = resourceOptions.showUptimePercent;
  }

  if (resourceOptions.uptimePercentPrecision) {
    resource.uptimePercentPrecision = resourceOptions.uptimePercentPrecision;
  }

  if (resourceOptions.showStatusHistoryChart !== undefined) {
    resource.showStatusHistoryChart = resourceOptions.showStatusHistoryChart;
  }

  return resource;
};

/*
 * A monitor's place on a status page, as the guided setup adds it: named
 * after the monitor, with its status, its uptime and its history.
 */
export const buildGuidedStatusPageMonitor: (data: {
  projectId: ObjectID;
  statusPageId: ObjectID;
  monitorId: ObjectID;
  monitorName: string;
}) => StatusPageResource = (data: {
  projectId: ObjectID;
  statusPageId: ObjectID;
  monitorId: ObjectID;
  monitorName: string;
}): StatusPageResource => {
  const resource: StatusPageResource = buildStatusPageResource({
    placement: {
      projectId: data.projectId,
      statusPageId: data.statusPageId,
      resourceOptions: GUIDED_SETUP_RESOURCE_OPTIONS,
    },
    displayName: data.monitorName,
    displayDescription: undefined,
  });

  resource.monitorId = data.monitorId;

  return resource;
};
