import DashboardNavigation from "../../../../Utils/Navigation";
import PageComponentProps from "../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import CopilotPullRequest from "Common/Models/DatabaseModels/CopilotPullRequest";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";
import PullRequestStatusElement from "../../../../Components/CodeRepository/PullRequestStatus";
import CopilotCodeRepository from "Common/Models/DatabaseModels/CopilotCodeRepository";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PullRequestViewElement from "../../../../Components/CodeRepository/PullRequestView";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import CopilotLastRunAt from "../../../../Components/Copilot/LastRunMessage";
import CopilotAction from "Common/Models/DatabaseModels/CopilotAction";

const CopilotPullRequestPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const codeRepositoryId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [codeRepository, setCodeRepository] =
    useState<CopilotCodeRepository | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCodeRepository: PromiseVoidFunction = async (): Promise<void> => {
    // get item.
    setIsLoading(true);

    setError("");
    try {
      const item: CopilotCodeRepository | null = await ModelAPI.getItem({
        modelType: CopilotCodeRepository,
        id: codeRepositoryId,
        select: {
          repositoryHostedAt: true,
          repositoryName: true,
          organizationName: true,
          lastCopilotRunDateTime: true,
        },
      });

      if (!item) {
        setError(`Code Repository not found`);

        return;
      }

      setCodeRepository(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCodeRepository().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage error={error} />;
  }

  if (!codeRepository) {
    return <ErrorMessage error={"Code Repository not found"} />;
  }

  return (
    <Fragment>
      <CopilotLastRunAt
        codeRepositoryId={codeRepositoryId}
        lastRunAt={codeRepository?.lastCopilotRunDateTime}
      />

      <ModelTable<CopilotAction>
        modelType={CopilotAction}
        id="table-copiolt-pull-requests"
        name="Code Repository > Pull Requests"
        isDeleteable={false}
        isCreateable={false}
        isEditable={false}
        isViewable={false}
        showViewIdButton={false}
        query={{
          codeRepositoryId: codeRepositoryId,
          projectId: DashboardNavigation.getProjectId()!,
        }}
        cardProps={{
          title: "Pull Requests",
          description:
            "List of pull requests created by OneUptime Copilot for this code repository.",
        }}
        noItemsMessage={
          "No pull requests found. OneUptime Copilot has not created any pull requests for this code repository."
        }
        showRefreshButton={true}
        filters={[
          {
            field: {
              pullRequestId: true,
            },
            type: FieldType.Text,
            title: "Pull Request ID",
          },
          {
            field: {
              createdAt: true,
            },
            type: FieldType.DateTime,
            title: "Created At",
          },
          {
            field: {
              copilotPullRequestStatus: true,
            },
            title: "Pull Request Status",
            type: FieldType.Dropdown,
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(PullRequestState),
          },
        ]}
        columns={[
          {
            field: {
              pullRequestId: true,
            },
            title: "Pull Request ID",
            type: FieldType.Element,
            getElement: (item: CopilotPullRequest): ReactElement => {
              return (
                <PullRequestViewElement
                  pullRequestId={item.pullRequestId!}
                  organizationName={codeRepository.organizationName!}
                  repositoryName={codeRepository.repositoryName!}
                  repoType={codeRepository.repositoryHostedAt!}
                />
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
          },
          {
            field: {
              copilotPullRequestStatus: true,
            },
            title: "Pull Request Status",
            type: FieldType.Element,
            getElement: (item: CopilotPullRequest): ReactElement => {
              if (!item.copilotPullRequestStatus) {
                return <p>-</p>;
              }

              return (
                <PullRequestStatusElement
                  pullRequestStatus={item.copilotPullRequestStatus}
                />
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default CopilotPullRequestPage;
