import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Card from "Common/UI/Components/Card/Card";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import MonitorLinkedResourcesPrefill, {
  MonitorLinkedResourcesPrefillState,
  useMonitorLinkedResourcesPrefillState,
} from "../../Components/AffectedResources/MonitorLinkedResourcesPrefill";
import { SCHEDULED_MAINTENANCE_PREFILL_PAYLOAD_KEYS } from "../../Components/AffectedResources/MonitorLinkedResourcesPrefillRules";
import AffectedResourcesPicker, {
  AffectedResourceType,
  isAffectedResourcesPayload,
} from "../../Components/AffectedResources/AffectedResourcesPicker";
import Label from "Common/Models/DatabaseModels/Label";
import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ScheduledMaintenanceTemplateOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerTeam";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ScheduledMaintenanceTemplateOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerUser";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  CustomElementProps,
  FieldFooterProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import RecurringArrayFieldElement from "Common/UI/Components/Events/RecurringArrayFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import FetchMonitorStatuses from "../../Components/MonitorStatus/FetchMonitorStatuses";
import FetchStatusPages from "../../Components/StatusPage/FetchStatusPages";
import { getStatusPageSuggestionsFooter } from "../../Components/StatusPage/StatusPageSuggestions";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import FetchLabels from "../../Components/Label/FetchLabels";
import RecurringArrayViewElement from "Common/UI/Components/Events/RecurringArrayViewElement";
import getOwnersFormField from "Common/UI/Components/PeoplePicker/OwnersFormField";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  getDefaultMaintenanceEndsAt,
  getDefaultMaintenanceStartsAt,
  getMaintenanceEndsAtError,
  getSubscriberNotificationsSection,
  moveMaintenanceEndWithStart,
} from "../../Components/ScheduledMaintenance/ScheduledMaintenanceForm";
import {
  hasPickedMonitors,
  omitMonitorStatusWithoutMonitors,
} from "../../Components/Incident/ChangeMonitorStatusField";
import {
  CreatedRecordKind,
  pickRecordToCreateFrom,
} from "../../Components/CreateFromRecord/CreateFromRecord";
import useRecordToCreateFrom, {
  RecordToCreateFromState,
} from "../../Components/CreateFromRecord/useRecordToCreateFrom";

/*
 * Two steps - Event and Resources Affected - and the review step (see
 * Components/ScheduledMaintenance/ScheduledMaintenanceForm for why). Built
 * once: BasicForm folds the fields next to each other that carry the same
 * section.
 */
const advancedSection: FormFieldCollapsibleSection<ScheduledMaintenance> =
  getAdvancedFormSection<ScheduledMaintenance>();

const subscriberNotificationsSection: FormFieldCollapsibleSection<ScheduledMaintenance> =
  getSubscriberNotificationsSection<ScheduledMaintenance>();

/*
 * The "Resources Affected" step asks for the event's monitors in a picker of
 * their own, with "Change Monitor Status to" right under them, and for
 * everything else it affects in a second picker - the shape of Declare
 * Incident. The maintainer, on the incident form: "we also need to have
 * monitors and other affected resources as seperate things (so change
 * monitor sttate to makes more sense), only show that dropdown if any
 * monitor is selected." The status acts on the monitors alone: they change
 * to it while the event is ongoing.
 *
 * Together the two pickers offer what the event's own Edit offers, split the
 * same way (Components/ScheduledMaintenance/
 * ScheduledMaintenanceAffectedResourcesFormFields), so an event created from
 * a Proxmox cluster's, a vCenter's, a Ceph or Docker Swarm cluster's, a
 * storage array's, an IoT fleet's or a network site's Scheduled Maintenance
 * tab keeps it picked (Components/CreateFromRecord). Each editor and its
 * review step's read-only picker take the same list, so the summary names
 * every type the editor lets the user pick.
 */
const MONITOR_RESOURCE_TYPES: Array<AffectedResourceType> = ["Monitor"];

const OTHER_AFFECTED_RESOURCE_TYPES: Array<AffectedResourceType> = [
  "Host",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "ProxmoxCluster",
  "VMwareVCenter",
  "CephCluster",
  "StorageArray",
  "DockerSwarmCluster",
  "IoTFleet",
  "DatabaseServer",
  "NetworkSite",
  "Service",
];

// Change Monitor Status to is asked only once the event has a monitor.
const hasMonitors: (values: FormValues<ScheduledMaintenance>) => boolean = (
  values: FormValues<ScheduledMaintenance>,
): boolean => {
  return hasPickedMonitors(values);
};

const ScheduledMaintenanceCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // What the picked monitors' linked resources added (survives step changes).
  const linkedResourcesPrefill: MutableRefObject<MonitorLinkedResourcesPrefillState> =
    useMonitorLinkedResourcesPrefillState();

  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [
    initialValuesForScheduledMaintenance,
    setInitialValuesForScheduledMaintenance,
  ] = useState<JSONObject>({});

  /*
   * The host, cluster, site or other resource whose Scheduled Maintenance
   * tab the page was opened from (?hostId=, ?networkSiteId=, ...): picked on
   * Resources Affected, ahead of a template's resources, and the breadcrumbs
   * go back through its tab. Opened from the project's list, there is none.
   */
  const recordToCreateFrom: RecordToCreateFromState = useRecordToCreateFrom(
    CreatedRecordKind.ScheduledMaintenance,
  );

  // One identity per load: the form latches its initial values once.
  const formInitialValues: JSONObject = useMemo(() => {
    return pickRecordToCreateFrom({
      values: initialValuesForScheduledMaintenance,
      record: recordToCreateFrom.record,
      created: CreatedRecordKind.ScheduledMaintenance,
    });
  }, [initialValuesForScheduledMaintenance, recordToCreateFrom.record]);

  const isPageLoading: boolean = isLoading || recordToCreateFrom.isLoading;

  useEffect(() => {
    if (Navigation.getQueryStringByName("scheduledMaintenanceTemplateId")) {
      fetchScheduledMaintenanceTemplate(
        new ObjectID(
          Navigation.getQueryStringByName("scheduledMaintenanceTemplateId") ||
            "",
        ),
      );
    } else {
      setIsLoading(false);
    }
  }, []);

  const fetchScheduledMaintenanceTemplate: (
    id: ObjectID,
  ) => Promise<void> = async (id: ObjectID): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      //fetch scheduledMaintenance template

      const scheduledMaintenanceTemplate: ScheduledMaintenanceTemplate | null =
        await ModelAPI.getItem<ScheduledMaintenanceTemplate>({
          modelType: ScheduledMaintenanceTemplate,
          id: id,
          select: {
            title: true,
            description: true,
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
            statusPages: true,
            labels: true,
            changeMonitorStatusToId: true,
            shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
            shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
            shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
              true,
            sendSubscriberNotificationsOnBeforeTheEvent: true,
          },
        });

      const teamsListResult: ListResult<ScheduledMaintenanceTemplateOwnerTeam> =
        await ModelAPI.getList<ScheduledMaintenanceTemplateOwnerTeam>({
          modelType: ScheduledMaintenanceTemplateOwnerTeam,
          query: {
            scheduledMaintenanceTemplate: id,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            teamId: true,
          },
          sort: {},
        });

      const usersListResult: ListResult<ScheduledMaintenanceTemplateOwnerUser> =
        await ModelAPI.getList<ScheduledMaintenanceTemplateOwnerUser>({
          modelType: ScheduledMaintenanceTemplateOwnerUser,
          query: {
            scheduledMaintenanceTemplate: id,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            userId: true,
          },
          sort: {},
        });

      if (scheduledMaintenanceTemplate) {
        const initialValue: JSONObject = {
          ...BaseModel.toJSONObject(
            scheduledMaintenanceTemplate,
            ScheduledMaintenanceTemplate,
          ),
          /*
           * Keep `{_id, name}` shape (not bare ID strings) so the picker can
           * render the resource's real name on first paint and seed its
           * name cache for subsequent picker writes.
           */
          monitors: scheduledMaintenanceTemplate.monitors?.map(
            (monitor: Monitor) => {
              return {
                _id: monitor.id!.toString(),
                name: monitor.name || "",
              };
            },
          ),
          hosts: scheduledMaintenanceTemplate.hosts?.map((host: Host) => {
            return {
              _id: host.id!.toString(),
              name: host.name || "",
            };
          }),
          kubernetesClusters:
            scheduledMaintenanceTemplate.kubernetesClusters?.map(
              (cluster: KubernetesCluster) => {
                return {
                  _id: cluster.id!.toString(),
                  name: cluster.name || "",
                };
              },
            ),
          dockerHosts: scheduledMaintenanceTemplate.dockerHosts?.map(
            (dockerHost: DockerHost) => {
              return {
                _id: dockerHost.id!.toString(),
                name: dockerHost.name || "",
              };
            },
          ),
          podmanHosts: scheduledMaintenanceTemplate.podmanHosts?.map(
            (podmanHost: PodmanHost) => {
              return {
                _id: podmanHost.id!.toString(),
                name: podmanHost.name || "",
              };
            },
          ),
          services: scheduledMaintenanceTemplate.services?.map(
            (service: Service) => {
              return {
                _id: service.id!.toString(),
                name: service.name || "",
              };
            },
          ),
          statusPages: scheduledMaintenanceTemplate.statusPages?.map(
            (statusPage: StatusPage) => {
              return statusPage.id!.toString();
            },
          ),
          labels: scheduledMaintenanceTemplate.labels?.map((label: Label) => {
            return label.id!.toString();
          }),
          changeMonitorStatusTo:
            scheduledMaintenanceTemplate.changeMonitorStatusToId?.toString(),
          ownerUsers: usersListResult.data.map(
            (user: ScheduledMaintenanceTemplateOwnerUser): string => {
              return user.userId!.toString() || "";
            },
          ),
          ownerTeams: teamsListResult.data.map(
            (team: ScheduledMaintenanceTemplateOwnerTeam): string => {
              return team.teamId!.toString() || "";
            },
          ),
        };

        setInitialValuesForScheduledMaintenance(initialValue);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  return (
    <Fragment>
      <Card
        title="Create New Scheduled Maintenance"
        description={
          "Scheduled maintenance events are planned maintenance events that you can use to notify your team and subscribers about upcoming maintenance events."
        }
        className="mb-10"
      >
        <div>
          {isPageLoading && <PageLoader isVisible={true} />}
          {error && <ErrorMessage message={error} />}
          {!isPageLoading && !error && (
            <ModelForm<ScheduledMaintenance>
              modelType={ScheduledMaintenance}
              initialValues={formInitialValues}
              name="Create New Scheduled Maintenance Event"
              id="create-scheduledMaintenance-form"
              /*
               * Change Monitor Status to is asked only once a monitor is
               * picked. Without one, a status the form still holds - a
               * template's, or one picked before the last monitor was
               * removed - is not sent: there is no monitor for it to change,
               * and an event's status cannot be changed once it is created.
               */
              onBeforeCreate={async (
                item: ScheduledMaintenance,
                _miscDataProps: JSONObject,
                formValues: JSONObject,
              ): Promise<ScheduledMaintenance> => {
                return omitMonitorStatusWithoutMonitors({
                  item: item,
                  formValues: formValues,
                });
              }}
              steps={[
                {
                  title: "Event",
                  id: "event",
                },
                {
                  title: "Resources Affected",
                  id: "resources-affected",
                },
              ]}
              fields={[
                {
                  field: {
                    title: true,
                  },
                  title: "Title",
                  stepId: "event",
                  fieldType: FormFieldSchemaType.Text,
                  required: true,
                  placeholder: "Event Title",
                  validation: {
                    minLength: 2,
                  },
                },
                {
                  field: {
                    description: true,
                  },
                  title: "Description",
                  stepId: "event",
                  fieldType: FormFieldSchemaType.Markdown,
                  required: false,
                  description: MarkdownUtil.getMarkdownCheatsheet(
                    "Describe the scheduled maintenance event here",
                  ),
                },
                /*
                 * The next full hour, for an hour: change them only when
                 * they are wrong. Moving the start moves the end with it.
                 */
                {
                  field: {
                    startsAt: true,
                  },
                  title: "Starts At",
                  stepId: "event",
                  fieldType: FormFieldSchemaType.DateTime,
                  required: true,
                  placeholder: "Pick Date and Time",
                  getDefaultValue: (): string => {
                    return getDefaultMaintenanceStartsAt();
                  },
                  onChange: moveMaintenanceEndWithStart,
                },
                {
                  field: {
                    endsAt: true,
                  },
                  title: "Ends At",
                  stepId: "event",
                  fieldType: FormFieldSchemaType.DateTime,
                  required: true,
                  placeholder: "Pick Date and Time",
                  getDefaultValue: (
                    values: FormValues<ScheduledMaintenance>,
                  ): string => {
                    return getDefaultMaintenanceEndsAt(values);
                  },
                  customValidation: (
                    values: FormValues<ScheduledMaintenance>,
                  ): string | null => {
                    return getMaintenanceEndsAtError(values);
                  },
                },
                /*
                 * Owners and labels, folded under Advanced at the end of the
                 * step, as Declare Incident folds its labels: owner and label
                 * rules cover most events. People and teams in one picker,
                 * kept in ownerUsers / ownerTeams: ScheduledMaintenanceService
                 * adds them as the event's owners. The summary step lists
                 * them by name.
                 */
                getOwnersFormField({
                  stepId: "event",
                  description:
                    "Who owns this event. They are notified when its status changes.",
                  collapsibleSection: advancedSection,
                }),
                getLabelsFormField<ScheduledMaintenance>({
                  stepId: "event",
                  collapsibleSection: advancedSection,
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
                    if (!item.labels || !Array.isArray(item.labels)) {
                      return (
                        <p>{translator.translateText("No labels assigned.")}</p>
                      );
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
                }),
                /*
                 * The event's monitors, on their own: Change Monitor Status
                 * to right below acts on them, and the status pages that show
                 * them are suggested under the status page picker.
                 */
                {
                  field: {
                    monitors: true,
                  },
                  title: "Monitors",
                  stepId: "resources-affected",
                  description:
                    "Search and attach the monitors affected by this scheduled maintenance.",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: false,
                  getCustomElement: (
                    values: FormValues<ScheduledMaintenance>,
                    elementProps: CustomElementProps,
                  ) => {
                    return (
                      <AffectedResourcesPicker
                        monitors={values.monitors as Array<Monitor>}
                        resourceTypes={MONITOR_RESOURCE_TYPES}
                        placeholder="Search monitors..."
                        ariaLabelledby={elementProps.ariaLabelledby}
                        onChange={(payload: unknown) => {
                          elementProps.onChange?.(payload);
                        }}
                      />
                    );
                  },
                  onChange: (
                    value: unknown,
                    currentValues: FormValues<ScheduledMaintenance>,
                    setNewFormValues: (
                      values: FormValues<ScheduledMaintenance>,
                    ) => void,
                  ) => {
                    /*
                     * FormField's CustomComponent path calls our onChange
                     * first and then setFieldValue(fieldName, value), which
                     * puts the picker's whole payload in `monitors`. Defer
                     * the split via microtask so it runs after that lands and
                     * our write wins. Only the monitors are this picker's to
                     * write.
                     */
                    if (isAffectedResourcesPayload(value)) {
                      const payload: typeof value = value;
                      queueMicrotask(() => {
                        setNewFormValues({
                          ...currentValues,
                          monitors: payload.monitors,
                        } as FormValues<ScheduledMaintenance>);
                      });
                    }
                  },
                  /*
                   * Bare IDs once the picker has written to the form, or
                   * {_id, name} objects from a template the user has not
                   * touched: the read-only picker names both, looking up any
                   * name it lacks.
                   */
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
                    if (!hasMonitors(item)) {
                      return (
                        <p>
                          {translator.translateText(
                            "No monitors affected by this scheduled maintenance event.",
                          )}
                        </p>
                      );
                    }

                    return (
                      <AffectedResourcesPicker
                        readOnly={true}
                        monitors={item.monitors as Array<Monitor>}
                        resourceTypes={MONITOR_RESOURCE_TYPES}
                        onChange={() => {
                          // Read-only: nothing to change.
                        }}
                      />
                    );
                  },
                },
                /*
                 * Right under the monitors it acts on, and only once one is
                 * picked: without a monitor there is nothing for it to
                 * change. The monitors change to it when the event starts,
                 * and back to operational when it ends. Hidden, it keeps what
                 * it holds - a template's status, or one picked before the
                 * last monitor was removed - and shows it again with the next
                 * monitor; onBeforeCreate never sends it without one.
                 */
                {
                  field: {
                    changeMonitorStatusTo: true,
                  },
                  title: "Change Monitor Status to",
                  stepId: "resources-affected",
                  description:
                    "When the event starts, its monitors change to this status, and back to operational when it ends.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: MonitorStatus,
                    labelField: "name",
                    valueField: "_id",
                    sort: {
                      priority: SortOrder.Ascending,
                    },
                  },
                  required: false,
                  placeholder: "Monitor Status",
                  showIf: hasMonitors,
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
                    if (!item.changeMonitorStatusTo) {
                      return (
                        <p>
                          {translator.translateText(
                            "Status of the monitors will not be changed when this scheduled maintenance event starts.",
                          )}
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
                /*
                 * Everything else the event affects. Anchored on `hosts`; its
                 * payload is split back into each relation by the onChange
                 * below, and the hidden registrations further down load and
                 * send the rest.
                 */
                {
                  field: {
                    hosts: true,
                  },
                  title: "Other Affected Resources",
                  stepId: "resources-affected",
                  description:
                    "Search and attach hosts, clusters, container hosts, databases, IoT fleets, network sites, or services affected by this scheduled maintenance. Attaching a network site covers every site beneath it.",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: false,
                  getCustomElement: (
                    values: FormValues<ScheduledMaintenance>,
                    elementProps: CustomElementProps,
                  ) => {
                    return (
                      <AffectedResourcesPicker
                        hosts={values.hosts as Array<Host>}
                        kubernetesClusters={
                          values.kubernetesClusters as Array<KubernetesCluster>
                        }
                        dockerHosts={values.dockerHosts as Array<DockerHost>}
                        podmanHosts={values.podmanHosts as Array<PodmanHost>}
                        proxmoxClusters={
                          values.proxmoxClusters as Array<ProxmoxCluster>
                        }
                        vmwareVCenters={
                          values.vmwareVCenters as Array<VMwareVCenter>
                        }
                        cephClusters={values.cephClusters as Array<CephCluster>}
                        storageArrays={
                          values.storageArrays as Array<StorageArray>
                        }
                        dockerSwarmClusters={
                          values.dockerSwarmClusters as Array<DockerSwarmCluster>
                        }
                        iotFleets={values.iotFleets as Array<IoTFleet>}
                        databaseServers={
                          values.databaseServers as Array<DatabaseServer>
                        }
                        networkSites={values.networkSites as Array<NetworkSite>}
                        services={values.services as Array<Service>}
                        resourceTypes={OTHER_AFFECTED_RESOURCE_TYPES}
                        ariaLabelledby={elementProps.ariaLabelledby}
                        onChange={(payload: unknown) => {
                          elementProps.onChange?.(payload);
                        }}
                      />
                    );
                  },
                  onChange: (
                    value: unknown,
                    currentValues: FormValues<ScheduledMaintenance>,
                    setNewFormValues: (
                      values: FormValues<ScheduledMaintenance>,
                    ) => void,
                  ) => {
                    /*
                     * Deferred, as the monitors' split is. The monitors are
                     * the other picker's: not written here.
                     */
                    if (isAffectedResourcesPayload(value)) {
                      const payload: typeof value = value;
                      queueMicrotask(() => {
                        setNewFormValues({
                          ...currentValues,
                          hosts: payload.hosts,
                          kubernetesClusters: payload.kubernetesClusters,
                          dockerHosts: payload.dockerHosts,
                          podmanHosts: payload.podmanHosts,
                          proxmoxClusters: payload.proxmoxClusters,
                          vmwareVCenters: payload.vmwareVCenters,
                          cephClusters: payload.cephClusters,
                          storageArrays: payload.storageArrays,
                          dockerSwarmClusters: payload.dockerSwarmClusters,
                          iotFleets: payload.iotFleets,
                          databaseServers: payload.databaseServers,
                          networkSites: payload.networkSites,
                          services: payload.services,
                        } as FormValues<ScheduledMaintenance>);
                      });
                    }
                  },
                  /*
                   * What the picked monitors are linked to, added here
                   * (MonitorLinkedResourcesPrefill).
                   */
                  getFooterElement: (
                    values: FormValues<ScheduledMaintenance>,
                    _error?: string,
                    footer?: FieldFooterProps,
                  ) => {
                    return (
                      <MonitorLinkedResourcesPrefill
                        monitorIds={values.monitors}
                        values={values as Record<string, unknown>}
                        footer={footer}
                        payloadKeys={SCHEDULED_MAINTENANCE_PREFILL_PAYLOAD_KEYS}
                        state={linkedResourcesPrefill}
                      />
                    );
                  },
                  /*
                   * The form holds bare IDs once the picker has written to
                   * it, or {_id, name} objects from a template prefill or the
                   * record the page was opened from. The read-only picker
                   * takes both and looks up any name it lacks, so the review
                   * step names every resource the user picked instead of
                   * counting them.
                   */
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
                    const hasResources: boolean = [
                      item.hosts,
                      item.kubernetesClusters,
                      item.dockerHosts,
                      item.podmanHosts,
                      item.proxmoxClusters,
                      item.vmwareVCenters,
                      item.cephClusters,
                      item.storageArrays,
                      item.dockerSwarmClusters,
                      item.iotFleets,
                      item.databaseServers,
                      item.networkSites,
                      item.services,
                    ].some((resources: unknown): boolean => {
                      return Array.isArray(resources) && resources.length > 0;
                    });
                    if (!hasResources) {
                      return (
                        <p>
                          {translator.translateText(
                            "No other resources affected by this scheduled maintenance event.",
                          )}
                        </p>
                      );
                    }
                    return (
                      <AffectedResourcesPicker
                        readOnly={true}
                        hosts={item.hosts as Array<Host>}
                        kubernetesClusters={
                          item.kubernetesClusters as Array<KubernetesCluster>
                        }
                        dockerHosts={item.dockerHosts as Array<DockerHost>}
                        podmanHosts={item.podmanHosts as Array<PodmanHost>}
                        proxmoxClusters={
                          item.proxmoxClusters as Array<ProxmoxCluster>
                        }
                        vmwareVCenters={
                          item.vmwareVCenters as Array<VMwareVCenter>
                        }
                        cephClusters={item.cephClusters as Array<CephCluster>}
                        storageArrays={
                          item.storageArrays as Array<StorageArray>
                        }
                        dockerSwarmClusters={
                          item.dockerSwarmClusters as Array<DockerSwarmCluster>
                        }
                        iotFleets={item.iotFleets as Array<IoTFleet>}
                        databaseServers={
                          item.databaseServers as Array<DatabaseServer>
                        }
                        networkSites={item.networkSites as Array<NetworkSite>}
                        services={item.services as Array<Service>}
                        resourceTypes={OTHER_AFFECTED_RESOURCE_TYPES}
                        onChange={() => {
                          // Read-only: nothing to change.
                        }}
                      />
                    );
                  },
                },
                /*
                 * Hidden registrations so ModelForm.getSelectFields includes
                 * kubernetesClusters/dockerHosts/podmanHosts/proxmoxClusters/
                 * vmwareVCenters/cephClusters/storageArrays/
                 * dockerSwarmClusters/iotFleets/databaseServers/networkSites/
                 * services on load and submit
                 * (hosts is the second picker's anchor above).
                 */
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
                  field: { proxmoxClusters: true },
                  stepId: "resources-affected",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { vmwareVCenters: true },
                  stepId: "resources-affected",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { cephClusters: true },
                  stepId: "resources-affected",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { storageArrays: true },
                  stepId: "resources-affected",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { dockerSwarmClusters: true },
                  stepId: "resources-affected",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { iotFleets: true },
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
                  field: { networkSites: true },
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
                /*
                 * Starts empty: picking a page publishes the event there and
                 * tells its subscribers. Under it, the pages that show the
                 * affected monitors, one click to add.
                 */
                {
                  field: {
                    statusPages: true,
                  },
                  title: "Show event on these status pages ",
                  stepId: "resources-affected",
                  description: "Select status pages to show this event on",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: StatusPage,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select Status Pages",
                  getFooterElement:
                    getStatusPageSuggestionsFooter<ScheduledMaintenance>({
                      eventType: StatusPageEventType.ScheduledEvent,
                    }),
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
                    if (!item.statusPages || !Array.isArray(item.statusPages)) {
                      return (
                        <p>
                          {translator.translateText(
                            "No status pages selected for this scheduled maintenance event.",
                          )}
                        </p>
                      );
                    }

                    const statusPageIds: Array<ObjectID> = [];

                    for (const statusPage of item.statusPages) {
                      if (typeof statusPage === "string") {
                        statusPageIds.push(new ObjectID(statusPage));
                        continue;
                      }

                      if (statusPage instanceof ObjectID) {
                        statusPageIds.push(statusPage);
                        continue;
                      }

                      if (statusPage instanceof StatusPage) {
                        statusPageIds.push(
                          new ObjectID(statusPage._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchStatusPages statusPageIds={statusPageIds} />
                      </div>
                    );
                  },
                },
                /*
                 * Folded to one line that says what happens. All three are
                 * on, as on the model: subscribers hear when the event is
                 * scheduled, starts and ends.
                 */
                {
                  field: {
                    shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
                  },
                  title: "When the event is scheduled",
                  stepId: "resources-affected",
                  collapsibleSection: subscriberNotificationsSection,
                  fieldType: FormFieldSchemaType.Checkbox,
                  defaultValue: true,
                  required: false,
                },
                {
                  field: {
                    shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
                      true,
                  },
                  title: "When the event starts",
                  stepId: "resources-affected",
                  collapsibleSection: subscriberNotificationsSection,
                  fieldType: FormFieldSchemaType.Checkbox,
                  defaultValue: true,
                  required: false,
                },
                {
                  field: {
                    shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded:
                      true,
                  },
                  title: "When the event ends",
                  stepId: "resources-affected",
                  collapsibleSection: subscriberNotificationsSection,
                  fieldType: FormFieldSchemaType.Checkbox,
                  defaultValue: true,
                  required: false,
                },
                {
                  field: {
                    sendSubscriberNotificationsOnBeforeTheEvent: true,
                  },
                  stepId: "resources-affected",
                  collapsibleSection: subscriberNotificationsSection,
                  title: "Reminders before the event",
                  description:
                    "Remind subscribers before the event starts, for example 1 day before.",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  getCustomElement: (
                    value: FormValues<ScheduledMaintenance>,
                    props: CustomElementProps,
                  ) => {
                    return (
                      <RecurringArrayFieldElement
                        {...props}
                        initialValue={
                          value.sendSubscriberNotificationsOnBeforeTheEvent as Array<Recurring>
                        }
                      />
                    );
                  },
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
                    if (
                      !item.sendSubscriberNotificationsOnBeforeTheEvent ||
                      (Array.isArray(
                        item.sendSubscriberNotificationsOnBeforeTheEvent,
                      ) &&
                        item.sendSubscriberNotificationsOnBeforeTheEvent
                          .length === 0)
                    ) {
                      return (
                        <p>
                          {translator.translateText(
                            "No reminders set for subscribers.",
                          )}
                        </p>
                      );
                    }

                    return (
                      <RecurringArrayViewElement
                        value={
                          item.sendSubscriberNotificationsOnBeforeTheEvent as Recurring[]
                        }
                        postfix=" before the event begins"
                      />
                    );
                  },
                  required: false,
                },
              ]}
              onSuccess={(createdItem: ScheduledMaintenance) => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
                      {
                        modelId: createdItem._id,
                      },
                    ),
                  ),
                );
              }}
              submitButtonText={"Create Scheduled Maintenance Event"}
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

export default ScheduledMaintenanceCreate;
