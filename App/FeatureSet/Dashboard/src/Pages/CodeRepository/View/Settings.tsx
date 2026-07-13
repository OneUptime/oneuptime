import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const CodeRepositorySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail
        name="Repository Settings"
        cardProps={{
          title: "Repository Settings",
          description: "Configure settings for your repository.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              mainBranchName: true,
            },
            title: "Main Branch",
            description:
              "The main branch of the repository (e.g., main, master).",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "main",
          },
          {
            field: {
              maxOpenFixPullRequests: true,
            },
            title: "Max Open Fix Pull Requests",
            description:
              "Maximum AI-authored fix pull requests that may be open on this repository at the same time. At the cap, new AI fix runs fail before they can push a branch. Leave empty for the default of 5; set 0 to block AI fix pull requests for this repository entirely.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "5",
          },
        ]}
        modelDetailProps={{
          modelType: CodeRepository,
          id: "model-detail-code-repository-settings",
          fields: [
            {
              field: {
                mainBranchName: true,
              },
              title: "Main Branch",
              description: "The main branch of the repository.",
              fieldType: FieldType.Text,
            },
            {
              field: {
                maxOpenFixPullRequests: true,
              },
              title: "Max Open Fix Pull Requests",
              description:
                "How many AI-authored fix pull requests may be open at once on this repository.",
              placeholder: "Default (5)",
              fieldType: FieldType.Number,
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default CodeRepositorySettings;
