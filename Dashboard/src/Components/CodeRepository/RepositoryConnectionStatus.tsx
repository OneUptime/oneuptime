import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  gitHubAppInstallationId?: string | null | undefined;
  showDescription?: boolean;
}

const RepositoryConnectionStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.gitHubAppInstallationId) {
    return (
      <div className="flex items-center space-x-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-white">
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path
              fillRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="flex flex-col">
          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
            GitHub App
          </span>
          {props.showDescription && (
            <span className="mt-1 text-xs text-gray-500">
              Connected via GitHub App integration
            </span>
          )}
        </div>
      </div>
    );
  }

  // If not connected via GitHub App, it's via access token
  return (
    <div className="flex items-center space-x-2">
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="2"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
          />
        </svg>
      </div>
      <div className="flex flex-col">
        <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
          Access Token
        </span>
        {props.showDescription && (
          <span className="mt-1 text-xs text-gray-500">
            Connected via personal access token
          </span>
        )}
      </div>
    </div>
  );
};

export default RepositoryConnectionStatus;
