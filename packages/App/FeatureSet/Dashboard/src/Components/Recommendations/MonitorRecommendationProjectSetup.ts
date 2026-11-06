import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { MonitorRecommendationSeverityOption } from "Common/Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Why a member whose role may not create monitors cannot add the
 * recommended ones: the first sentence of the lock on every Create and Add
 * of a Recommendations page (PermissionGate's sentence option), before the
 * permission that would allow it. PermissionGate's own ("You do not have
 * permission to create this Monitor.") speaks of one monitor, on pages
 * that make them by the batch.
 */
export const CREATE_MONITORS_LOCKED_SENTENCE: string = translationKey(
  "You do not have permission to create monitors.",
);

/*
 * What a project must have before a recommended monitor can be created in
 * it, and what the create panel offers - read once per page, by a
 * resource's Recommendations tab (MonitorRecommendations) and a cloud
 * account's (CloudAccountMonitorRecommendations) alike, so both build their
 * monitors on the same statuses and severities.
 *
 *   - the statuses a monitor's criteria set (operational and offline), and
 *     the most severe incident and alert severity, which every template
 *     writes into its criteria;
 *   - the severities, on-call policies and labels the create panel offers.
 *
 * A project without one of the four ids cannot create a monitor at all, so
 * the read fails with what to add and where, rather than a monitor whose
 * criteria name nothing.
 */

// The ids every recommended monitor's step is built with.
export interface MonitorRecommendationProjectDefaults {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
}

export interface MonitorRecommendationProjectSetup {
  defaults: MonitorRecommendationProjectDefaults;
  incidentSeverityOptions: Array<MonitorRecommendationSeverityOption>;
  alertSeverityOptions: Array<MonitorRecommendationSeverityOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
}

export async function loadMonitorRecommendationProjectSetup(
  translator: Translator,
): Promise<MonitorRecommendationProjectSetup> {
  const monitorStatusList: ListResult<MonitorStatus> = await ModelAPI.getList({
    modelType: MonitorStatus,
    // A new monitor is set up with values that can be picked.
    query: { isArchived: false },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: {
      name: true,
      isOperationalState: true,
      isOfflineState: true,
      priority: true,
      color: true,
    },
    sort: {
      priority: SortOrder.Ascending,
    },
  });

  const onlineStatus: MonitorStatus | undefined = monitorStatusList.data.find(
    (item: MonitorStatus) => {
      return item.isOperationalState;
    },
  );
  const offlineStatus: MonitorStatus | undefined = monitorStatusList.data.find(
    (item: MonitorStatus) => {
      return item.isOfflineState;
    },
  );

  const incidentSeverityList: ListResult<IncidentSeverity> =
    await ModelAPI.getList({
      modelType: IncidentSeverity,
      // A new monitor is set up with values that can be picked.
      query: { isArchived: false },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { name: true, order: true, color: true },
      sort: { order: SortOrder.Ascending },
    });

  const alertSeverityList: ListResult<AlertSeverity> = await ModelAPI.getList({
    modelType: AlertSeverity,
    // A new monitor is set up with values that can be picked.
    query: { isArchived: false },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: { name: true, order: true, color: true },
    sort: { order: SortOrder.Ascending },
  });

  /*
   * Every one of these is required to build a valid monitor step. A project
   * missing any of them cannot create monitors at all, so fail with a
   * specific message rather than letting a non-null assertion throw an
   * opaque one (which is what the monitor create form does today).
   */
  if (!onlineStatus?._id) {
    throw new Error(
      translator.translateTemplate(
        "This project has no operational monitor status. Add one under Monitors → Settings → Monitor Status.",
      ),
    );
  }
  if (!offlineStatus?._id) {
    throw new Error(
      translator.translateTemplate(
        "This project has no offline monitor status. Add one under Monitors → Settings → Monitor Status.",
      ),
    );
  }
  if (!incidentSeverityList.data[0]?._id) {
    throw new Error(
      translator.translateTemplate(
        "This project has no incident severity. Add one under Incidents → Settings → Incident Severity.",
      ),
    );
  }
  if (!alertSeverityList.data[0]?._id) {
    throw new Error(
      translator.translateTemplate(
        "This project has no alert severity. Add one under Alerts → Settings → Alert Severity.",
      ),
    );
  }

  const onCallPolicyList: ListResult<OnCallDutyPolicy> = await ModelAPI.getList(
    {
      modelType: OnCallDutyPolicy,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { name: true },
      sort: { name: SortOrder.Ascending },
    },
  );

  const labelList: ListResult<Label> = await ModelAPI.getList({
    modelType: Label,
    // A new monitor is set up with values that can be picked.
    query: { isArchived: false },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: { name: true },
    sort: { name: SortOrder.Ascending },
  });

  return {
    defaults: {
      onlineMonitorStatusId: new ObjectID(onlineStatus._id),
      offlineMonitorStatusId: new ObjectID(offlineStatus._id),
      defaultMonitorStatusId: new ObjectID(onlineStatus._id),
      defaultIncidentSeverityId: new ObjectID(incidentSeverityList.data[0]._id),
      defaultAlertSeverityId: new ObjectID(alertSeverityList.data[0]._id),
    },
    incidentSeverityOptions: incidentSeverityList.data.map(
      (item: IncidentSeverity): MonitorRecommendationSeverityOption => {
        return {
          id: new ObjectID(item._id!),
          name: item.name!,
          order: item.order,
          color: DropdownUtil.toOptionColor(item.color),
        };
      },
    ),
    alertSeverityOptions: alertSeverityList.data.map(
      (item: AlertSeverity): MonitorRecommendationSeverityOption => {
        return {
          id: new ObjectID(item._id!),
          name: item.name!,
          order: item.order,
          color: DropdownUtil.toOptionColor(item.color),
        };
      },
    ),
    onCallPolicyDropdownOptions: onCallPolicyList.data.map(
      (item: OnCallDutyPolicy): DropdownOption => {
        return { value: item._id!, label: item.name! };
      },
    ),
    labelDropdownOptions: labelList.data.map((item: Label): DropdownOption => {
      return { value: item._id!, label: item.name! };
    }),
  };
}
