import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Alert from "Common/Models/DatabaseModels/Alert";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useMemo,
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
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import MonitorLinkedResourcesPrefill, {
  MonitorLinkedResourcesPrefillState,
  useMonitorLinkedResourcesPrefillState,
} from "../../Components/AffectedResources/MonitorLinkedResourcesPrefill";
import { ALERT_PREFILL_PAYLOAD_KEYS } from "../../Components/AffectedResources/MonitorLinkedResourcesPrefillRules";
import AffectedResourcesPicker, {
  AffectedResourceType,
  isAffectedResourcesPayload,
} from "../../Components/AffectedResources/AffectedResourcesPicker";
import {
  CustomElementProps,
  FieldFooterProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Label from "Common/Models/DatabaseModels/Label";
import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import ObjectID from "Common/Types/ObjectID";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FetchLabels from "../../Components/Label/FetchLabels";
import FetchOnCallDutyPolicies from "../../Components/OnCallPolicy/FetchOnCallPolicies";
import FetchMonitors from "../../Components/Monitor/FetchMonitors";
import FetchAlertState from "../../Components/AlertState/FetchAlertState";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { JSONObject } from "Common/Types/JSON";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import {
  CreatedRecordKind,
  pickRecordToCreateFrom,
} from "../../Components/CreateFromRecord/CreateFromRecord";
import useRecordToCreateFrom, {
  RecordToCreateFromState,
} from "../../Components/CreateFromRecord/useRecordToCreateFrom";

/*
 * Creating an alert asks for what it cannot exist without - a title and a
 * severity - and its description. The state it starts in, its labels and
 * whether it is private are folded under one "Advanced" header at the end of
 * Alert Details: it says "Configured" when one of them holds something, and
 * opens by itself when one fails validation. Root cause and remediation
 * notes are not asked here: they are written on the alert's own Root Cause
 * and Remediation pages once there is something to say.
 */
const advancedSection: FormFieldCollapsibleSection<Alert> =
  getAdvancedFormSection<Alert>();

/*
 * Every resource type besides the monitor that an alert can affect: what
 * the alert's own Edit offers, so an alert created from a Proxmox cluster's,
 * a vCenter's, a Ceph or Docker Swarm cluster's, a storage array's or an IoT
 * fleet's Alerts tab keeps it picked (Components/CreateFromRecord).
 */
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
  "Service",
];

const AlertCreate: FunctionComponent<PageComponentProps> = (): ReactElement => {
  // What the picked monitors' linked resources added (survives step changes).
  const linkedResourcesPrefill: MutableRefObject<MonitorLinkedResourcesPrefillState> =
    useMonitorLinkedResourcesPrefillState();

  const translator: Translator = useTranslator();

  /*
   * The monitor, host or other resource whose Alerts tab the page was opened
   * from (?monitorId=, ?hostId=, ...): picked - the monitor in Monitor, the
   * rest in Other Affected Resources - and the breadcrumbs go back through
   * its tab. Opened from the project's list, there is none, nothing is
   * looked up, and the form opens at once.
   */
  const recordToCreateFrom: RecordToCreateFromState = useRecordToCreateFrom(
    CreatedRecordKind.Alert,
  );

  // One identity per record: the form latches its initial values once.
  const initialValues: JSONObject = useMemo(() => {
    return pickRecordToCreateFrom({
      values: {},
      record: recordToCreateFrom.record,
      created: CreatedRecordKind.Alert,
    });
  }, [recordToCreateFrom.record]);

  return (
    <Fragment>
      <Card
        title="Create New Alert"
        description={
          "Create a new alert to notify your team about an issue that needs attention."
        }
        className="mb-10"
      >
        <div>
          {recordToCreateFrom.isLoading && <PageLoader isVisible={true} />}
          {!recordToCreateFrom.isLoading && (
            <ModelForm<Alert>
              modelType={Alert}
              initialValues={initialValues}
              name="Create New Alert"
              id="create-alert-form"
              fields={[
                {
                  field: {
                    title: true,
                  },
                  title: "Title",
                  fieldType: FormFieldSchemaType.Text,
                  stepId: "alert-details",
                  required: true,
                  placeholder: "Alert Title",
                  validation: {
                    minLength: 2,
                  },
                },
                {
                  field: {
                    alertSeverity: true,
                  },
                  title: "Alert Severity",
                  stepId: "alert-details",
                  description: "What is the severity of this alert?",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: AlertSeverity,
                    labelField: "name",
                    valueField: "_id",
                    sort: {
                      order: SortOrder.Ascending,
                    },
                  },
                  required: true,
                  placeholder: "Alert Severity",
                },
                {
                  field: {
                    description: true,
                  },
                  title: "Description",
                  stepId: "alert-details",
                  fieldType: FormFieldSchemaType.Markdown,
                  required: false,
                  description: MarkdownUtil.getMarkdownCheatsheet(
                    "Describe the alert details here",
                  ),
                },
                /*
                 * Left empty, the alert starts where every new alert does, the
                 * project's starting state, which is what the server picks
                 * when it is not sent.
                 */
                {
                  field: {
                    currentAlertState: true,
                  },
                  title: "Initial State",
                  stepId: "alert-details",
                  description:
                    "Leave empty for the usual starting state. Pick a later state to record an alert that is already acknowledged or resolved. No one is paged for it.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: AlertState,
                    labelField: "name",
                    valueField: "_id",
                    sort: {
                      order: SortOrder.Ascending,
                    },
                  },
                  required: false,
                  placeholder: "Select Initial State",
                  collapsibleSection: advancedSection,
                  getSummaryElement: (item: FormValues<Alert>) => {
                    if (!item.currentAlertState) {
                      return (
                        <p>
                          {translator.translateText(
                            "The usual starting state.",
                          )}
                        </p>
                      );
                    }

                    return (
                      <FetchAlertState
                        alertStateId={
                          new ObjectID(item.currentAlertState.toString())
                        }
                      />
                    );
                  },
                },
                getLabelsFormField<Alert>({
                  stepId: "alert-details",
                  collapsibleSection: advancedSection,
                  getSummaryElement: (item: FormValues<Alert>) => {
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
                    isPrivate: true,
                  },
                  title: "Private Alert",
                  stepId: "alert-details",
                  description:
                    "If checked, only the alert's owner users and the members of its owner teams (plus project admins and owners) can view this alert.",
                  fieldType: FormFieldSchemaType.Checkbox,
                  defaultValue: false,
                  required: false,
                  collapsibleSection: advancedSection,
                },
                {
                  field: {
                    monitor: true,
                  },
                  title: "Monitor",
                  stepId: "on-call",
                  description: "Select the monitor affected by this alert.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: Monitor,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select Monitor",
                  getSummaryElement: (item: FormValues<Alert>) => {
                    if (!item.monitor) {
                      return (
                        <p>
                          {translator.translateText("No monitor selected.")}
                        </p>
                      );
                    }

                    return (
                      <div>
                        <FetchMonitors
                          monitorIds={[new ObjectID(item.monitor.toString())]}
                        />
                      </div>
                    );
                  },
                },
                {
                  /*
                   * Alert.monitor is singular; this picker covers the other
                   * ManyToMany resources the alert may impact. We anchor on
                   * `hosts` because the picker payload is split out into the
                   * proper fields via the onChange below.
                   */
                  field: {
                    hosts: true,
                  },
                  title: "Other Affected Resources",
                  stepId: "on-call",
                  description:
                    "Search and attach hosts, Kubernetes clusters, Docker hosts, databases, or services affected by this alert.",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: false,
                  getCustomElement: (
                    values: FormValues<Alert>,
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
                        services={values.services as Array<Service>}
                        resourceTypes={OTHER_AFFECTED_RESOURCE_TYPES}
                        onChange={(payload: unknown) => {
                          elementProps.onChange?.(payload);
                        }}
                      />
                    );
                  },
                  onChange: (
                    value: unknown,
                    currentValues: FormValues<Alert>,
                    setNewFormValues: (values: FormValues<Alert>) => void,
                  ) => {
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
                          services: payload.services,
                        } as FormValues<Alert>);
                      });
                    }
                  },
                  /*
                   * What the picked monitor is linked to, added here
                   * (MonitorLinkedResourcesPrefill).
                   */
                  getFooterElement: (
                    values: FormValues<Alert>,
                    _error?: string,
                    footer?: FieldFooterProps,
                  ) => {
                    return (
                      <MonitorLinkedResourcesPrefill
                        monitorIds={values.monitor}
                        values={values as Record<string, unknown>}
                        footer={footer}
                        payloadKeys={ALERT_PREFILL_PAYLOAD_KEYS}
                        state={linkedResourcesPrefill}
                      />
                    );
                  },
                  /*
                   * The form holds bare IDs here, and the generic summary
                   * printed them raw — only `hosts`, since the other types
                   * are hidden registrations. The read-only picker names every
                   * type it was given.
                   */
                  getSummaryElement: (item: FormValues<Alert>) => {
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
                      item.services,
                    ].some((resources: unknown): boolean => {
                      return Array.isArray(resources) && resources.length > 0;
                    });
                    if (!hasResources) {
                      return (
                        <p>
                          {translator.translateText(
                            "No other resources affected by this alert.",
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
                 * dockerSwarmClusters/iotFleets/databaseServers/services.
                 * (hosts is already the picker's anchor field above so it
                 * doesn't need an extra registration.)
                 */
                {
                  field: { kubernetesClusters: true },
                  stepId: "on-call",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { dockerHosts: true },
                  stepId: "on-call",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { podmanHosts: true },
                  stepId: "on-call",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { proxmoxClusters: true },
                  stepId: "on-call",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { vmwareVCenters: true },
                  stepId: "on-call",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { cephClusters: true },
                  stepId: "on-call",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { storageArrays: true },
                  stepId: "on-call",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { dockerSwarmClusters: true },
                  stepId: "on-call",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { iotFleets: true },
                  stepId: "on-call",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { databaseServers: true },
                  stepId: "on-call",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: { services: true },
                  stepId: "on-call",
                  title: "",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  showIf: () => {
                    return false;
                  },
                },
                {
                  field: {
                    onCallDutyPolicies: true,
                  },
                  title: "On-Call Policy",
                  stepId: "on-call",
                  description:
                    "Select on-call duty policy to execute when this alert is created.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: OnCallDutyPolicy,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select on-call policies",
                  getSummaryElement: (item: FormValues<Alert>) => {
                    if (
                      !item.onCallDutyPolicies ||
                      !Array.isArray(item.onCallDutyPolicies)
                    ) {
                      return (
                        <p>
                          {translator.translateText(
                            "No on-call policies will be executed when this alert is created.",
                          )}
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
              ]}
              steps={[
                {
                  title: "Alert Details",
                  id: "alert-details",
                },
                {
                  title: "Resources & On-Call",
                  id: "on-call",
                },
              ]}
              onSuccess={async (createdItem: Alert) => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.ALERT_VIEW] as Route,
                      {
                        modelId: createdItem._id,
                      },
                    ),
                  ),
                );
              }}
              submitButtonText={"Create Alert"}
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

export default AlertCreate;
