import ProjectUtil from "Common/UI/Utils/Project";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Service from "Common/Models/DatabaseModels/Service";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../../Components/AffectedResources/AffectedResourcesPicker";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import IncidentStatusPageScopeCopy from "../../../Components/Incident/IncidentStatusPageScopeCopy";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import {
  buildCustomFieldModelFormFields,
  packCustomFieldFormValues,
  removeCustomFieldFormKeys,
} from "Common/UI/Components/CustomFields/CustomFieldModelFormFields";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import {
  fetchIncidentCustomFieldDefinitions,
  IncidentCustomFieldDefinition,
  INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID,
  INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_TITLE,
  isAskedOnIncidentForm,
} from "../../../Components/Incident/IncidentCustomFieldDefinitions";
import IncidentCustomFieldCreateSettingsCopy, {
  INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID,
  INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_TITLE,
} from "../../../Components/Incident/IncidentCustomFieldCreateSettingsCopy";
import {
  buildCustomFieldSettingsModelFormFields,
  getKeyedCustomFieldDefinitions,
  KeyedIncidentCustomFieldDefinition,
  packCustomFieldSettingsFormValues,
  removeCustomFieldSettingsFormKeys,
} from "../../../Components/Incident/IncidentCustomFieldCreateSettingsForm";
import { CustomFieldCreateSettings } from "Common/Types/CustomField/CustomFieldCreateSettings";
import getOwnersFormField from "Common/UI/Components/PeoplePicker/OwnersFormField";

const IncidentTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * The project's incident custom fields, so a new template can set the
   * values its incidents start with - every field, not only the ones the
   * Details step asks for: a template can quietly fill in the rest.
   */
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<
    Array<IncidentCustomFieldDefinition>
  >([]);

  const loadCustomFieldDefinitions: () => Promise<void> =
    async (): Promise<void> => {
      try {
        setCustomFieldDefinitions(await fetchIncidentCustomFieldDefinitions());
      } catch {
        // No custom fields on this plan, or no permission to read them.
        setCustomFieldDefinitions([]);
      }
    };

  /*
   * Never required here: "Required on Create" is asked of the person
   * declaring the incident, who can still fill in what the template leaves
   * empty. A mapped field is left out while the template has a monitor to
   * copy it from, as the template's Custom Fields card does.
   */
  const customFieldFormFields: Array<ModelField<IncidentTemplate>> =
    useMemo(() => {
      return buildCustomFieldModelFormFields<IncidentTemplate>({
        definitions: customFieldDefinitions,
        enforceRequiredOnCreate: false,
        stepId: INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID,
        isShown: isAskedOnIncidentForm,
      });
    }, [customFieldDefinitions]);

  const customFieldSteps: Array<FormStep<IncidentTemplate>> =
    customFieldDefinitions.length > 0
      ? [
          {
            title: INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_TITLE,
            id: INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID,
          },
        ]
      : [];

  /*
   * Which of those fields the Details step asks for when an incident is
   * declared from the template, and which it requires ("Custom Fields on
   * Create"): a step of its own, since a field's value and whether it is
   * asked for are separate choices. Settings are keyed by each field's
   * template variable key, so only fields with one are offered.
   */
  const customFieldSettingDefinitions: Array<KeyedIncidentCustomFieldDefinition> =
    useMemo(() => {
      return getKeyedCustomFieldDefinitions(customFieldDefinitions);
    }, [customFieldDefinitions]);

  const customFieldSettingFormFields: Array<ModelField<IncidentTemplate>> =
    useMemo(() => {
      const fields: Array<ModelField<IncidentTemplate>> =
        buildCustomFieldSettingsModelFormFields<IncidentTemplate>({
          definitions: customFieldSettingDefinitions,
          stepId: INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID,
        });

      /*
       * What Default means, above the first dropdown: a form step has a
       * title but no description, and a section needs a heading to carry
       * one.
       */
      if (fields[0]) {
        fields[0] = {
          ...fields[0],
          sectionTitle: INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_TITLE,
          sectionDescription:
            IncidentCustomFieldCreateSettingsCopy.templateDescription,
        };
      }

      return fields;
    }, [customFieldSettingDefinitions]);

  const customFieldSettingSteps: Array<FormStep<IncidentTemplate>> =
    customFieldSettingDefinitions.length > 0
      ? [
          {
            title: INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_TITLE,
            id: INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID,
          },
        ]
      : [];

  /*
   * No state is looked up to start the form with. The form used to put the
   * first state by order in Initial Incident State - not always the state
   * the server starts an incident in, and a value every new template saved
   * without anyone choosing it. Left empty, an incident declared from the
   * template starts in the project's usual starting state (its created
   * state), which is what IncidentService picks when none is given.
   */
  useEffect(() => {
    loadCustomFieldDefinitions();
  }, []);

  /*
   * The initial state, the owners and the labels of the incidents declared
   * from a template are options few templates set, so they fold under More
   * fields at the end of Incident Details - as Declare Incident folds its
   * Initial State, and a scheduled maintenance template its owners and
   * labels - rather than walking steps of one optional field each. The
   * status pages its incidents are limited to fold under More fields at the
   * end of Resources Affected, as on Declare Incident.
   */
  const advancedSection: FormFieldCollapsibleSection<IncidentTemplate> =
    getAdvancedFormSection<IncidentTemplate>();

  return (
    <Fragment>
      <ModelTable<IncidentTemplate>
        modelType={IncidentTemplate}
        enableJsonImportExport={true}
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
            "Ready-made incidents for problems you expect, with the title, severity, monitors and on-call policy filled in. Use one with Create from Template on the Incidents page.",
        }}
        noItemsMessage={"No incident templates found."}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        onBeforeCreate={async (
          item: IncidentTemplate,
          miscDataProps: JSONObject,
          formValues: JSONObject,
        ): Promise<IncidentTemplate> => {
          /*
           * From the values the form submitted, so a Number of 0 and a box
           * left unticked are kept; they travel in customFields only.
           */
          const customFields: JSONObject | undefined =
            packCustomFieldFormValues({
              definitions: customFieldDefinitions,
              formValues: formValues,
              isShown: isAskedOnIncidentForm,
            });

          removeCustomFieldFormKeys(miscDataProps);

          if (customFields) {
            item.customFields = customFields;
          }

          /*
           * The Custom Fields on Create step's choices, also from the
           * submitted values. Default says nothing, so only the fields the
           * template changes are stored; a template that changes none
           * stores no settings at all.
           */
          const customFieldSettings: CustomFieldCreateSettings =
            packCustomFieldSettingsFormValues({
              definitions: customFieldSettingDefinitions,
              formValues: formValues,
            });

          removeCustomFieldSettingsFormKeys(miscDataProps);

          if (Object.keys(customFieldSettings).length > 0) {
            item.customFieldSettings = customFieldSettings;
          }

          return item;
        }}
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
          ...customFieldSteps,
          ...customFieldSettingSteps,
          {
            title: "On-Call",
            id: "on-call",
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
              sort: {
                order: SortOrder.Ascending,
              },
            },
            required: false,
            placeholder: "Incident Severity",
          },
          /*
           * Starts empty, and says what empty means: the usual starting
           * state, as on Declare Incident.
           */
          {
            field: {
              initialIncidentState: true,
            },
            title: "Initial Incident State",
            stepId: "incident-details",
            description:
              "Incidents declared from this template start in this state. Leave it empty for the usual starting state. An incident that starts acknowledged or resolved pages no one.",
            fieldType: FormFieldSchemaType.Dropdown,
            /*
             * Listed in the order an incident moves through its states, each
             * with its colour - as the severity above shows its own.
             */
            dropdownModal: {
              type: IncidentState,
              labelField: "name",
              valueField: "_id",
              sort: {
                order: SortOrder.Ascending,
              },
            },
            required: false,
            placeholder: "The usual starting state",
            collapsibleSection: advancedSection,
          },
          /*
           * People and teams in one picker, kept in ownerUsers / ownerTeams:
           * IncidentTemplateService adds them as the template's owners.
           */
          getOwnersFormField({
            stepId: "incident-details",
            description:
              "Who owns incidents declared from this template. They are notified when the incident is created or updated.",
            collapsibleSection: advancedSection,
          }),
          getLabelsFormField<IncidentTemplate>({
            stepId: "incident-details",
            description:
              "Incidents declared from this template start with these labels.",
            collapsibleSection: advancedSection,
          }),
          /*
           * Split as Declare Incident is: the monitors on their own, the
           * status they change to right under them, and everything else
           * the incidents affect below.
           */
          {
            field: {
              monitors: true,
            },
            title: "Monitors",
            stepId: "resources-affected",
            description:
              "Search and attach the monitors that incidents created from this template should pre-populate.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              values: FormValues<IncidentTemplate>,
              elementProps: CustomElementProps,
            ) => {
              return (
                <AffectedResourcesPicker
                  monitors={values.monitors as Array<Monitor>}
                  resourceTypes={["Monitor"]}
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
              currentValues: FormValues<IncidentTemplate>,
              setNewFormValues: (values: FormValues<IncidentTemplate>) => void,
            ) => {
              // Only the monitors are this picker's to write.
              if (isAffectedResourcesPayload(value)) {
                const payload: typeof value = value;
                queueMicrotask(() => {
                  setNewFormValues({
                    ...currentValues,
                    monitors: payload.monitors,
                  } as FormValues<IncidentTemplate>);
                });
              }
            },
          },
          /*
           * Always asked here, monitors picked or not: a template's status
           * also applies to the monitors picked when an incident is
           * declared from it, where Declare Incident shows it once the
           * first monitor is picked.
           */
          {
            field: {
              changeMonitorStatusTo: true,
            },
            title: "Change Monitor Status to",
            stepId: "resources-affected",
            description:
              "Incidents declared from this template change the status of their monitors to this one - the monitors picked here and any picked when the incident is declared.",
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
          },
          {
            // Anchored on `hosts`; the payload is split back below.
            field: {
              hosts: true,
            },
            title: "Other Affected Resources",
            stepId: "resources-affected",
            description:
              "Search and attach hosts, Kubernetes clusters, Docker hosts, or services that incidents created from this template should pre-populate.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              values: FormValues<IncidentTemplate>,
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
                  services={values.services as Array<Service>}
                  resourceTypes={[
                    "Host",
                    "KubernetesCluster",
                    "DockerHost",
                    "PodmanHost",
                    "Service",
                  ]}
                  ariaLabelledby={elementProps.ariaLabelledby}
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
              // The monitors are the other picker's: not written here.
              if (isAffectedResourcesPayload(value)) {
                const payload: typeof value = value;
                queueMicrotask(() => {
                  setNewFormValues({
                    ...currentValues,
                    hosts: payload.hosts,
                    kubernetesClusters: payload.kubernetesClusters,
                    dockerHosts: payload.dockerHosts,
                    podmanHosts: payload.podmanHosts,
                    services: payload.services,
                  } as FormValues<IncidentTemplate>);
                });
              }
            },
          },
          /*
           * More fields: the status pages incidents declared from this template
           * are limited to - a 'Region East outage' template can carry the
           * East site pages.
           */
          {
            field: {
              statusPages: true,
            },
            title: IncidentStatusPageScopeCopy.pickerTitle,
            stepId: "resources-affected",
            description: IncidentStatusPageScopeCopy.templatePickerDescription,
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: StatusPage,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: IncidentStatusPageScopeCopy.pickerPlaceholder,
            collapsibleSection: advancedSection,
          },
          /*
           * Hidden registrations so ModelForm.getSelectFields includes
           * kubernetesClusters/dockerHosts/podmanHosts/services on load and
           * submit (hosts is the picker's anchor above).
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
            field: { services: true },
            stepId: "resources-affected",
            title: "",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            showIf: () => {
              return false;
            },
          },
          ...customFieldFormFields,
          ...customFieldSettingFormFields,
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
