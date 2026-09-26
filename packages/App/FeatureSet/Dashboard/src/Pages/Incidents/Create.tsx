import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import Incident from "Common/Models/DatabaseModels/Incident";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Card from "Common/UI/Components/Card/Card";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../Components/AffectedResources/AffectedResourcesPicker";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ProjectUtil from "Common/UI/Utils/Project";
import Label from "Common/Models/DatabaseModels/Label";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import IncidentTemplateOwnerTeam from "Common/Models/DatabaseModels/IncidentTemplateOwnerTeam";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IncidentTemplateOwnerUser from "Common/Models/DatabaseModels/IncidentTemplateOwnerUser";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FetchLabels from "../../Components/Label/FetchLabels";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FetchMonitorStatuses from "../../Components/MonitorStatus/FetchMonitorStatuses";
import FetchOnCallDutyPolicies from "../../Components/OnCallPolicy/FetchOnCallPolicies";
import FetchMonitors from "../../Components/Monitor/FetchMonitors";
import FetchIncidentSeverities from "../../Components/IncidentSeverity/FetchIncidentSeverity";
import FetchIncidentState from "../../Components/IncidentState/FetchIncidentState";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import IncidentRoleFormField, {
  RoleAssignment,
} from "../../Components/Incident/IncidentRoleFormField";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import IncidentMember from "Common/Models/DatabaseModels/IncidentMember";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import UserUtil from "Common/UI/Utils/User";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Includes from "Common/Types/BaseDatabase/Includes";
import AlertBanner, { AlertType } from "Common/UI/Components/Alerts/Alert";
import AlertElement from "../../Components/Alert/Alert";
import {
  INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
  INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM,
  MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
} from "Common/Types/Incident/IncidentAlertLink";
import IncidentFromAlerts, {
  AlertForIncidentPrefill,
  AlertsToAcknowledge,
  AlertStateForAcknowledgement,
  IncidentPrefillFromAlerts,
  NamedResource,
  ParsedAlertIds,
  SeverityForMapping,
} from "Common/Utils/Incident/IncidentFromAlerts";
import IconProp from "Common/Types/Icon/IconProp";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import {
  ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE,
  getAcknowledgeAlertsDescription,
  getAcknowledgeAlertsGate,
  getAcknowledgeAlertsTitle,
  getAlertsKeepEscalatingNote,
} from "../../Components/Incident/AcknowledgeAlertsOnDeclare";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import IncidentAlert from "Common/Models/DatabaseModels/IncidentAlert";
import Link from "Common/UI/Components/Link/Link";

/*
 * The fetched models, reduced to the plain shapes the prefill rules work on.
 */
type ToNamedResourceFunction = (resource: {
  _id?: string | undefined;
  name?: string | undefined;
}) => NamedResource;

const toNamedResource: ToNamedResourceFunction = (resource: {
  _id?: string | undefined;
  name?: string | undefined;
}): NamedResource => {
  return {
    _id: resource._id?.toString() || "",
    name: resource.name?.toString() || "",
  };
};

type ToAlertForPrefillFunction = (alert: Alert) => AlertForIncidentPrefill;

const toAlertForPrefill: ToAlertForPrefillFunction = (
  alert: Alert,
): AlertForIncidentPrefill => {
  return {
    id: alert._id?.toString() || "",
    title: alert.title,
    description: alert.description,
    alertNumber: alert.alertNumber,
    alertNumberWithPrefix: alert.alertNumberWithPrefix,
    alertSeverityId: alert.alertSeverityId?.toString(),
    monitor: alert.monitor?._id ? toNamedResource(alert.monitor) : undefined,
    hosts: (alert.hosts || []).map(toNamedResource),
    kubernetesClusters: (alert.kubernetesClusters || []).map(toNamedResource),
    dockerHosts: (alert.dockerHosts || []).map(toNamedResource),
    podmanHosts: (alert.podmanHosts || []).map(toNamedResource),
    services: (alert.services || []).map(toNamedResource),
    labelIds: (alert.labels || [])
      .map((label: Label): string => {
        return label._id?.toString() || "";
      })
      .filter((labelId: string): boolean => {
        return Boolean(labelId);
      }),
    isPrivate: Boolean(alert.isPrivate),
  };
};

type ToSeverityForMappingFunction = (
  severity: AlertSeverity | IncidentSeverity,
) => SeverityForMapping;

const toSeverityForMapping: ToSeverityForMappingFunction = (
  severity: AlertSeverity | IncidentSeverity,
): SeverityForMapping => {
  return {
    id: severity._id?.toString() || "",
    name: severity.name,
    order: severity.order,
  };
};

type GetAlreadyLinkedNoteFunction = (
  alerts: Array<Alert>,
  incidentsLinkedToAlerts: Map<string, Array<Incident>>,
) => string;

/*
 * When every alert already has an incident there is nothing left to link,
 * so the useful step is that incident; when only some do, the others can
 * still be linked to it instead of declaring another one.
 */
const getAlreadyLinkedNote: GetAlreadyLinkedNoteFunction = (
  alerts: Array<Alert>,
  incidentsLinkedToAlerts: Map<string, Array<Incident>>,
): string => {
  const isEveryAlertLinked: boolean = alerts.every((alert: Alert): boolean => {
    return (
      (incidentsLinkedToAlerts.get(alert._id?.toString() || "") || []).length >
      0
    );
  });

  if (isEveryAlertLinked) {
    return alerts.length === 1
      ? "This alert is already linked to an incident. If it is the same problem, update that incident instead of declaring another one."
      : "These alerts are already linked to incidents. If it is the same problem, update that incident instead of declaring another one.";
  }

  return "Some of these alerts are already linked to an incident. If it is the same problem, link the other alerts to that incident from the alerts list instead of declaring another one.";
};

type GetIncidentReferenceFunction = (incident: Incident) => string;

// "Incident INC-42" / "Incident #42", as the link pages list incidents.
const getIncidentReference: GetIncidentReferenceFunction = (
  incident: Incident,
): string => {
  if (incident.incidentNumberWithPrefix) {
    return `Incident ${incident.incidentNumberWithPrefix}`;
  }

  if (typeof incident.incidentNumber === "number") {
    return `Incident #${incident.incidentNumber}`;
  }

  return "Incident";
};

const IncidentCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const roleAssignmentsRef: React.MutableRefObject<Array<RoleAssignment>> =
    useRef<Array<RoleAssignment>>([]);

  const [initialValuesForIncident, setInitialValuesForIncident] =
    useState<JSONObject>({});

  /*
   * The alerts this incident is being declared from (`?alertIds=`), in the
   * order the link listed them. Only alerts that could be read are kept: the
   * server refuses the whole declaration over an alert it cannot find, so an
   * alert deleted since the link was made must not take the incident down
   * with it.
   */
  const [alertsToLink, setAlertsToLink] = useState<Array<Alert>>([]);
  const [missingAlertCount, setMissingAlertCount] = useState<number>(0);
  const [wereAlertIdsTruncated, setWereAlertIdsTruncated] =
    useState<boolean>(false);
  /*
   * A private alert makes the declared incident private, and a private
   * incident is visible only to its owners (and project admins). The server
   * makes the alerts' owners the incident's owners, so the people who could
   * see the alert can see the incident; the banner says so up front.
   */
  const [isPrivateFromAlerts, setIsPrivateFromAlerts] =
    useState<boolean>(false);
  /*
   * Declaring the incident does not, on its own, stop the alerts escalating:
   * only acknowledging an alert does. So the page offers to acknowledge the
   * alerts that are not acknowledged yet as the incident is declared, ticked
   * by default - whoever declares an incident from an alert is responding to
   * it. Null when that is not on offer (every alert is acknowledged already,
   * or the alert states could not be read).
   */
  const [alertsToAcknowledge, setAlertsToAcknowledge] =
    useState<AlertsToAcknowledge | null>(null);
  const [shouldAcknowledgeAlerts, setShouldAcknowledgeAlerts] =
    useState<boolean>(true);
  /*
   * Incidents the alerts are already linked to, by alert id. Declaring is a
   * click away on an alert's page, and several responders can land on the
   * same alert in an outage, so the banner says when an alert already has an
   * incident - a hint, never a block.
   */
  const [incidentsLinkedToAlerts, setIncidentsLinkedToAlerts] = useState<
    Map<string, Array<Incident>>
  >(new Map());

  useEffect(() => {
    const incidentTemplateId: string | null =
      Navigation.getQueryStringByName("incidentTemplateId");

    const parsedAlertIds: ParsedAlertIds =
      IncidentFromAlerts.parseAlertIdsQueryParam(
        Navigation.getQueryStringByName(INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM),
      );

    if (parsedAlertIds.alertIds.length > 0) {
      fetchInitialValuesFromAlerts(
        parsedAlertIds,
        incidentTemplateId ? new ObjectID(incidentTemplateId) : null,
      );
    } else if (incidentTemplateId) {
      fetchIncidentTemplate(new ObjectID(incidentTemplateId));
    } else {
      // Fetch the first incident state to set as default
      fetchFirstIncidentState();
      setIsLoading(false);
    }
  }, []);

  const getFirstIncidentStateId: () => Promise<
    string | null
  > = async (): Promise<string | null> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      return null;
    }

    try {
      const incidentStates: ListResult<IncidentState> =
        await ModelAPI.getList<IncidentState>({
          modelType: IncidentState,
          query: {
            projectId: projectId,
          },
          limit: 1,
          skip: 0,
          select: {
            _id: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      return incidentStates.data[0]?._id?.toString() || null;
    } catch {
      // Silently fail to avoid breaking the form
      return null;
    }
  };

  const fetchFirstIncidentState: () => Promise<void> =
    async (): Promise<void> => {
      const firstStateId: string | null = await getFirstIncidentStateId();

      if (firstStateId) {
        setInitialValuesForIncident((prev: JSONObject) => {
          return {
            ...prev,
            currentIncidentState: firstStateId,
          };
        });
      }
    };

  const fetchIncidentTemplate: (id: ObjectID) => Promise<void> = async (
    id: ObjectID,
  ): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const initialValue: JSONObject | null =
        await getIncidentTemplateInitialValues(id);

      if (initialValue) {
        setInitialValuesForIncident(initialValue);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  /*
   * Declaring from alerts: everything is fetched before the loader comes
   * down, because the form latches its initial values on first render and
   * ignores later changes to them.
   */
  const fetchInitialValuesFromAlerts: (
    parsedAlertIds: ParsedAlertIds,
    incidentTemplateId: ObjectID | null,
  ) => Promise<void> = async (
    parsedAlertIds: ParsedAlertIds,
    incidentTemplateId: ObjectID | null,
  ): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      let initialValues: JSONObject = {};

      if (incidentTemplateId) {
        initialValues =
          (await getIncidentTemplateInitialValues(incidentTemplateId)) || {};
      } else {
        const firstStateId: string | null = await getFirstIncidentStateId();

        if (firstStateId) {
          initialValues["currentIncidentState"] = firstStateId;
        }
      }

      const [
        alerts,
        alertSeverities,
        incidentSeverities,
        alertStates,
        existingLinks,
      ]: [
        Array<Alert>,
        Array<SeverityForMapping>,
        Array<SeverityForMapping>,
        Array<AlertStateForAcknowledgement> | null,
        Map<string, Array<Incident>>,
      ] = await Promise.all([
        fetchAlertsToLink(parsedAlertIds.alertIds),
        fetchAlertSeverities(),
        fetchIncidentSeverities(),
        fetchAlertStates(),
        fetchIncidentsLinkedToAlerts(parsedAlertIds.alertIds),
      ]);

      const prefill: IncidentPrefillFromAlerts =
        IncidentFromAlerts.buildIncidentPrefill({
          alerts: alerts.map(toAlertForPrefill),
          alertSeverities: alertSeverities,
          incidentSeverities: incidentSeverities,
        });

      const toAcknowledge: AlertsToAcknowledge | null = alertStates
        ? IncidentFromAlerts.getAlertsToAcknowledge({
            alerts: alerts.map((alert: Alert) => {
              return {
                id: alert._id?.toString() || "",
                currentAlertStateId: alert.currentAlertStateId?.toString(),
              };
            }),
            alertStates: alertStates,
          })
        : null;

      setAlertsToLink(alerts);
      setIncidentsLinkedToAlerts(existingLinks);
      setAlertsToAcknowledge(
        toAcknowledge && toAcknowledge.alertIds.length > 0
          ? toAcknowledge
          : null,
      );
      setMissingAlertCount(parsedAlertIds.alertIds.length - alerts.length);
      setWereAlertIdsTruncated(parsedAlertIds.wasTruncated);
      setIsPrivateFromAlerts(prefill.isPrivate);
      setInitialValuesForIncident(
        IncidentFromAlerts.applyPrefillToInitialValues(initialValues, prefill),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const fetchAlertsToLink: (
    alertIds: Array<string>,
  ) => Promise<Array<Alert>> = async (
    alertIds: Array<string>,
  ): Promise<Array<Alert>> => {
    const result: ListResult<Alert> = await ModelAPI.getList<Alert>({
      modelType: Alert,
      query: {
        _id: new Includes(alertIds),
      },
      limit: MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
      skip: 0,
      select: {
        _id: true,
        title: true,
        description: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        alertSeverityId: true,
        currentAlertStateId: true,
        isPrivate: true,
        monitor: { _id: true, name: true },
        hosts: { _id: true, name: true },
        kubernetesClusters: { _id: true, name: true },
        dockerHosts: { _id: true, name: true },
        podmanHosts: { _id: true, name: true },
        services: { _id: true, name: true },
        labels: { _id: true },
      },
      sort: {},
    });

    // Keep the order the link listed the alerts in.
    return alertIds
      .map((alertId: string): Alert | undefined => {
        return result.data.find((alert: Alert) => {
          return alert._id?.toString() === alertId;
        });
      })
      .filter((alert: Alert | undefined): boolean => {
        return Boolean(alert);
      }) as Array<Alert>;
  };

  /*
   * Severities only steer the prefill. Without them the severity is simply
   * left for the user to pick, so a failed read must not block the page.
   */
  const fetchAlertSeverities: () => Promise<
    Array<SeverityForMapping>
  > = async (): Promise<Array<SeverityForMapping>> => {
    try {
      const result: ListResult<AlertSeverity> =
        await ModelAPI.getList<AlertSeverity>({
          modelType: AlertSeverity,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { _id: true, name: true, order: true },
          sort: { order: SortOrder.Ascending },
        });

      return result.data.map(toSeverityForMapping);
    } catch {
      return [];
    }
  };

  /*
   * Only a hint on the banner, so a failed read (or no permission to read
   * links) leaves it out rather than block the page. A private incident's
   * links are not returned to somebody who cannot see it.
   */
  const fetchIncidentsLinkedToAlerts: (
    alertIds: Array<string>,
  ) => Promise<Map<string, Array<Incident>>> = async (
    alertIds: Array<string>,
  ): Promise<Map<string, Array<Incident>>> => {
    const byAlertId: Map<string, Array<Incident>> = new Map();

    try {
      const result: ListResult<IncidentAlert> =
        await ModelAPI.getList<IncidentAlert>({
          modelType: IncidentAlert,
          query: {
            alertId: new Includes(alertIds),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            alertId: true,
            incident: {
              _id: true,
              incidentNumber: true,
              incidentNumberWithPrefix: true,
            },
          },
          sort: {
            createdAt: SortOrder.Ascending,
          },
        });

      for (const link of result.data) {
        const alertId: string = link.alertId?.toString() || "";

        if (!alertId || !link.incident?._id) {
          continue;
        }

        const incidents: Array<Incident> = byAlertId.get(alertId) || [];
        incidents.push(link.incident);
        byAlertId.set(alertId, incidents);
      }
    } catch {
      return new Map();
    }

    return byAlertId;
  };

  /*
   * The alert states only decide whether to offer acknowledging the alerts.
   * A failed read leaves that offer out (null) rather than block the page.
   */
  const fetchAlertStates: () => Promise<Array<AlertStateForAcknowledgement> | null> =
    async (): Promise<Array<AlertStateForAcknowledgement> | null> => {
      try {
        const result: ListResult<AlertState> =
          await ModelAPI.getList<AlertState>({
            modelType: AlertState,
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { _id: true, order: true, isAcknowledgedState: true },
            sort: { order: SortOrder.Ascending },
          });

        return result.data.map(
          (state: AlertState): AlertStateForAcknowledgement => {
            return {
              id: state._id?.toString() || "",
              order: state.order,
              isAcknowledgedState: state.isAcknowledgedState,
            };
          },
        );
      } catch {
        return null;
      }
    };

  const fetchIncidentSeverities: () => Promise<
    Array<SeverityForMapping>
  > = async (): Promise<Array<SeverityForMapping>> => {
    try {
      const result: ListResult<IncidentSeverity> =
        await ModelAPI.getList<IncidentSeverity>({
          modelType: IncidentSeverity,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { _id: true, name: true, order: true },
          sort: { order: SortOrder.Ascending },
        });

      return result.data.map(toSeverityForMapping);
    } catch {
      return [];
    }
  };

  const getIncidentTemplateInitialValues: (
    id: ObjectID,
  ) => Promise<JSONObject | null> = async (
    id: ObjectID,
  ): Promise<JSONObject | null> => {
    //fetch incident template

    const incidentTemplate: IncidentTemplate | null =
      await ModelAPI.getItem<IncidentTemplate>({
        modelType: IncidentTemplate,
        id: id,
        select: {
          title: true,
          description: true,
          incidentSeverityId: true,
          initialIncidentStateId: true,
          /*
           * Pull `name` alongside `_id` for every affected-resource
           * relation. `relation: true` on the server collapses to
           * `{ _id: true }` for security, which leaves the picker with
           * IDs only and forces its "Unnamed Monitor" fallback.
           */
          monitors: { _id: true, name: true },
          hosts: { _id: true, name: true },
          kubernetesClusters: { _id: true, name: true },
          dockerHosts: { _id: true, name: true },
          podmanHosts: { _id: true, name: true },
          services: { _id: true, name: true },
          onCallDutyPolicies: true,
          labels: true,
          changeMonitorStatusToId: true,
        },
      });

    const teamsListResult: ListResult<IncidentTemplateOwnerTeam> =
      await ModelAPI.getList<IncidentTemplateOwnerTeam>({
        modelType: IncidentTemplateOwnerTeam,
        query: {
          incidentTemplate: id,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          teamId: true,
        },
        sort: {},
      });

    const usersListResult: ListResult<IncidentTemplateOwnerUser> =
      await ModelAPI.getList<IncidentTemplateOwnerUser>({
        modelType: IncidentTemplateOwnerUser,
        query: {
          incidentTemplate: id,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          userId: true,
        },
        sort: {},
      });

    if (incidentTemplate) {
      const initialValue: JSONObject = {
        ...BaseModel.toJSONObject(incidentTemplate, IncidentTemplate),
        incidentSeverity: incidentTemplate.incidentSeverityId?.toString(),
        currentIncidentState:
          incidentTemplate.initialIncidentStateId?.toString(),
        /*
         * Keep `{_id, name}` shape (not bare ID strings) so the picker can
         * render the resource's real name on first paint and seed its
         * name cache for subsequent picker writes.
         */
        monitors: incidentTemplate.monitors?.map((monitor: Monitor) => {
          return {
            _id: monitor.id!.toString(),
            name: monitor.name || "",
          };
        }),
        hosts: incidentTemplate.hosts?.map((host: Host) => {
          return {
            _id: host.id!.toString(),
            name: host.name || "",
          };
        }),
        kubernetesClusters: incidentTemplate.kubernetesClusters?.map(
          (cluster: KubernetesCluster) => {
            return {
              _id: cluster.id!.toString(),
              name: cluster.name || "",
            };
          },
        ),
        dockerHosts: incidentTemplate.dockerHosts?.map(
          (dockerHost: DockerHost) => {
            return {
              _id: dockerHost.id!.toString(),
              name: dockerHost.name || "",
            };
          },
        ),
        podmanHosts: incidentTemplate.podmanHosts?.map(
          (podmanHost: PodmanHost) => {
            return {
              _id: podmanHost.id!.toString(),
              name: podmanHost.name || "",
            };
          },
        ),
        services: incidentTemplate.services?.map((service: Service) => {
          return {
            _id: service.id!.toString(),
            name: service.name || "",
          };
        }),
        labels: incidentTemplate.labels?.map((label: Label) => {
          return label.id!.toString();
        }),
        changeMonitorStatusTo:
          incidentTemplate.changeMonitorStatusToId?.toString(),
        onCallDutyPolicies: incidentTemplate.onCallDutyPolicies?.map(
          (onCallPolicy: OnCallDutyPolicy) => {
            return onCallPolicy.id!.toString();
          },
        ),
        ownerUsers: usersListResult.data.map(
          (user: IncidentTemplateOwnerUser): string => {
            return user.userId!.toString() || "";
          },
        ),
        ownerTeams: teamsListResult.data.map(
          (team: IncidentTemplateOwnerTeam): string => {
            return team.teamId!.toString() || "";
          },
        ),
      };

      return initialValue;
    }

    return null;
  };

  /*
   * A missing permission is shown - the box locked, saying why - and an
   * unknown answer (the permission snapshot has not loaded) leaves the box
   * out, like every other gate. The server checks again, per alert.
   */
  const acknowledgeGate: PermissionGateResult = getAcknowledgeAlertsGate();

  const isAcknowledgeOffered: boolean =
    alertsToAcknowledge !== null &&
    (acknowledgeGate.isAllowed || Boolean(acknowledgeGate.disabledReason));

  const willAcknowledgeAlerts: boolean =
    alertsToAcknowledge !== null &&
    acknowledgeGate.isAllowed &&
    shouldAcknowledgeAlerts;

  return (
    <Fragment>
      <Card
        title="Declare New Incident"
        description={
          "Declare a new incident to let your team know what's going on and how to respond."
        }
        className="mb-10"
      >
        <div>
          {isLoading && <PageLoader isVisible={true} />}
          {error && <ErrorMessage message={error} />}
          {!isLoading && !error && alertsToLink.length > 0 && (
            <AlertBanner
              className="mb-5"
              dataTestId="incident-create-alerts-to-link"
              type={AlertType.INFO}
              icon={IconProp.Link}
              strongTitle="Declaring this incident from alerts"
              title={
                <div>
                  <p>
                    These alerts are linked to the incident when you declare it.
                    The form below is prefilled from them - review and change
                    anything before you declare.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {alertsToLink.map((alert: Alert): ReactElement => {
                      const linkedIncidents: Array<Incident> =
                        incidentsLinkedToAlerts.get(
                          alert._id?.toString() || "",
                        ) || [];

                      return (
                        <li key={alert._id?.toString()}>
                          <span className="mr-1 font-medium">
                            {IncidentFromAlerts.getAlertReference(
                              toAlertForPrefill(alert),
                            )}
                            :
                          </span>
                          <AlertElement alert={alert} />
                          {linkedIncidents.length > 0 && (
                            <span
                              className="ml-1"
                              data-testid="incident-create-alert-already-linked"
                            >
                              (already linked to{" "}
                              {linkedIncidents.map(
                                (
                                  incident: Incident,
                                  index: number,
                                ): ReactElement => {
                                  return (
                                    <Fragment key={incident._id?.toString()}>
                                      {index > 0 ? ", " : ""}
                                      <Link
                                        className="font-medium underline"
                                        openInNewTab={true}
                                        to={RouteUtil.populateRouteParams(
                                          RouteMap[
                                            PageMap.INCIDENT_VIEW
                                          ] as Route,
                                          {
                                            modelId: new ObjectID(
                                              incident._id!.toString(),
                                            ),
                                          },
                                        )}
                                      >
                                        {getIncidentReference(incident)}
                                      </Link>
                                    </Fragment>
                                  );
                                },
                              )}
                              )
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {alertsToLink.some((alert: Alert): boolean => {
                    return (
                      (
                        incidentsLinkedToAlerts.get(
                          alert._id?.toString() || "",
                        ) || []
                      ).length > 0
                    );
                  }) && (
                    <p
                      className="mt-2"
                      data-testid="incident-create-alerts-already-linked-note"
                    >
                      {getAlreadyLinkedNote(
                        alertsToLink,
                        incidentsLinkedToAlerts,
                      )}
                    </p>
                  )}
                  {isPrivateFromAlerts && (
                    <p
                      className="mt-2"
                      data-testid="incident-create-private-from-alerts"
                    >
                      At least one of these alerts is private, so Private
                      Incident starts switched on. While it stays on, only the
                      incident&apos;s owners, project owners and project admins
                      can see it, and the owners of these alerts are added as
                      its owners once it is declared.
                    </p>
                  )}
                  {wereAlertIdsTruncated && (
                    <p className="mt-2">
                      Only the first {MAX_ALERTS_PER_INCIDENT_LINK_ACTION}{" "}
                      alerts are linked. Link the rest from the incident&apos;s
                      Linked Alerts page after you declare it.
                    </p>
                  )}
                  {missingAlertCount > 0 && (
                    <p className="mt-2">
                      Some alerts could not be found, so they are not linked.
                      They may have been deleted, or you may not have access to
                      them.
                    </p>
                  )}
                  {isAcknowledgeOffered && alertsToAcknowledge && (
                    <div
                      className="mt-3"
                      data-testid="incident-create-acknowledge-alerts"
                    >
                      <CheckboxElement
                        dataTestId="incident-create-acknowledge-alerts-checkbox"
                        title={getAcknowledgeAlertsTitle(
                          alertsToAcknowledge,
                          alertsToLink.length,
                        )}
                        description={getAcknowledgeAlertsDescription(
                          alertsToAcknowledge,
                          acknowledgeGate.disabledReason,
                        )}
                        value={willAcknowledgeAlerts}
                        disabled={!acknowledgeGate.isAllowed}
                        hoverText={acknowledgeGate.disabledReason}
                        onChange={(value: boolean) => {
                          setShouldAcknowledgeAlerts(value);
                        }}
                      />
                    </div>
                  )}
                  {alertsToAcknowledge && !willAcknowledgeAlerts && (
                    <p
                      className="mt-2"
                      data-testid="incident-create-alerts-keep-escalating"
                    >
                      {getAlertsKeepEscalatingNote(
                        alertsToAcknowledge,
                        alertsToLink.length,
                      )}
                    </p>
                  )}
                </div>
              }
            />
          )}
          {!isLoading &&
            !error &&
            alertsToLink.length === 0 &&
            missingAlertCount > 0 && (
              <AlertBanner
                className="mb-5"
                dataTestId="incident-create-alerts-not-found"
                type={AlertType.WARNING}
                strongTitle="The alerts could not be found"
                title="None of the alerts this incident was being declared from could be found, so none will be linked. They may have been deleted, or you may not have access to them."
              />
            )}
          {!isLoading && !error && (
            <ModelForm<Incident>
              modelType={Incident}
              initialValues={initialValuesForIncident}
              name="Create New Incident"
              id="create-incident-form"
              onBeforeCreate={async (
                item: Incident,
                miscDataProps: JSONObject,
              ): Promise<Incident> => {
                /*
                 * ModelForm sends this same object as the request's
                 * miscDataProps. The server checks the ids before it creates
                 * the incident and links them once it exists.
                 */
                if (alertsToLink.length > 0) {
                  miscDataProps[INCIDENT_ALERT_IDS_TO_LINK_KEY] =
                    alertsToLink.map((alert: Alert): string => {
                      return alert._id?.toString() || "";
                    });

                  /*
                   * Only sent when the box is on screen, allowed and
                   * ticked: the server then acknowledges the alerts (the
                   * ones not acknowledged yet) as this user once they are
                   * linked.
                   */
                  if (willAcknowledgeAlerts) {
                    miscDataProps[INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY] =
                      true;
                  }
                }

                return item;
              }}
              fields={[
                {
                  field: {
                    title: true,
                  },
                  title: "Title",
                  fieldType: FormFieldSchemaType.Text,
                  stepId: "incident-details",
                  required: true,
                  placeholder: "Incident Title",
                  validation: {
                    minLength: 2,
                  },
                },
                {
                  field: {
                    description: true,
                  },
                  title: "Description",
                  stepId: "incident-details",
                  fieldType: FormFieldSchemaType.Markdown,
                  required: false,
                  description: MarkdownUtil.getMarkdownCheatsheet(
                    "Describe the incident details here",
                  ),
                },
                {
                  field: {
                    declaredAt: true,
                  },
                  title: "Declared At",
                  stepId: "incident-details",
                  description: "When was this incident first declared?",
                  fieldType: FormFieldSchemaType.DateTime,
                  required: true,
                  placeholder: "Pick date and time",
                  getDefaultValue: () => {
                    return OneUptimeDate.getCurrentDate();
                  },
                },
                {
                  field: {
                    incidentSeverity: true,
                  },
                  title: "Incident Severity",
                  stepId: "incident-details",
                  description: "What type of incident is this?",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: IncidentSeverity,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: true,
                  placeholder: "Incident Severity",
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (!item.incidentSeverity) {
                      return <p>No incident severity selected.</p>;
                    }

                    return (
                      <FetchIncidentSeverities
                        incidentSeverityIds={[
                          new ObjectID(item.incidentSeverity.toString()),
                        ]}
                      />
                    );
                  },
                },
                {
                  field: {
                    currentIncidentState: true,
                  },
                  title: "Incident State",
                  stepId: "incident-details",
                  description:
                    "Select the initial state for this incident to be in.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: IncidentState,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select Initial State",
                  fetchDropdownOptions: async () => {
                    const projectId: ObjectID | null =
                      ProjectUtil.getCurrentProjectId();
                    if (!projectId) {
                      return [];
                    }

                    try {
                      const incidentStates: ListResult<IncidentState> =
                        await ModelAPI.getList<IncidentState>({
                          modelType: IncidentState,
                          query: {
                            projectId: projectId,
                          },
                          limit: LIMIT_PER_PROJECT,
                          skip: 0,
                          select: {
                            _id: true,
                            name: true,
                            color: true,
                          },
                          sort: {
                            order: SortOrder.Ascending,
                          },
                        });

                      return incidentStates.data.map(
                        (state: IncidentState): DropdownOption => {
                          const option: DropdownOption = {
                            label: state.name || "",
                            value: state._id?.toString() || "",
                            color: state.color as Color,
                          };

                          return option;
                        },
                      );
                    } catch {
                      // Silently fail and return empty array
                      return [];
                    }
                  },
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (!item.currentIncidentState) {
                      return <p>Will use first available state by priority</p>;
                    }

                    return (
                      <FetchIncidentState
                        incidentStateId={
                          new ObjectID(item.currentIncidentState.toString())
                        }
                      />
                    );
                  },
                },
                {
                  field: {
                    monitors: true,
                  },
                  title: "Resources Affected",
                  stepId: "resources-affected",
                  description:
                    "Search and attach monitors, hosts, Kubernetes clusters, Docker hosts, databases, or services affected by this incident.",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: false,
                  getCustomElement: (
                    values: FormValues<Incident>,
                    elementProps: CustomElementProps,
                  ) => {
                    return (
                      <AffectedResourcesPicker
                        monitors={values.monitors as Array<Monitor>}
                        hosts={values.hosts as Array<Host>}
                        kubernetesClusters={
                          values.kubernetesClusters as Array<KubernetesCluster>
                        }
                        dockerHosts={values.dockerHosts as Array<DockerHost>}
                        podmanHosts={values.podmanHosts as Array<PodmanHost>}
                        databaseServers={
                          values.databaseServers as Array<DatabaseServer>
                        }
                        services={values.services as Array<Service>}
                        resourceTypes={[
                          "Monitor",
                          "Host",
                          "KubernetesCluster",
                          "DockerHost",
                          "PodmanHost",
                          "DatabaseServer",
                          "Service",
                        ]}
                        onChange={(payload: unknown) => {
                          elementProps.onChange?.(payload);
                        }}
                      />
                    );
                  },
                  onChange: (
                    value: unknown,
                    currentValues: FormValues<Incident>,
                    setNewFormValues: (values: FormValues<Incident>) => void,
                  ) => {
                    /*
                     * Defer the split so it runs after FormField's internal
                     * setFieldValue overwrites the field with our payload.
                     */
                    if (isAffectedResourcesPayload(value)) {
                      const payload: typeof value = value;
                      queueMicrotask(() => {
                        setNewFormValues({
                          ...currentValues,
                          monitors: payload.monitors,
                          hosts: payload.hosts,
                          kubernetesClusters: payload.kubernetesClusters,
                          dockerHosts: payload.dockerHosts,
                          podmanHosts: payload.podmanHosts,
                          databaseServers: payload.databaseServers,
                          services: payload.services,
                        } as FormValues<Incident>);
                      });
                    }
                  },
                  getSummaryElement: (item: FormValues<Incident>) => {
                    const monitorIds: Array<ObjectID> = [];
                    if (Array.isArray(item.monitors)) {
                      for (const monitor of item.monitors) {
                        if (typeof monitor === "string") {
                          monitorIds.push(new ObjectID(monitor));
                          continue;
                        }
                        if (monitor instanceof ObjectID) {
                          monitorIds.push(monitor);
                          continue;
                        }
                        if (monitor instanceof Monitor) {
                          monitorIds.push(
                            new ObjectID(monitor._id?.toString() || ""),
                          );
                          continue;
                        }
                        const anyMonitor: { _id?: unknown } = monitor as {
                          _id?: unknown;
                        };
                        if (anyMonitor._id) {
                          monitorIds.push(new ObjectID(String(anyMonitor._id)));
                        }
                      }
                    }
                    const hostsCount: number = Array.isArray(item.hosts)
                      ? item.hosts.length
                      : 0;
                    const clustersCount: number = Array.isArray(
                      item.kubernetesClusters,
                    )
                      ? item.kubernetesClusters.length
                      : 0;
                    const dockerCount: number = Array.isArray(item.dockerHosts)
                      ? item.dockerHosts.length
                      : 0;
                    const podmanCount: number = Array.isArray(item.podmanHosts)
                      ? item.podmanHosts.length
                      : 0;
                    const databasesCount: number = Array.isArray(
                      item.databaseServers,
                    )
                      ? item.databaseServers.length
                      : 0;
                    const servicesCount: number = Array.isArray(item.services)
                      ? item.services.length
                      : 0;
                    const totalCount: number =
                      monitorIds.length +
                      hostsCount +
                      clustersCount +
                      dockerCount +
                      podmanCount +
                      databasesCount +
                      servicesCount;
                    if (totalCount === 0) {
                      return <p>No resources affected by this incident.</p>;
                    }
                    const otherCounts: Array<string> = [];
                    if (hostsCount > 0) {
                      otherCounts.push(
                        `${hostsCount} host${hostsCount === 1 ? "" : "s"}`,
                      );
                    }
                    if (clustersCount > 0) {
                      otherCounts.push(
                        `${clustersCount} Kubernetes cluster${clustersCount === 1 ? "" : "s"}`,
                      );
                    }
                    if (dockerCount > 0) {
                      otherCounts.push(
                        `${dockerCount} Docker host${dockerCount === 1 ? "" : "s"}`,
                      );
                    }
                    if (podmanCount > 0) {
                      otherCounts.push(
                        `${podmanCount} Podman host${podmanCount === 1 ? "" : "s"}`,
                      );
                    }
                    if (databasesCount > 0) {
                      otherCounts.push(
                        `${databasesCount} database${databasesCount === 1 ? "" : "s"}`,
                      );
                    }
                    if (servicesCount > 0) {
                      otherCounts.push(
                        `${servicesCount} service${servicesCount === 1 ? "" : "s"}`,
                      );
                    }
                    return (
                      <div className="space-y-2">
                        {monitorIds.length > 0 && (
                          <div>
                            <div className="text-xs uppercase tracking-wide text-gray-500">
                              Monitors
                            </div>
                            <FetchMonitors monitorIds={monitorIds} />
                          </div>
                        )}
                        {otherCounts.length > 0 && (
                          <div className="text-sm text-gray-600">
                            {otherCounts.join(", ")}
                          </div>
                        )}
                      </div>
                    );
                  },
                },
                /*
                 * Hidden registrations so ModelForm.getSelectFields includes
                 * hosts/kubernetesClusters/dockerHosts/podmanHosts/
                 * databaseServers/services on load and submit.
                 */
                {
                  field: { hosts: true },
                  stepId: "resources-affected",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { kubernetesClusters: true },
                  stepId: "resources-affected",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { dockerHosts: true },
                  stepId: "resources-affected",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { podmanHosts: true },
                  stepId: "resources-affected",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { databaseServers: true },
                  stepId: "resources-affected",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { services: true },
                  stepId: "resources-affected",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  overrideField: {
                    incidentRoles: true,
                  },
                  showEvenIfPermissionDoesNotExist: true,
                  title: "Assign Incident Roles",
                  stepId: "incident-roles",
                  description:
                    "Assign team members to incident roles. Some roles allow multiple users.",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: false,
                  overrideFieldKey: "incidentRoles",
                  getCustomElement: (
                    _value: FormValues<Incident>,
                    props: CustomElementProps,
                  ) => {
                    return (
                      <IncidentRoleFormField
                        initialValue={roleAssignmentsRef.current}
                        onChange={(assignments: Array<RoleAssignment>) => {
                          roleAssignmentsRef.current = assignments;
                          if (props.onChange) {
                            props.onChange(assignments);
                          }
                        }}
                      />
                    );
                  },
                  getSummaryElement: (_item: FormValues<Incident>) => {
                    if (roleAssignmentsRef.current.length === 0) {
                      return <p>No incident roles assigned.</p>;
                    }
                    const totalAssignments: number =
                      roleAssignmentsRef.current.reduce(
                        (acc: number, assignment: RoleAssignment) => {
                          return acc + assignment.userIds.length;
                        },
                        0,
                      );
                    return (
                      <p>
                        {totalAssignments} user
                        {totalAssignments !== 1 ? "s" : ""} assigned to{" "}
                        {roleAssignmentsRef.current.length} role
                        {roleAssignmentsRef.current.length !== 1 ? "s" : ""}.
                      </p>
                    );
                  },
                },
                {
                  field: {
                    onCallDutyPolicies: true,
                  },
                  title: "On-Call Policy",
                  stepId: "on-call",
                  description:
                    "Select on-call duty policy to execute when this incident is created.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: OnCallDutyPolicy,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select on-call policies",
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (
                      !item.onCallDutyPolicies ||
                      !Array.isArray(item.onCallDutyPolicies) ||
                      item.onCallDutyPolicies.length === 0
                    ) {
                      return (
                        <p>
                          No on-call policies will be executed when this
                          incident is created.
                          {willAcknowledgeAlerts
                            ? ` ${ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE}`
                            : ""}
                        </p>
                      );
                    }

                    const onCallDutyPolicyIds: Array<ObjectID> = [];

                    for (const onCallDutyPolicy of item.onCallDutyPolicies) {
                      if (typeof onCallDutyPolicy === "string") {
                        onCallDutyPolicyIds.push(
                          new ObjectID(onCallDutyPolicy),
                        );
                        continue;
                      }

                      if (onCallDutyPolicy instanceof ObjectID) {
                        onCallDutyPolicyIds.push(onCallDutyPolicy);
                        continue;
                      }

                      if (onCallDutyPolicy instanceof OnCallDutyPolicy) {
                        onCallDutyPolicyIds.push(
                          new ObjectID(onCallDutyPolicy._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchOnCallDutyPolicies
                          onCallDutyPolicyIds={onCallDutyPolicyIds}
                        />
                      </div>
                    );
                  },
                },
                {
                  field: {
                    changeMonitorStatusTo: true,
                  },
                  title: "Change Monitor Status to ",
                  stepId: "resources-affected",
                  description:
                    "This will change the status of all the monitors attached to this incident.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: MonitorStatus,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Monitor Status",
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (!item.changeMonitorStatusTo) {
                      return (
                        <p>
                          Status of the monitors will not be changed when this
                          incident is created.
                        </p>
                      );
                    }

                    return (
                      <FetchMonitorStatuses
                        monitorStatusIds={[
                          new ObjectID(item.changeMonitorStatusTo.toString()),
                        ]}
                        shouldAnimate={false}
                      />
                    );
                  },
                },
                {
                  field: {
                    labels: true,
                  },

                  title: "Labels ",
                  stepId: "more",
                  description:
                    "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: Label,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Labels",
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (!item.labels || !Array.isArray(item.labels)) {
                      return <p>No labels assigned.</p>;
                    }

                    const labelIds: Array<ObjectID> = [];

                    for (const label of item.labels) {
                      if (typeof label === "string") {
                        labelIds.push(new ObjectID(label));
                        continue;
                      }

                      if (label instanceof ObjectID) {
                        labelIds.push(label);
                        continue;
                      }

                      if (label instanceof Label) {
                        labelIds.push(
                          new ObjectID(label._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchLabels labelIds={labelIds} />
                      </div>
                    );
                  },
                },
                {
                  field: {
                    shouldStatusPageSubscribersBeNotifiedOnIncidentCreated:
                      true,
                  },

                  title: "Notify Status Page Subscribers",
                  stepId: "more",
                  description:
                    "Should status page subscribers be notified when this incident is created?",
                  fieldType: FormFieldSchemaType.Checkbox,
                  defaultValue: true,
                  required: false,
                },
                {
                  field: {
                    isPrivate: true,
                  },
                  title: "Private Incident",
                  stepId: "more",
                  description:
                    "If checked, only the incident's owner users and the members of its owner teams (plus project admins and owners) can view this incident. Private incidents are automatically hidden from all status pages.",
                  fieldType: FormFieldSchemaType.Checkbox,
                  defaultValue: false,
                  required: false,
                },
              ]}
              steps={[
                {
                  title: "Incident Details",
                  id: "incident-details",
                },
                {
                  title: "Resources Affected",
                  id: "resources-affected",
                },
                {
                  title: "Incident Roles",
                  id: "incident-roles",
                },
                {
                  title: "On-Call",
                  id: "on-call",
                },
                {
                  title: "More",
                  id: "more",
                },
              ]}
              onSuccess={async (createdItem: Incident) => {
                // Create incident member records for role assignments
                const projectId: ObjectID | null =
                  ProjectUtil.getCurrentProjectId();
                const incidentId: ObjectID = new ObjectID(
                  createdItem._id?.toString() || "",
                );
                const currentUserId: ObjectID | null = UserUtil.getUserId();

                if (projectId) {
                  // Create role assignments from form
                  if (roleAssignmentsRef.current.length > 0) {
                    for (const assignment of roleAssignmentsRef.current) {
                      for (const userId of assignment.userIds) {
                        try {
                          const incidentMember: IncidentMember =
                            new IncidentMember();
                          incidentMember.projectId = projectId;
                          incidentMember.incidentId = incidentId;
                          incidentMember.incidentRoleId = new ObjectID(
                            assignment.roleId,
                          );
                          incidentMember.userId = new ObjectID(userId);

                          await ModelAPI.create({
                            model: incidentMember,
                            modelType: IncidentMember,
                          });
                        } catch {
                          // Continue with other assignments even if one fails
                        }
                      }
                    }
                  }

                  // Assign creator to primary roles if no one is assigned
                  if (currentUserId) {
                    try {
                      // Fetch primary roles
                      const primaryRolesResult: ListResult<IncidentRole> =
                        await ModelAPI.getList<IncidentRole>({
                          modelType: IncidentRole,
                          query: {
                            projectId: projectId,
                            isPrimaryRole: true,
                          },
                          limit: LIMIT_PER_PROJECT,
                          skip: 0,
                          select: {
                            _id: true,
                          },
                          sort: {},
                        });

                      // Get the role IDs that already have assignments
                      const assignedRoleIds: Set<string> = new Set(
                        roleAssignmentsRef.current
                          .filter((a: RoleAssignment) => {
                            return a.userIds.length > 0;
                          })
                          .map((a: RoleAssignment) => {
                            return a.roleId;
                          }),
                      );

                      // Assign creator to primary roles that don't have anyone assigned
                      for (const primaryRole of primaryRolesResult.data) {
                        const roleId: string = primaryRole.id!.toString();
                        if (!assignedRoleIds.has(roleId)) {
                          try {
                            const incidentMember: IncidentMember =
                              new IncidentMember();
                            incidentMember.projectId = projectId;
                            incidentMember.incidentId = incidentId;
                            incidentMember.incidentRoleId = primaryRole.id!;
                            incidentMember.userId = currentUserId;

                            await ModelAPI.create({
                              model: incidentMember,
                              modelType: IncidentMember,
                            });
                          } catch {
                            // Continue even if assignment fails
                          }
                        }
                      }
                    } catch {
                      // Continue even if fetching primary roles fails
                    }
                  }
                }

                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.INCIDENT_VIEW] as Route,
                      {
                        modelId: createdItem._id,
                      },
                    ),
                  ),
                );
              }}
              submitButtonText={"Declare Incident"}
              formType={FormType.Create}
              summary={{
                enabled: true,
              }}
            />
          )}
        </div>
      </Card>
    </Fragment>
  );
};

export default IncidentCreate;
