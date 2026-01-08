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
  onInstallationExpired?: () => void; // Called when the GitHub App installation is no longer valid
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
      const errorMessage: string = API.getFriendlyErrorMessage(e as Exception);

      // Check if this is an installation not found error (app was uninstalled from GitHub)
      if (
        errorMessage.includes("installation not found") ||
        errorMessage.includes("reinstall")
      ) {
        // Notify parent that installation has expired so it can prompt re-installation
        if (props.onInstallationExpired) {
          props.onInstallationExpired();
          return;
        }
      }

      setError(errorMessage);
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
      onClose={props.onClose}
      onSubmit={onSubmit}
      submitButtonText="Connect Repository"
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      isBodyLoading={isLoading}
      isLoading={isSaving}
      error={error}
      disableSubmitButton={!selectedRepository}
    >
      <div className="space-y-5">
        {/* GitHub Header */}
        <div className="flex items-center space-x-3 pb-4 border-b border-gray-200">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              GitHub App Connected
            </h3>
            <p className="text-xs text-gray-500">
              Select a repository from your installation
            </p>
          </div>
        </div>

        {/* Empty State */}
        {repositories.length === 0 && !isLoading && (
          <div className="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center">
            <svg
              className="mx-auto h-10 w-10 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">
              No repositories found
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Make sure the GitHub App has access to at least one repository.
            </p>
          </div>
        )}

        {/* Repository Selector */}
        {repositories.length > 0 && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Repository
              </label>
              <Dropdown
                options={getRepositoryDropdownOptions()}
                onChange={onRepositorySelect}
                placeholder="Choose a repository..."
                value={getSelectedDropdownOption()}
              />
              <p className="mt-1.5 text-xs text-gray-500">
                {repositories.length} repositor
                {repositories.length === 1 ? "y" : "ies"} available
              </p>
            </div>

            {/* Selected Repository Info Card */}
            {selectedRepository && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-white border border-gray-200">
                      <svg
                        className="h-4 w-4 text-gray-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth="1.5"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                        />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-900">
                          {selectedRepository.fullName}
                        </span>
                        {selectedRepository.private ? (
                          <span className="inline-flex items-center rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700 ring-1 ring-inset ring-yellow-600/20">
                            Private
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                            Public
                          </span>
                        )}
                      </div>
                      {selectedRepository.description && (
                        <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">
                          {selectedRepository.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 pt-3 border-t border-gray-200">
                  <div className="flex items-center space-x-2 text-xs text-gray-600">
                    <svg
                      className="h-4 w-4 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    <span>{selectedRepository.ownerLogin}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-xs text-gray-600">
                    <svg
                      className="h-4 w-4 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5-4.5L16.5 21m0 0L12 16.5m4.5 4.5V7.5"
                      />
                    </svg>
                    <span>{selectedRepository.defaultBranch}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Display Name Input */}
            {selectedRepository && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  value={customName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setCustomName(e.target.value);
                  }}
                  placeholder="Enter a display name for this repository"
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  This name will be shown in OneUptime
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default GitHubRepoSelectorModal;
