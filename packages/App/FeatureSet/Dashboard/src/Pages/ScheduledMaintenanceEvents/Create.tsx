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
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Card from "Common/UI/Components/Card/Card";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
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
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import RecurringArrayFieldElement from "Common/UI/Components/Events/RecurringArrayFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import FetchMonitorStatuses from "../../Components/MonitorStatus/FetchMonitorStatuses";
import FetchStatusPages from "../../Components/StatusPage/FetchStatusPages";
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
 * Every resource type the "Resources Affected" step offers. The editor and
 * the review step's read-only picker both take this list, so the summary
 * names every type the editor lets the user pick.
 */
const AFFECTED_RESOURCE_TYPES: Array<AffectedResourceType> = [
  "Monitor",
  "Host",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "DatabaseServer",
  "NetworkSite",
  "Service",
];

const ScheduledMaintenanceCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
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
                {
                  field: {
                    monitors: true,
                  },
                  title: "Resources Affected",
                  stepId: "resources-affected",
                  description:
                    "Search and attach monitors, hosts, Kubernetes clusters, Docker hosts, databases, network sites, or services affected by this scheduled maintenance. Attaching a network site covers every site beneath it.",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: false,
                  // The picker writes only what is picked: the form can be finished without it.
                  customElementCanBeSkipped: true,
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
                        podmanHosts={values.podmanHosts as Array<PodmanHost>}
                        databaseServers={
                          values.databaseServers as Array<DatabaseServer>
                        }
                        networkSites={values.networkSites as Array<NetworkSite>}
                        services={values.services as Array<Service>}
                        resourceTypes={AFFECTED_RESOURCE_TYPES}
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
                          podmanHosts: payload.podmanHosts,
                          databaseServers: payload.databaseServers,
                          networkSites: payload.networkSites,
                          services: payload.services,
                        } as FormValues<ScheduledMaintenance>);
                      });
                    }
                  },
                  /*
                   * The form holds bare IDs once the picker has written to
                   * it, or {_id, name} objects from a template prefill the
                   * user has not touched. The read-only picker takes both and
                   * looks up any name it lacks, so the review step names
                   * every resource the user picked instead of counting them.
                   */
                  getSummaryElement: (
                    item: FormValues<ScheduledMaintenance>,
                  ) => {
                    const hasResources: boolean = [
                      item.monitors,
                      item.hosts,
                      item.kubernetesClusters,
                      item.dockerHosts,
                      item.podmanHosts,
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
                            "No resources affected by this scheduled maintenance event.",
                          )}
                        </p>
                      );
                    }
                    return (
                      <AffectedResourcesPicker
                        readOnly={true}
                        monitors={item.monitors as Array<Monitor>}
                        hosts={item.hosts as Array<Host>}
                        kubernetesClusters={
                          item.kubernetesClusters as Array<KubernetesCluster>
                        }
                        dockerHosts={item.dockerHosts as Array<DockerHost>}
                        podmanHosts={item.podmanHosts as Array<PodmanHost>}
                        databaseServers={
                          item.databaseServers as Array<DatabaseServer>
                        }
                        networkSites={item.networkSites as Array<NetworkSite>}
                        services={item.services as Array<Service>}
                        resourceTypes={AFFECTED_RESOURCE_TYPES}
                        onChange={() => {
                          // Read-only: nothing to change.
                        }}
                      />
                    );
                  },
                },
                /*
                 * Hidden registrations so ModelForm.getSelectFields includes
                 * hosts/kubernetesClusters/dockerHosts/podmanHosts/
                 * databaseServers/networkSites/services on load and submit. The picker writes
                 * to every one of these relations, but only the anchor
                 * field's key (monitors) is otherwise captured.
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
                  // Starts with no reminders, and writes only the ones added.
                  customElementCanBeSkipped: true,
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
                /*
                 * Last on its step, folded: it changes the monitors' status
                 * while the event is ongoing.
                 */
                {
                  field: {
                    changeMonitorStatusTo: true,
                  },
                  title: "Change Monitor Status to ",
                  stepId: "resources-affected",
                  description:
                    "This will change the status of all the monitors attached when the event starts.",
                  collapsibleSection: advancedSection,
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
