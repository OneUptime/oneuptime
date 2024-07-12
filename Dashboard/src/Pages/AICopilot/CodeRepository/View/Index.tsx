import LabelsElement from "../../../../Components/Label/Labels";
import PageComponentProps from "../../../PageComponentProps";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "CommonUI/src/Components/Alerts/Alert";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import Navigation from "CommonUI/src/Utils/Navigation";
import CopilotCodeRepository from "Model/Models/CopilotCodeRepository";
import Label from "Model/Models/Label";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const StatusPageView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [codeRepository, setCodeRepository] =
    useState<CopilotCodeRepository | null>(null);

  return (
    <Fragment>
      {/* CopilotCodeRepository View  */}

      {codeRepository && codeRepository.lastCopilotRunDateTime && (
        <Alert
          type={AlertType.INFO}
          strongTitle="Last Run At: "
          title={`${OneUptimeDate.getDateAsLocalFormattedString(codeRepository.lastCopilotRunDateTime)}. Please re-run copilot to update data.`}
        />
      )}

      {codeRepository && !codeRepository.lastCopilotRunDateTime && (
        <Alert
          type={AlertType.INFO}
          strongTitle="Last Run At: "
          title={`No copilot run has been executed for this code repository. Please run copilot to update data.`}
        />
      )}

      <CardModelDetail<CopilotCodeRepository>
        name="Git Repository > Repository Details"
        cardProps={{
          title: "Repository Details",
          description: "Here are more details for this repository.",
        }}
        formSteps={[
          {
            title: "Repository Info",
            id: "repository-info",
          },
          {
            title: "Details",
            id: "details",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "repository-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Service Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "repository-info",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Description",
          },
          {
            field: {
              mainBranchName: true,
            },
            title: "Main Branch Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "master",
            validation: {
              minLength: 2,
              noSpaces: true,
              noSpecialCharacters: true,
            },
            stepId: "details",
          },
          {
            field: {
              repositoryHostedAt: true,
            },
            title: "Repository Hosted At",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(CodeRepositoryType),
            stepId: "details",
          },
          {
            field: {
              organizationName: true,
            },
            title: "Organization Name (on GitHub, GitLab, etc.)",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "org-name",
            stepId: "details",
          },
          {
            field: {
              repositoryName: true,
            },
            title: "Repository Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "repo-name",
            stepId: "details",
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
        modelDetailProps={{
          selectMoreFields: {
            lastCopilotRunDateTime: true,
          },
          onItemLoaded: (item: CopilotCodeRepository) => {
            setCodeRepository(item);
          },
          showDetailsInNumberOfColumns: 2,
          modelType: CopilotCodeRepository,
          id: "model-detail-service-catalog",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Service ID",
            },
            {
              field: {
                name: true,
              },
              title: "Service Name",
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
              getElement: (item: CopilotCodeRepository): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
            {
              field: {
                mainBranchName: true,
              },
              title: "Main Branch Name",
            },
            {
              field: {
                organizationName: true,
              },
              title: "Organization Name",
            },
            {
              field: {
                repositoryName: true,
              },
              title: "Repository Name",
            },
            {
              field: {
                repositoryHostedAt: true,
              },
              title: "Repository Hosted At",
            },
            {
              field: {
                secretToken: true,
              },
              title: "Secret Token",
              fieldType: FieldType.HiddenText,
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default StatusPageView;
