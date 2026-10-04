import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageAnnouncementTemplate from "Common/Models/DatabaseModels/StatusPageAnnouncementTemplate";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StatusPagesElement from "../../../Components/StatusPage/StatusPagesElement";
import CheckboxViewer from "Common/UI/Components/Checkbox/CheckboxViewer";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  ANNOUNCEMENT_TEMPLATE_FORM_STEPS,
  getAnnouncementTemplateFormFields,
} from "./StatusPageAnnouncementTemplates";

const StatusPageAnnouncementTemplateView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* Status Page Announcement Template View  */}
      <CardModelDetail<StatusPageAnnouncementTemplate>
        name="Status Page Announcement Template Details"
        cardProps={{
          title: "Status Page Announcement Template Details",
          description:
            "Here are more details for this status page announcement template.",
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        // The steps and fields of the templates table's Create.
        formSteps={ANNOUNCEMENT_TEMPLATE_FORM_STEPS}
        formFields={getAnnouncementTemplateFormFields()}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: StatusPageAnnouncementTemplate,
          id: "model-detail-status-page-announcement-template",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Status Page Announcement Template ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                templateName: true,
              },
              title: "Template Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                templateDescription: true,
              },
              title: "Template Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                title: true,
              },
              title: "Announcement Title",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Announcement Description",
              fieldType: FieldType.Markdown,
            },
            {
              field: {
                statusPages: {
                  name: true,
                  _id: true,
                },
              },
              title: "Shown on Status Pages",
              fieldType: FieldType.Element,
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
                shouldStatusPageSubscribersBeNotified: true,
              },
              title: "Notify Status Page Subscribers",
              fieldType: FieldType.Boolean,
              getElement: (
                item: StatusPageAnnouncementTemplate,
              ): ReactElement => {
                return (
                  <CheckboxViewer
                    isChecked={
                      item.shouldStatusPageSubscribersBeNotified as boolean
                    }
                    text={
                      item.shouldStatusPageSubscribersBeNotified
                        ? "Notify Subscribers"
                        : "Do Not Notify Subscribers"
                    }
                  />
                );
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                updatedAt: true,
              },
              title: "Updated",
              fieldType: FieldType.DateTime,
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelDelete
        modelType={StatusPageAnnouncementTemplate}
        modelId={Navigation.getLastParamAsObjectID()}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES
              ] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default StatusPageAnnouncementTemplateView;
