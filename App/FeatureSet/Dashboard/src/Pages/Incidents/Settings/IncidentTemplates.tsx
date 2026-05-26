import ProjectUtil from "Common/UI/Utils/Project";
import ProjectUser from "../../../Utils/ProjectUser";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Service from "Common/Models/DatabaseModels/Service";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../../Components/AffectedResources/AffectedResourcesPicker";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

const IncidentTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const [createInitialValues, setCreateInitialValues] = useState<
    FormValues<IncidentTemplate>
  >({});

  const fetchFirstIncidentState: () => Promise<void> =
    async (): Promise<void> => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          return;
        }

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

        if (incidentStates.data.length > 0) {
          setCreateInitialValues({
            initialIncidentState: incidentStates.data[0]!._id?.toString(),
          });
        }
      } catch {
        // Silently fail
      }
    };

  useEffect(() => {
    fetchFirstIncidentState();
  }, []);

  return (
    <Fragment>
      <ModelTable<IncidentTemplate>
        modelType={IncidentTemplate}
        id="incident-templates-table"
        userPreferencesKey="incident-templates-table"
        name="Settings > Incident Templates"
        saveFilterProps={{
          tableId: "incident-templates-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Incident Templates",
          description:
            "Here is a list of all the incident templates in this project.",
        }}
        noItemsMessage={"No incident templates found."}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        createInitialValues={createInitialValues}
        formSteps={[
          {
            title: "Template Info",
            id: "template-info",
          },
          {
            title: "Incident Details",
            id: "incident-details",
          },
          {
            title: "Resources Affected",
            id: "resources-affected",
          },
          {
            title: "On-Call",
            id: "on-call",
          },
          {
            title: "Owners",
            id: "owners",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            fieldType: FormFieldSchemaType.Text,
            stepId: "template-info",
            required: true,
            placeholder: "Template Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Template Description",
            fieldType: FormFieldSchemaType.LongText,
            stepId: "template-info",
            required: true,
            placeholder: "Template Description",
            validation: {
              minLength: 2,
            },
          },
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
            required: false,
            placeholder: "Incident Severity",
          },
          {
            field: {
              initialIncidentState: true,
            },
            title: "Initial Incident State",
            stepId: "incident-details",
            description:
              "Select the initial state for incidents created from this template",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: IncidentState,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Initial State",
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
                    },
                    sort: {
                      order: SortOrder.Ascending,
                    },
                  });

                return incidentStates.data.map((state: IncidentState) => {
                  return {
                    label: state.name || "",
                    value: state._id?.toString() || "",
                  };
                });
              } catch {
                // Silently fail and return empty array
                return [];
              }
            },
          },
          {
            field: {
              monitors: true,
            },
            title: "Resources Affected",
            stepId: "resources-affected",
            description:
              "Search and attach monitors, hosts, Kubernetes clusters, Docker hosts, or services that incidents created from this template should pre-populate.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              values: FormValues<IncidentTemplate>,
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
                    elementProps.onChange?.(payload);
                  }}
                />
              );
            },
            onChange: (
              value: unknown,
              currentValues: FormValues<IncidentTemplate>,
              setNewFormValues: (values: FormValues<IncidentTemplate>) => void,
            ) => {
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
                  } as FormValues<IncidentTemplate>);
                });
              }
            },
          },
          /*
           * Hidden registrations so ModelForm.getSelectFields includes
           * hosts/kubernetesClusters/dockerHosts/services on load and submit.
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
          },
          {
            overrideField: {
              ownerTeams: true,
            },
            showEvenIfPermissionDoesNotExist: true,
            title: "Owner - Teams",
            stepId: "owners",
            description:
              "Select which teams own this incident. They will be notified when the incident is created or updated.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Teams",
            overrideFieldKey: "ownerTeams",
          },
          {
            overrideField: {
              ownerUsers: true,
            },
            showEvenIfPermissionDoesNotExist: true,
            title: "Owner - Users",
            stepId: "owners",
            description:
              "Select which users own this incident. They will be notified when the incident is created or updated.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            required: false,
            placeholder: "Select Users",
            overrideFieldKey: "ownerUsers",
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
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        filters={[
          {
            field: {
              templateName: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
        columns={[
          {
            field: {
              templateName: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
      />
    </Fragment>
  );
};

export default IncidentTemplates;
