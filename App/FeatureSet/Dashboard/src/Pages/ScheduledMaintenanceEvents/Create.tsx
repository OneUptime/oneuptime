import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Card from "Common/UI/Components/Card/Card";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import Team from "Common/Models/DatabaseModels/Team";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../Components/AffectedResources/AffectedResourcesPicker";
import ProjectUser from "../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";
import Label from "Common/Models/DatabaseModels/Label";
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
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import RecurringArrayFieldElement from "Common/UI/Components/Events/RecurringArrayFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import FetchMonitors from "../../Components/Monitor/FetchMonitors";
import FetchMonitorStatuses from "../../Components/MonitorStatus/FetchMonitorStatuses";
import FetchStatusPages from "../../Components/StatusPage/FetchStatusPages";
import FetchTeams from "../../Components/Team/FetchTeams";
import FetchUsers from "../../Components/User/FetchUsers";
import User from "Common/Models/DatabaseModels/User";
import FetchLabels from "../../Components/Label/FetchLabels";
import Incident from "Common/Models/DatabaseModels/Incident";
import RecurringArrayViewElement from "Common/UI/Components/Events/RecurringArrayViewElement";

const ScheduledMaintenanceCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [
    initialValuesForScheduledMaintenance,
    setInitialValuesForScheduledMaintenance,
  ] = useState<JSONObject>({});

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
            monitors: true,
            hosts: true,
            kubernetesClusters: true,
            dockerHosts: true,
            services: true,
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
          monitors: scheduledMaintenanceTemplate.monitors?.map(
            (monitor: Monitor) => {
              return monitor.id!.toString();
            },
          ),
          hosts: scheduledMaintenanceTemplate.hosts?.map((host: Host) => {
            return host.id!.toString();
          }),
          kubernetesClusters:
            scheduledMaintenanceTemplate.kubernetesClusters?.map(
              (cluster: KubernetesCluster) => {
                return cluster.id!.toString();
              },
            ),
          dockerHosts: scheduledMaintenanceTemplate.dockerHosts?.map(
            (dockerHost: DockerHost) => {
              return dockerHost.id!.toString();
            },
          ),
          services: scheduledMaintenanceTemplate.services?.map(
            (service: Service) => {
              return service.id!.toString();
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
          {isLoading && <PageLoader isVisible={true} />}
          {error && <ErrorMessage message={error} />}
          {!isLoading && !error && (
            <ModelForm<ScheduledMaintenance>
              modelType={ScheduledMaintenance}
              initialValues={initialValuesForScheduledMaintenance}
              name="Create New Scheduled Maintenance Event"
              id="create-scheduledMaintenance-form"
              steps={[
                {
                  title: "Event Info",
                  id: "event-info",
                },
                {
                  title: "Event Time",
                  id: "event-time",
                },
                {
                  title: "Resources Affected",
                  id: "resources-affected",
                },
                {
                  title: "Status Pages",
                  id: "status-pages",
                },
                {
                  title: "Owners",
                  id: "owners",
                },
                {
                  title: "Subscribers",
                  id: "subscribers",
                },
                {
                  title: "Labels",
                  id: "labels",
                },
              ]}
              fields={[
                {
                  field: {
                    title: true,
                  },
                  title: "Title",
                  stepId: "event-info",
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
                  stepId: "event-info",
                  fieldType: FormFieldSchemaType.Markdown,
                  required: false,
                  description: MarkdownUtil.getMarkdownCheatsheet(
                    "Describe the scheduled maintenance event here",
                  ),
                },
                {
                  field: {
                    startsAt: true,
                  },
                  title: "Event Starts At",
                  stepId: "event-time",
                  fieldType: FormFieldSchemaType.DateTime,
                  required: true,
                  placeholder: "Pick Date and Time",
                },
                {
                  field: {
                    endsAt: true,
                  },
                  title: "Ends At",
                  stepId: "event-time",
                  fieldType: FormFieldSchemaType.DateTime,
                  required: true,
                  placeholder: "Pick Date and Time",
                },
                {
                  field: {
                    monitors: true,
                  },
                  title: "Resources Affected",
                  stepId: "resources-affected",
                  description:
                    "Search and attach monitors, hosts, Kubernetes clusters, Docker hosts, or services affected by this scheduled maintenance.",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: false,
                  getCustomElement: (
                    values: FormValues<ScheduledMaintenance>,
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
                        services={values.services as Array<Service>}
                        onChange={(payload: unknown) => {
                          /*
                           * Field.onChange below handles the split; we still
                           * forward to elementProps.onChange so FormField's
                           * internal pipeline triggers it.
                           */
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
                     * first and then setFieldValue(fieldName, value). The
                     * latter would otherwise stuff our payload object into
                     * the `monitors` slot. Defer the split via microtask so
                     * it runs after setFieldValue lands and our writes win.
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
                          services: payload.services,
                        } as FormValues<ScheduledMaintenance>);
                      });
                    }
                  },
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
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
                    const servicesCount: number = Array.isArray(item.services)
                      ? item.services.length
                      : 0;
                    const totalCount: number =
                      monitorIds.length +
                      hostsCount +
                      clustersCount +
                      dockerCount +
                      servicesCount;
                    if (totalCount === 0) {
                      return (
                        <p>
                          No resources affected by this scheduled maintenance
                          event.
                        </p>
                      );
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
                 * hosts/kubernetesClusters/dockerHosts on load and submit. The
                 * picker writes to all four relations, but only the anchor's
                 * first key is otherwise captured.
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
                  field: {
                    changeMonitorStatusTo: true,
                  },
                  title: "Change Monitor Status to ",
                  stepId: "resources-affected",
                  description:
                    "This will change the status of all the monitors attached when the event starts.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: MonitorStatus,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Monitor Status",
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
                    if (!item.changeMonitorStatusTo) {
                      return (
                        <p>
                          Status of the monitors will not be changed when this
                          scheduled maintenance event starts.
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
                    statusPages: true,
                  },
                  title: "Show event on these status pages ",
                  stepId: "status-pages",
                  description: "Select status pages to show this event on",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: StatusPage,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select Status Pages",
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
                    if (!item.statusPages || !Array.isArray(item.statusPages)) {
                      return (
                        <p>
                          No status pages selected for this scheduled
                          maintenance event.
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
                {
                  overrideField: {
                    ownerTeams: true,
                  },
                  showEvenIfPermissionDoesNotExist: true,
                  title: "Owner - Teams",
                  stepId: "owners",
                  description:
                    "Select which teams own this event. They will be notified when event status changes.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: Team,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select Teams",
                  overrideFieldKey: "ownerTeams",
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
                    if (
                      !(item as JSONObject)["ownerTeams"] ||
                      !Array.isArray((item as JSONObject)["ownerTeams"])
                    ) {
                      return <p>No teams assigned.</p>;
                    }

                    const ownerTeamIds: Array<ObjectID> = [];

                    for (const ownerTeam of (item as JSONObject)[
                      "ownerTeams"
                    ] as Array<any>) {
                      if (typeof ownerTeam === "string") {
                        ownerTeamIds.push(new ObjectID(ownerTeam));
                        continue;
                      }

                      if (ownerTeam instanceof ObjectID) {
                        ownerTeamIds.push(ownerTeam);
                        continue;
                      }

                      if (ownerTeam instanceof Team) {
                        ownerTeamIds.push(
                          new ObjectID(ownerTeam._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchTeams teamIds={ownerTeamIds} />
                      </div>
                    );
                  },
                },
                {
                  overrideField: {
                    ownerUsers: true,
                  },
                  showEvenIfPermissionDoesNotExist: true,
                  title: "Owner - Users",
                  stepId: "owners",
                  description:
                    "Select which users own this event. They will be notified when event status changes.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  fetchDropdownOptions: async () => {
                    return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                      ProjectUtil.getCurrentProjectId()!,
                    );
                  },
                  required: false,
                  placeholder: "Select Users",
                  overrideFieldKey: "ownerUsers",
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
                    if (
                      !(item as JSONObject)["ownerUsers"] ||
                      !Array.isArray((item as JSONObject)["ownerUsers"])
                    ) {
                      return <p>No owners assigned.</p>;
                    }

                    const ownerUserIds: Array<ObjectID> = [];

                    for (const ownerUser of (item as JSONObject)[
                      "ownerUsers"
                    ] as Array<any>) {
                      if (typeof ownerUser === "string") {
                        ownerUserIds.push(new ObjectID(ownerUser));
                        continue;
                      }

                      if (ownerUser instanceof ObjectID) {
                        ownerUserIds.push(ownerUser);
                        continue;
                      }

                      if (ownerUser instanceof User) {
                        ownerUserIds.push(
                          new ObjectID(ownerUser._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchUsers userIds={ownerUserIds} />
                      </div>
                    );
                  },
                },

                {
                  field: {
                    shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
                  },

                  title: "Event Created: Notify Status Page Subscribers",
                  stepId: "subscribers",
                  description:
                    "Should status page subscribers be notified when this event is created?",
                  fieldType: FormFieldSchemaType.Checkbox,
                  defaultValue: true,
                  required: false,
                },
                {
                  field: {
                    shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
                      true,
                  },

                  title: "Event Ongoing: Notify Status Page Subscribers",
                  stepId: "subscribers",
                  description:
                    "Should status page subscribers be notified when this event state changes to ongoing?",
                  fieldType: FormFieldSchemaType.Checkbox,
                  defaultValue: true,
                  required: false,
                },
                {
                  field: {
                    shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded:
                      true,
                  },

                  title: "Event Ended: Notify Status Page Subscribers",
                  stepId: "subscribers",
                  description:
                    "Should status page subscribers be notified when this event state changes to ended?",
                  fieldType: FormFieldSchemaType.Checkbox,
                  defaultValue: true,
                  required: false,
                },
                {
                  field: {
                    sendSubscriberNotificationsOnBeforeTheEvent: true,
                  },
                  stepId: "subscribers",
                  title: "Send reminders to subscribers before the event",
                  description:
                    "Please add a list of notification options to notify subscribers before the event",
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
                      return <p>No reminders set for subscribers.</p>;
                    }

                    return (
                      <RecurringArrayViewElement
                        value={
                          item.sendSubscriberNotificationsOnBeforeTheEvent as Recurring[]
                        }
                        postfix=" before the event is begins"
                      />
                    );
                  },
                  required: false,
                },
                {
                  field: {
                    labels: true,
                  },
                  title: "Labels ",
                  stepId: "labels",
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
