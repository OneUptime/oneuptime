import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Modal from "Common/UI/Components/Modal/Modal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import { HOME_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Exception from "Common/Types/Exception/Exception";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
  defaultBranch: string;
  ownerLogin: string;
}

export interface ComponentProps {
  projectId: ObjectID;
  installationId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const GitHubRepoSelectorModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [repositories, setRepositories] = useState<Array<GitHubRepository>>([]);
  const [selectedRepository, setSelectedRepository] = useState<
    GitHubRepository | undefined
  >(undefined);
  const [customName, setCustomName] = useState<string>("");

  const loadRepositories: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(undefined);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get({
          url: URL.fromString(
            `${HOME_URL.toString()}/api/github/repositories/${props.projectId.toString()}/${props.installationId}`,
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const repos: Array<GitHubRepository> =
        (response.data["repositories"] as unknown as Array<GitHubRepository>) ||
        [];
      setRepositories(repos);
    } catch (e: unknown) {
      setError(API.getFriendlyErrorMessage(e as Exception));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRepositories().catch((e: unknown) => {
      setError(API.getFriendlyErrorMessage(e as Exception));
    });
  }, []);

  const getRepositoryDropdownOptions: () => Array<DropdownOption> =
    (): Array<DropdownOption> => {
      return repositories.map((repo: GitHubRepository) => {
        return {
          label: repo.fullName + (repo.private ? " (private)" : ""),
          value: repo.id.toString(),
        };
      });
    };

  const onRepositorySelect: (
    value: DropdownValue | Array<DropdownValue> | null,
  ) => void = (value: DropdownValue | Array<DropdownValue> | null): void => {
    if (!value || Array.isArray(value)) {
      return;
    }

    const repo: GitHubRepository | undefined = repositories.find(
      (r: GitHubRepository) => {
        return r.id.toString() === value?.toString();
      },
    );
    setSelectedRepository(repo);
    if (repo) {
      setCustomName(repo.fullName);
    }
  };

  const onSubmit: () => Promise<void> = async (): Promise<void> => {
    if (!selectedRepository) {
      setError("Please select a repository");
      return;
    }

    try {
      setIsSaving(true);
      setError(undefined);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(
            `${HOME_URL.toString()}/api/github/repository/connect`,
          ),
          headers: ModelAPI.getCommonHeaders(),
          data: {
            projectId: props.projectId.toString(),
            installationId: props.installationId,
            repositoryName: selectedRepository.name,
            organizationName: selectedRepository.ownerLogin,
            name: customName || selectedRepository.fullName,
            defaultBranch: selectedRepository.defaultBranch,
            repositoryUrl: selectedRepository.htmlUrl,
            description: selectedRepository.description || "",
          } as JSONObject,
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      props.onSuccess();
    } catch (e: unknown) {
      setError(API.getFriendlyErrorMessage(e as Exception));
    } finally {
      setIsSaving(false);
    }
  };

  const getSelectedDropdownOption: () => DropdownOption | undefined = ():
    | DropdownOption
    | undefined => {
    if (!selectedRepository) {
      return undefined;
    }

    return {
      label:
        selectedRepository.fullName +
        (selectedRepository.private ? " (private)" : ""),
      value: selectedRepository.id.toString(),
    };
  };

  return (
    <Modal
      title="Connect GitHub Repository"
      description="Select a repository from your GitHub App installation to connect."
      onClose={props.onClose}
      onSubmit={onSubmit}
      submitButtonText="Connect Repository"
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      isBodyLoading={isLoading}
      isLoading={isSaving}
      error={error}
      disableSubmitButton={!selectedRepository}
    >
      <div className="space-y-4">
        {repositories.length === 0 && !isLoading && (
          <div className="text-sm text-gray-600">
            No repositories found. Make sure the GitHub App has access to at
            least one repository.
          </div>
        )}

        {repositories.length > 0 && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Repository
              </label>
              <Dropdown
                options={getRepositoryDropdownOptions()}
                onChange={onRepositorySelect}
                placeholder="Select a repository"
                value={getSelectedDropdownOption()}
              />
            </div>

            {selectedRepository && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    value={customName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setCustomName(e.target.value);
                    }}
                    placeholder="Enter a display name"
                  />
                </div>

                <div className="text-sm text-gray-500 space-y-1">
                  <div>
                    <strong>Owner:</strong> {selectedRepository.ownerLogin}
                  </div>
                  <div>
                    <strong>Default Branch:</strong>{" "}
                    {selectedRepository.defaultBranch}
                  </div>
                  {selectedRepository.description && (
                    <div>
                      <strong>Description:</strong>{" "}
                      {selectedRepository.description}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default GitHubRepoSelectorModal;
