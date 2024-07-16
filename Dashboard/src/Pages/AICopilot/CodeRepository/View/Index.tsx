import LabelsElement from "../../../../Components/Label/Labels";
import PageComponentProps from "../../../PageComponentProps";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import ObjectID from "Common/Types/ObjectID";
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
  useEffect,
  useState,
} from "react";
import CopilotLastRunAt from "../../../../Components/Copilot/LastRunMessage";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import PageMap from "../../../../Utils/PageMap";
import ServiceCopilotCodeRepository from "Model/Models/ServiceCopilotCodeRepository";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import API from "CommonUI/src/Utils/API/API";
import Alert, { AlertType } from "CommonUI/src/Components/Alerts/Alert";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";

const CopilotPageView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [codeRepository, setCodeRepository] =
    useState<CopilotCodeRepository | null>(null);

  const [serviceCount, setServiceCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  type FetchServiceCount = () => Promise<void>;

  const fetchServiceCount: FetchServiceCount = async (): Promise<void> => {
    try {
      const count: number = await ModelAPI.count<ServiceCopilotCodeRepository>({
        modelType: ServiceCopilotCodeRepository,
        query: {
          codeRepositoryId: modelId,
        },
      });

      setServiceCount(count);
    } catch (error: unknown) {
      setError(API.getFriendlyMessage(error));
    }
  };

  useEffect(() => {
    fetchServiceCount().catch((error: unknown) => {
      setError(API.getFriendlyMessage(error));
    });
  }, []);

  if (error) {
    return <ErrorMessage error={error} />;
  }

  return (
    <Fragment>
      {/* CopilotCodeRepository View  */}

      {serviceCount !== null && serviceCount === 0 && (
        <Alert
          className="cursor-pointer"
          type={AlertType.WARNING}
          strongTitle="Next Step"
          title="Please click here to add services to this code repository."
          onClick={() => {
            return Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_SERVICES]!,
                { modelId: modelId },
              ),
            );
          }}
        />
      )}

      <CopilotLastRunAt
        codeRepositoryId={modelId}
        lastRunAt={codeRepository?.lastCopilotRunDateTime}
      />

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
            if (!codeRepository) {
              setCodeRepository(item);
            }
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

export default CopilotPageView;
