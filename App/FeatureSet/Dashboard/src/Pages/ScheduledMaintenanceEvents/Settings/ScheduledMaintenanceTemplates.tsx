import ProjectUtil from "Common/UI/Utils/Project";
import ProjectUser from "../../../Utils/ProjectUser";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Team from "Common/Models/DatabaseModels/Team";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import RecurringFieldElement from "Common/UI/Components/Events/RecurringFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import OneUptimeDate from "Common/Types/Date";
import RecurringArrayFieldElement from "Common/UI/Components/Events/RecurringArrayFieldElement";

type GetTemplateFormFieldsFunction = (data: {
  isViewPage: boolean;
}) => ModelField<ScheduledMaintenanceTemplate>[];

export const getTemplateFormFields: GetTemplateFormFieldsFunction = (data: {
  isViewPage: boolean;
}): ModelField<ScheduledMaintenanceTemplate>[] => {
  /*
   * if its the view page then ignore the owner fields
   * because they are already on the table in the view page.
   */

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
      required: true,
    },
    {
      field: {
        monitors: true,
      },
      title: "Monitors affected ",
      stepId: "resources-affected",
      description: "Select monitors affected by this scheduled maintenance.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Monitor,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Monitors affected",
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
    },
  ];

  if (!data.isViewPage) {
    fields = fields.concat([
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
      },
    ]);
  }

  fields = fields.concat([
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
        shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
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
        shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
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
      hideOptionalLabel: true,
      fieldType: FormFieldSchemaType.DateTime,
      showIf: (model: FormValues<ScheduledMaintenanceTemplate>) => {
        return Boolean(model.isRecurringEvent);
      },
      required: false,
      placeholder: "Pick Date and Time",
    },
    {
      field: {
        firstEventStartsAt: true,
      },
      title: "First Event Starts At",
      description: "When does the first event start?",
      stepId: "recurring",
      hideOptionalLabel: true,
      fieldType: FormFieldSchemaType.DateTime,
      showIf: (model: FormValues<ScheduledMaintenanceTemplate>) => {
        return Boolean(model.isRecurringEvent);
      },
      required: false,
      placeholder: "Pick Date and Time",
    },
    {
      field: {
        firstEventEndsAt: true,
      },
      title: "First Event Ends At",
      description: "When does the first event end?",
      stepId: "recurring",
      hideOptionalLabel: true,
      showIf: (model: FormValues<ScheduledMaintenanceTemplate>) => {
        return Boolean(model.isRecurringEvent);
      },
      fieldType: FormFieldSchemaType.DateTime,
      required: false,
      placeholder: "Pick Date and Time",
    },
    {
      field: {
        recurringInterval: true,
      },
      title: "How often would you this event to recur?",
      stepId: "recurring",
      hideOptionalLabel: true,
      showIf: (model: FormValues<ScheduledMaintenanceTemplate>) => {
        return Boolean(model.isRecurringEvent);
      },
      description:
        "How often would you like this event to recur? You can choose from daily, weekly, monthly, or yearly.",
      fieldType: FormFieldSchemaType.CustomComponent,
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
}) => Array<FormStep<ScheduledMaintenanceTemplate>>;

export const getFormSteps: GetFormStepsFunction = (data: {
  isViewPage: boolean;
}): Array<FormStep<ScheduledMaintenanceTemplate>> => {
  /*
   * if its the view page then ignore the owner fields
   * because they are already on the table in the view page.
   */

  const steps: Array<FormStep<ScheduledMaintenanceTemplate>> = [
    {
      title: "Template Info",
      id: "template-info",
    },
    {
      title: "Event Details",
      id: "event-info",
    },
    {
      title: "Resources Affected",
      id: "resources-affected",
    },
    {
      title: "Status Pages",
      id: "status-pages",
    },
  ];

  if (!data.isViewPage) {
    steps.push({
      title: "Owners",
      id: "owners",
    });
  }

  steps.push({
    title: "Subscribers",
    id: "subscribers",
  });

  steps.push({
    title: "Labels",
    id: "labels",
  });

  steps.push({
    title: "Recurring",
    id: "recurring",
  });

  return steps;
};

const ScheduledMaintenanceTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceTemplate>
        modelType={ScheduledMaintenanceTemplate}
        id="Scheduled-Maintenance-templates-table"
        userPreferencesKey="scheduled-maintenance-templates-table"
        name="Settings > Scheduled Maintenance Templates"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
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
                <span>No</span>
              ) : (
                <span>
                  Next event will be scheduled at{" "}
                  {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    item.scheduleNextEventAt,
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
