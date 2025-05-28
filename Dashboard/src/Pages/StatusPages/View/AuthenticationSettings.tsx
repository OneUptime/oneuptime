import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StatusPageDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<StatusPage>
        name="Status Page > Authentication Settings"
        cardProps={{
          title: "Authentication Settings",
          description: "Authentication settings for this status page.",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              isPublicStatusPage: true,
            },
            title: "Is Visible to Public",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            placeholder: "Is this status page visible to public",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                isPublicStatusPage: true,
              },
              fieldType: FieldType.Boolean,
              title: "Is Visible to Public",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > IP Whitelist"
        cardProps={{
          title: "IP Whitelist",
          description:
            "IP Whitelist for this status page. If the status page is public then only IP addresses in this whitelist will be able to access the status page. If the status page is not public then only users who are registered as Private Users and who have access from the IP addresses in this whitelist will be able to access the status page.",
        }}
        editButtonText="Edit IP Whitelist"
        isEditable={true}
        formFields={[
          {
            field: {
              ipWhitelist: true,
            },
            title: "IP Whitelist",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Please enter the IP addresses or CIDR ranges to whitelist. One per line. This can be IPv4 or IPv6 addresses.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-ip-whitelist",
          fields: [
            {
              field: {
                ipWhitelist: true,
              },
              fieldType: FieldType.LongText,
              title: "IP Whitelist",
              placeholder:
                "No IP addresses or CIDR ranges whitelisted. This will allow all IP addresses to access the status page.",
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default StatusPageDelete;
