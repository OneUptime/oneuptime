import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import RepositoryConnectionStatus from "../../../Components/CodeRepository/RepositoryConnectionStatus";

const CodeRepositoryView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      <CardModelDetail<CodeRepository>
        name="Repository > Repository Details"
        cardProps={{
          title: "Repository Details",
        }}
        /*
         * What the repository is called: its name, description and labels
         * (folded under Advanced), on one page. Where its code lives is the
         * GitHub App's to say - it imported the repository and keeps its
         * host, organization and name, which no one can change - and its
         * main branch is set on the repository's Settings page, with the
         * other things the AI fix runs use.
         */
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Repository Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          getLabelsFormField<CodeRepository>(),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: CodeRepository,
          id: "model-detail-code-repository",
          selectMoreFields: {
            gitHubAppInstallationId: true,
          },
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Repository ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                repositoryHostedAt: true,
              },
              title: "Repository Host",
            },
            {
              field: {
                organizationName: true,
              },
              title: "Organization",
            },
            {
              field: {
                repositoryName: true,
              },
              title: "Repository",
            },
            {
              field: {
                mainBranchName: true,
              },
              title: "Main Branch",
            },
            {
              field: {
                gitHubAppInstallationId: true,
              },
              title: "Connection Type",
              fieldType: FieldType.Element,
              getElement: (item: CodeRepository): ReactElement => {
                return (
                  <RepositoryConnectionStatus
                    gitHubAppInstallationId={item.gitHubAppInstallationId}
                  />
                );
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: CodeRepository): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default CodeRepositoryView;
