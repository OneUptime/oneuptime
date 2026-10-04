import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import StatusPageAnnouncementTemplate from "Common/Models/DatabaseModels/StatusPageAnnouncementTemplate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import StatusPagesElement from "../../../Components/StatusPage/StatusPagesElement";
import { RouteUtil } from "../../../Utils/RouteMap";
import {
  ANNOUNCEMENT_TEMPLATE_FORM_STEPS,
  getAnnouncementTemplateFormFields,
} from "../../../Components/Announcement/AnnouncementFormFields";

/*
 * A template walks the announcement's steps with its own name in front
 * (Components/Announcement/AnnouncementFormFields); the template's page
 * edits it with the same steps and fields.
 */
const StatusPageAnnouncementTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const formFields: Array<ModelField<StatusPageAnnouncementTemplate>> =
    useMemo(() => {
      return getAnnouncementTemplateFormFields();
    }, []);

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
        formFields={formFields}
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
