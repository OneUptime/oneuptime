import AlertStateUtil from "../../Utils/AlertState";
import IncidentStateUtil from "../../Utils/IncidentState";
import ScheduledMaintenanceStateUtil from "../../Utils/ScheduledMaintenanceState";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";

/*
 * Everything Home's health card, stat strip and "Needs attention" list show,
 * read in ONE parallel batch.
 *
 * Each open-work list is a getList with a small limit: the API answers a list
 * with the rows AND the total that matches its query, so one request gives
 * the stat strip its number and the attention list its rows. Counting and
 * listing separately would ask the database the same question twice on every
 * Home visit.
 *
 * Only the incident, alert and maintenance lists need a state list before
 * their query can be scoped, so each of those fetches its own states (through
 * the ModelListCache the side menu and header share) and chains its list off
 * them. Nothing in fetchHomeOverview awaits a state list itself: the monitor
 * and SLO reads go out at once, next to those three chains, not behind them.
 */

// How many rows of each kind the attention list shows before "View all".
export const HOME_ATTENTION_LIST_LIMIT: number = 5;

export interface HomeList<TModel> {
  // The first HOME_ATTENTION_LIST_LIMIT rows, most relevant first.
  items: Array<TModel>;
  // Every row that matches, however many were read.
  count: number;
}

export interface HomeOverviewData {
  activeIncidents: HomeList<Incident>;
  activeAlerts: HomeList<Alert>;
  notOperationalMonitors: HomeList<Monitor>;
  ongoingMaintenance: HomeList<ScheduledMaintenance>;
  slosNeedingAttention: HomeList<ServiceLevelObjective>;
  // Every monitor that is not archived: zero means none was created.
  totalMonitors: number;
  // Every SLO that is not archived: zero means none is set up.
  totalSlos: number;
}

// The numbers alone, which is all the health verdict and the strip read.
export interface HomeCounts {
  activeIncidents: number;
  activeAlerts: number;
  notOperationalMonitors: number;
  ongoingMaintenance: number;
  slosNeedingAttention: number;
  totalMonitors: number;
  totalSlos: number;
}

type EmptyListFunction = <TModel>() => HomeList<TModel>;

const emptyList: EmptyListFunction = <TModel>(): HomeList<TModel> => {
  return { items: [], count: 0 };
};

type ToHomeListFunction = <TModel extends BaseModel>(
  result: ListResult<TModel>,
) => HomeList<TModel>;

const toHomeList: ToHomeListFunction = <TModel extends BaseModel>(
  result: ListResult<TModel>,
): HomeList<TModel> => {
  return {
    items: result.data,
    // A list without its total still says how many rows it holds.
    count: typeof result.count === "number" ? result.count : result.data.length,
  };
};

type IdsOfStatesFunction = (
  states: Array<{ id?: ObjectID | null | undefined }>,
) => Array<ObjectID>;

const idsOfStates: IdsOfStatesFunction = (
  states: Array<{ id?: ObjectID | null | undefined }>,
): Array<ObjectID> => {
  return states
    .map((state: { id?: ObjectID | null | undefined }) => {
      return state.id;
    })
    .filter((id: ObjectID | null | undefined): id is ObjectID => {
      return Boolean(id);
    });
};

/*
 * Open incidents: in a state above the project's resolved state. Newest
 * first, as the Active Incidents list sorts them.
 */
export const fetchActiveIncidents: (
  projectId: ObjectID,
) => Promise<HomeList<Incident>> = async (
  projectId: ObjectID,
): Promise<HomeList<Incident>> => {
  const unresolvedIncidentStates: Array<IncidentState> =
    await IncidentStateUtil.getUnresolvedIncidentStates(projectId);

  // No open state, nothing open: no request.
  if (unresolvedIncidentStates.length === 0) {
    return emptyList<Incident>();
  }

  return toHomeList<Incident>(
    await ModelAPI.getList<Incident>({
      modelType: Incident,
      query: {
        projectId: projectId,
        currentIncidentStateId: new Includes(
          idsOfStates(unresolvedIncidentStates),
        ),
      },
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        isPrivate: true,
        declaredAt: true,
        createdAt: true,
        currentIncidentState: {
          _id: true,
          name: true,
          color: true,
        },
        incidentSeverity: {
          _id: true,
          name: true,
          color: true,
        },
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: HOME_ATTENTION_LIST_LIMIT,
      skip: 0,
    }),
  );
};

// Open alerts, the same way: above the resolved state, newest first.
export const fetchActiveAlerts: (
  projectId: ObjectID,
) => Promise<HomeList<Alert>> = async (
  projectId: ObjectID,
): Promise<HomeList<Alert>> => {
  const unresolvedAlertStates: Array<AlertState> =
    await AlertStateUtil.getUnresolvedAlertStates(projectId);

  if (unresolvedAlertStates.length === 0) {
    return emptyList<Alert>();
  }

  return toHomeList<Alert>(
    await ModelAPI.getList<Alert>({
      modelType: Alert,
      query: {
        projectId: projectId,
        currentAlertStateId: new Includes(idsOfStates(unresolvedAlertStates)),
      },
      select: {
        _id: true,
        title: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        createdAt: true,
        currentAlertState: {
          _id: true,
          name: true,
          color: true,
        },
        alertSeverity: {
          _id: true,
          name: true,
          color: true,
        },
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: HOME_ATTENTION_LIST_LIMIT,
      skip: 0,
    }),
  );
};

/*
 * Monitors whose current status is not operational, such as Degraded or
 * Offline. Archived monitors are left out of this list and of the total:
 * they are not checked, so a frozen "Offline" is not a problem, and they are
 * gone from the Monitors list these numbers open.
 */
export const fetchNotOperationalMonitors: (
  projectId: ObjectID,
) => Promise<HomeList<Monitor>> = async (
  projectId: ObjectID,
): Promise<HomeList<Monitor>> => {
  return toHomeList<Monitor>(
    await ModelAPI.getList<Monitor>({
      modelType: Monitor,
      query: {
        projectId: projectId,
        isArchived: false,
        currentMonitorStatus: {
          isOperationalState: false,
        },
      },
      select: {
        _id: true,
        name: true,
        monitorType: true,
        currentMonitorStatus: {
          _id: true,
          name: true,
          color: true,
        },
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: HOME_ATTENTION_LIST_LIMIT,
      skip: 0,
    }),
  );
};

/*
 * In progress: in the project's ongoing state, or in a state of its own
 * placed between Ongoing and Ended, such as "Verifying"
 * (Common/Utils/ScheduledMaintenanceStart) - the events the Ongoing list
 * shows. The state list is the one the Home side menu reads on the same
 * mount, through ModelListCache, so it is one request for both.
 */
export const fetchOngoingMaintenance: (
  projectId: ObjectID,
) => Promise<HomeList<ScheduledMaintenance>> = async (
  projectId: ObjectID,
): Promise<HomeList<ScheduledMaintenance>> => {
  const inProgressStates: Array<ScheduledMaintenanceState> =
    await ScheduledMaintenanceStateUtil.getInProgressScheduledMaintenanceStates(
      projectId,
    );

  if (inProgressStates.length === 0) {
    return emptyList<ScheduledMaintenance>();
  }

  return toHomeList<ScheduledMaintenance>(
    await ModelAPI.getList<ScheduledMaintenance>({
      modelType: ScheduledMaintenance,
      query: {
        projectId: projectId,
        currentScheduledMaintenanceStateId: new Includes(
          idsOfStates(inProgressStates),
        ),
      },
      select: {
        _id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        currentScheduledMaintenanceState: {
          _id: true,
          name: true,
          color: true,
        },
      },
      sort: {
        startsAt: SortOrder.Ascending,
      },
      limit: HOME_ATTENTION_LIST_LIMIT,
      skip: 0,
    }),
  );
};

/*
 * At Risk and Budget Exhausted are the two statuses that mean a reliability
 * target is in trouble. Misconfigured and Paused are deliberately excluded:
 * they are a setup problem, not a burning budget, and mixing them in would
 * make the number impossible to act on.
 *
 * Disabled and archived SLOs are left out: the worker no longer evaluates
 * them, so their status is frozen at the moment they were switched off, and
 * the SLOs list does not show archived ones either. The least budget left
 * comes first.
 */
export const fetchSlosNeedingAttention: (
  projectId: ObjectID,
) => Promise<HomeList<ServiceLevelObjective>> = async (
  projectId: ObjectID,
): Promise<HomeList<ServiceLevelObjective>> => {
  return toHomeList<ServiceLevelObjective>(
    await ModelAPI.getList<ServiceLevelObjective>({
      modelType: ServiceLevelObjective,
      query: {
        projectId: projectId,
        isEnabled: true,
        isArchived: false,
        sloStatus: new Includes([SloStatus.AtRisk, SloStatus.BudgetExhausted]),
      },
      select: {
        _id: true,
        name: true,
        sloStatus: true,
        targetPercentage: true,
        currentSliPercentage: true,
        errorBudgetRemainingPercentage: true,
      },
      sort: {
        errorBudgetRemainingPercentage: SortOrder.Ascending,
      },
      limit: HOME_ATTENTION_LIST_LIMIT,
      skip: 0,
    }),
  );
};

export const fetchHomeOverview: (
  projectId: ObjectID,
) => Promise<HomeOverviewData> = async (
  projectId: ObjectID,
): Promise<HomeOverviewData> => {
  const [
    activeIncidents,
    activeAlerts,
    notOperationalMonitors,
    ongoingMaintenance,
    slosNeedingAttention,
    totalMonitors,
    totalSlos,
  ]: [
    HomeList<Incident>,
    HomeList<Alert>,
    HomeList<Monitor>,
    HomeList<ScheduledMaintenance>,
    HomeList<ServiceLevelObjective>,
    number,
    number,
  ] = await Promise.all([
    fetchActiveIncidents(projectId),
    fetchActiveAlerts(projectId),
    fetchNotOperationalMonitors(projectId),
    fetchOngoingMaintenance(projectId),
    fetchSlosNeedingAttention(projectId),
    /*
     * The two totals tell "nothing is wrong" apart from "nothing is set up".
     * They ride in the same batch, so a new project pays for them in
     * parallel, not in a second round trip.
     */
    ModelAPI.count<Monitor>({
      modelType: Monitor,
      query: {
        projectId: projectId,
        isArchived: false,
      },
    }),
    /*
     * Disabled SLOs still count as set up (they are paused by someone);
     * archived ones are gone from the SLOs list, so they do not.
     */
    ModelAPI.count<ServiceLevelObjective>({
      modelType: ServiceLevelObjective,
      query: {
        projectId: projectId,
        isArchived: false,
      },
    }),
  ]);

  return {
    activeIncidents,
    activeAlerts,
    notOperationalMonitors,
    ongoingMaintenance,
    slosNeedingAttention,
    totalMonitors,
    totalSlos,
  };
};

export const getHomeCounts: (data: HomeOverviewData) => HomeCounts = (
  data: HomeOverviewData,
): HomeCounts => {
  return {
    activeIncidents: data.activeIncidents.count,
    activeAlerts: data.activeAlerts.count,
    notOperationalMonitors: data.notOperationalMonitors.count,
    ongoingMaintenance: data.ongoingMaintenance.count,
    slosNeedingAttention: data.slosNeedingAttention.count,
    totalMonitors: data.totalMonitors,
    totalSlos: data.totalSlos,
  };
};
