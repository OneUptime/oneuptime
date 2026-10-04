import MarkdownUtil from "Common/UI/Utils/Markdown";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import StatusPageAnnouncementTemplate from "Common/Models/DatabaseModels/StatusPageAnnouncementTemplate";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StatusPagesElement from "../../../Components/StatusPage/StatusPagesElement";
import { RouteUtil } from "../../../Utils/RouteMap";

/*
 * An announcement template walks the steps of Create Announcement -
 * Announcement, then Status Pages - with its own name and description in
 * front (Components/Announcement/AnnouncementForm). A template has no
 * schedule, so its one notification switch is drawn open on Status Pages:
 * folding a single field behind a header would only add a click.
 *
 * The templates table's Create and the template page's Edit hold the same
 * fields on the same steps, so both read them from here.
 */
export const ANNOUNCEMENT_TEMPLATE_FORM_STEPS: Array<
  FormStep<StatusPageAnnouncementTemplate>
> = [
  {
    title: "Template Info",
    id: "template-info",
  },
  {
    title: "Announcement",
    id: "announcement",
  },
  {
    title: "Status Pages",
    id: "status-pages",
  },
];

export const getAnnouncementTemplateFormFields: () => Array<
  ModelField<StatusPageAnnouncementTemplate>
> = (): Array<ModelField<StatusPageAnnouncementTemplate>> => {
  return [
    {
      field: {
        templateName: true,
      },
      title: "Template Name",
      stepId: "template-info",
      description: "Name of the announcement template",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Template Name",
    },
    {
      field: {
        templateDescription: true,
      },
      title: "Template Description",
      stepId: "template-info",
      description: "Description of the announcement template",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Template Description",
    },
    {
      field: {
        title: true,
      },
      title: "Title",
      stepId: "announcement",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Announcement Title",
      validation: {
        minLength: 2,
      },
    },
    // Required, as on the announcement itself: the server requires it.
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "announcement",
      fieldType: FormFieldSchemaType.Markdown,
      required: true,
      description: MarkdownUtil.getMarkdownCheatsheet(
        "Add an announcement note",
      ),
    },
    // Optional here: an announcement made from it picks its pages then.
    {
      field: {
        statusPages: true,
      },
      title: "Show announcement on these status pages",
      stepId: "status-pages",
      description: "Select status pages to show this announcement on",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: StatusPage,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select Status Pages",
    },
    {
      field: {
        monitors: true,
      },
      title: "Monitors Affected",
      stepId: "status-pages",
      description:
        "Select monitors affected by this announcement template. If none selected, all subscribers will be notified.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Monitor,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select Monitors",
    },
    {
      field: {
        shouldStatusPageSubscribersBeNotified: true,
      },
      title: "Notify Status Page Subscribers",
      stepId: "status-pages",
      description:
        "Subscribers of these status pages are told when an announcement made from this template starts showing.",
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
    },
  ];
};

const StatusPageAnnouncementTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<StatusPageAnnouncementTemplate>
        modelType={StatusPageAnnouncementTemplate}
        id="status-page-announcement-templates-table"
        userPreferencesKey="status-page-announcement-templates-table"
        saveFilterProps={{
          tableId: "status-page-announcement-templates-table",
        }}
        name="Settings > Status Page Announcement Templates"
        isDeleteable={false}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Status Page Announcement Templates",
          description:
            "Here is a list of all the status page announcement templates in this project.",
        }}
        noItemsMessage={"No status page announcement templates found."}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        formSteps={ANNOUNCEMENT_TEMPLATE_FORM_STEPS}
        formFields={getAnnouncementTemplateFormFields()}
        showRefreshButton={true}
        filters={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            type: FieldType.Text,
          },
          {
            field: {
              title: true,
            },
            title: "Announcement Title",
            type: FieldType.Text,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            type: FieldType.Text,
          },
          {
            field: {
              title: true,
            },
            title: "Announcement Title",
            type: FieldType.Text,
          },
          {
            field: {
              statusPages: {
                _id: true,
                name: true,
              },
            },
            title: "Status Pages",
            type: FieldType.Element,
            getElement: (
              item: StatusPageAnnouncementTemplate,
            ): ReactElement => {
              return (
                <StatusPagesElement statusPages={item.statusPages || []} />
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default StatusPageAnnouncementTemplates;
