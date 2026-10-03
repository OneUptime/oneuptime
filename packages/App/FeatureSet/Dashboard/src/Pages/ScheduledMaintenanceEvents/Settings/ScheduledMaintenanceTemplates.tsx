import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ProjectUtil from "Common/UI/Utils/Project";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Service from "Common/Models/DatabaseModels/Service";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../../Components/AffectedResources/AffectedResourcesPicker";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import RecurringFieldElement from "Common/UI/Components/Events/RecurringFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import OneUptimeDate from "Common/Types/Date";
import RecurringArrayFieldElement from "Common/UI/Components/Events/RecurringArrayFieldElement";
import getOwnersFormField from "Common/UI/Components/PeoplePicker/OwnersFormField";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getSubscriberNotificationsSection } from "../../../Components/ScheduledMaintenance/ScheduledMaintenanceForm";

/*
 * A template is an event to schedule again and again, so its form walks the
 * steps of Create Scheduled Maintenance Event - Event, Resources Affected
 * (Components/ScheduledMaintenance/ScheduledMaintenanceForm) - with the
 * template's own name and description in front and its recurring schedule
 * at the end. Its view page edits the resources and the owners in cards of
 * their own, so its Edit leaves those out, and calls the step that is left
 * with the status pages and subscriber notifications "Status Pages".
 *
 * Built once: BasicForm folds the fields next to each other that carry the
 * same section.
 */
const advancedSection: FormFieldCollapsibleSection<ScheduledMaintenanceTemplate> =
  getAdvancedFormSection<ScheduledMaintenanceTemplate>();

const subscriberNotificationsSection: FormFieldCollapsibleSection<ScheduledMaintenanceTemplate> =
  getSubscriberNotificationsSection<ScheduledMaintenanceTemplate>();

// The recurring schedule is asked for, and needed, only for a recurring template.
const isRecurring: (
  model: FormValues<ScheduledMaintenanceTemplate>,
) => boolean = (model: FormValues<ScheduledMaintenanceTemplate>): boolean => {
  return Boolean(model.isRecurringEvent);
};

type GetTemplateFormFieldsFunction = (data: {
  isViewPage: boolean;
  excludeAffectedResources?: boolean;
}) => ModelField<ScheduledMaintenanceTemplate>[];

export const getTemplateFormFields: GetTemplateFormFieldsFunction = (data: {
  isViewPage: boolean;
  excludeAffectedResources?: boolean;
}): ModelField<ScheduledMaintenanceTemplate>[] => {
  let fields: ModelField<ScheduledMaintenanceTemplate>[] = [
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
      stepId: "event",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Event Title",
      validation: {
        minLength: 2,
      },
    },
    // Optional, as on the event itself.
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "event",
      fieldType: FormFieldSchemaType.Markdown,
      required: false,
    },
  ];

  /*
   * Owners and labels, folded under Advanced at the end of the Event step.
   * The view page lists the owners in a card of its own, so its Edit leaves
   * them out.
   */
  if (!data.isViewPage) {
    fields = fields.concat([
      // ScheduledMaintenanceTemplateService adds them as the template's owners.
      getOwnersFormField<ScheduledMaintenanceTemplate>({
        stepId: "event",
        description:
          "Who owns events scheduled from this template. They are notified when the event's status changes.",
        collapsibleSection: advancedSection,
      }),
    ]);
  }

  fields = fields.concat([
    getLabelsFormField<ScheduledMaintenanceTemplate>({
      stepId: "event",
      collapsibleSection: advancedSection,
      description:
        "Events scheduled from this template start with these labels.",
    }),
  ]);

  if (!data.excludeAffectedResources) {
    fields = fields.concat([
      {
        field: {
          monitors: true,
        },
        title: "Resources Affected",
        stepId: "resources-affected",
        description:
          "Search and attach monitors, hosts, Kubernetes clusters, Docker hosts, or services that events created from this template should pre-populate.",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: false,
        // The picker writes only what is picked: the form can be finished without it.
        customElementCanBeSkipped: true,
        getCustomElement: (
          values: FormValues<ScheduledMaintenanceTemplate>,
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
              services={values.services as Array<Service>}
              onChange={(payload: unknown) => {
                elementProps.onChange?.(payload);
              }}
            />
          );
        },
        onChange: (
          value: unknown,
          currentValues: FormValues<ScheduledMaintenanceTemplate>,
          setNewFormValues: (
            values: FormValues<ScheduledMaintenanceTemplate>,
          ) => void,
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
                podmanHosts: payload.podmanHosts,
                services: payload.services,
              } as FormValues<ScheduledMaintenanceTemplate>);
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
    ]);
  }

  fields = fields.concat([
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
    },
    /*
     * Folded to one line that says what happens; it opens by itself on a
     * template that keeps subscribers quiet or sends reminders.
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
        shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
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
        shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
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
        value: FormValues<ScheduledMaintenanceTemplate>,
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
      required: false,
    },
  ]);

  // Last on its step, folded: it changes the monitors' status while the event is ongoing.
  if (!data.excludeAffectedResources) {
    fields = fields.concat([
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
      },
    ]);
  }

  fields = fields.concat([
    {
      field: {
        isRecurringEvent: true,
      },
      title: "Recurring Event",
      stepId: "recurring",
      fieldType: FormFieldSchemaType.Toggle,
    },
    {
      field: {
        firstEventScheduledAt: true,
      },
      title: "First Event Scheduled At",
      description: "When would you like the first event to be scheduled?",
      stepId: "recurring",
      fieldType: FormFieldSchemaType.DateTime,
      showIf: isRecurring,
      required: isRecurring,
      placeholder: "Pick Date and Time",
    },
    {
      field: {
        firstEventStartsAt: true,
      },
      title: "First Event Starts At",
      description: "When does the first event start?",
      stepId: "recurring",
      fieldType: FormFieldSchemaType.DateTime,
      showIf: isRecurring,
      required: isRecurring,
      placeholder: "Pick Date and Time",
    },
    {
      field: {
        firstEventEndsAt: true,
      },
      title: "First Event Ends At",
      description: "When does the first event end?",
      stepId: "recurring",
      showIf: isRecurring,
      fieldType: FormFieldSchemaType.DateTime,
      required: isRecurring,
      placeholder: "Pick Date and Time",
    },
    {
      field: {
        recurringInterval: true,
      },
      title: "How often should this event recur?",
      stepId: "recurring",
      showIf: isRecurring,
      required: isRecurring,
      description:
        "How often would you like this event to recur? You can choose from daily, weekly, monthly, or yearly.",
      fieldType: FormFieldSchemaType.CustomComponent,
      // Writes an interval only when one is typed or picked.
      customElementCanBeSkipped: true,
      getCustomElement: (
        value: FormValues<ScheduledMaintenanceTemplate>,
        props: CustomElementProps,
      ) => {
        return (
          <RecurringFieldElement
            {...props}
            initialValue={value.recurringInterval as Recurring}
          />
        );
      },
    },
  ]);

  return fields;
};

type GetFormStepsFunction = (data: {
  isViewPage: boolean;
  excludeAffectedResources?: boolean;
}) => Array<FormStep<ScheduledMaintenanceTemplate>>;

/*
 * Template Info, Event, Resources Affected, Recurring. The view page's Edit
 * has no resources on its second step - they have a card of their own
 * there - so that step is called after what it holds: Status Pages.
 */
export const getFormSteps: GetFormStepsFunction = (data: {
  isViewPage: boolean;
  excludeAffectedResources?: boolean;
}): Array<FormStep<ScheduledMaintenanceTemplate>> => {
  return [
    {
      title: "Template Info",
      id: "template-info",
    },
    {
      title: "Event",
      id: "event",
    },
    {
      title: data.excludeAffectedResources
        ? "Status Pages"
        : "Resources Affected",
      id: "resources-affected",
    },
    {
      title: "Recurring",
      id: "recurring",
    },
  ];
};

const ScheduledMaintenanceTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceTemplate>
        modelType={ScheduledMaintenanceTemplate}
        enableJsonImportExport={true}
        id="Scheduled-Maintenance-templates-table"
        userPreferencesKey="scheduled-maintenance-templates-table"
        saveFilterProps={{
          tableId: "scheduled-maintenance-templates-table",
        }}
        name="Settings > Scheduled Maintenance Templates"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Scheduled Maintenance Templates",
          description:
            "Here is a list of all the Scheduled Maintenance templates in this project.",
        }}
        noItemsMessage={"No Scheduled Maintenance templates found."}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        formSteps={getFormSteps({
          isViewPage: false,
        })}
        formFields={getTemplateFormFields({
          isViewPage: false,
        })}
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
          {
            field: {
              scheduleNextEventAt: true,
            },
            title: "Recurring Event",
            type: FieldType.Element,
            getElement: (item: ScheduledMaintenanceTemplate) => {
              return !item.scheduleNextEventAt ? (
                <span>{translator.translateText("No")}</span>
              ) : (
                <span>
                  {translator.translateTemplate(
                    "Next event will be scheduled at {{date}}",
                    {
                      date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        item.scheduleNextEventAt,
                      ),
                    },
                  )}
                </span>
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceTemplates;
