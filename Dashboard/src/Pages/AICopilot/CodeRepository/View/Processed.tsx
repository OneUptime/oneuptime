import PageComponentProps from "../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CopilotCodeRepository from "Common/Models/DatabaseModels/CopilotCodeRepository";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import CopilotActionTable from "../../../../Components/Copilot/CopilotAction/CopilotActionTable";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";

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
      <CopilotActionTable
        query={{
          codeRepositoryId,
          copilotActionStatus: CopilotActionStatus.PR_CREATED,
        }}
        title="Pull Requests"
        description="List of Pull Requests created by copilot for this repository."
        repoName={codeRepository.repositoryName!}
        repoOrganizationName={codeRepository.organizationName!}
        repoType={codeRepository.repositoryHostedAt!}
      />

      <CopilotActionTable
        query={{
          codeRepositoryId,
          copilotActionStatus: CopilotActionStatus.CANNOT_FIX,
        }}
        title="Cannot Fix"
        description="List of jobs that Copilot cannot fix for this repository."
        repoName={codeRepository.repositoryName!}
        repoOrganizationName={codeRepository.organizationName!}
        repoType={codeRepository.repositoryHostedAt!}
      />

      <CopilotActionTable
        query={{
          codeRepositoryId,
          copilotActionStatus: CopilotActionStatus.NO_ACTION_REQUIRED,
        }}
        title="No Action Required"
        description="List of jobs that Copilot has determined do not require any action for this repository."
        repoName={codeRepository.repositoryName!}
        repoOrganizationName={codeRepository.organizationName!}
        repoType={codeRepository.repositoryHostedAt!}
      />
    </Fragment>
  );
};

export default CopilotPullRequestPage;
