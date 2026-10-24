import CodeHostMark from "./CodeHostMark";
import {
  CODE_CONNECT_COPY,
  CODE_HOST_CHOICE_COPY,
  CODE_HOST_CHOICES_IN_ORDER,
} from "./CodeHostCopy";
import { UseGitHubConnect } from "./GitHubConnect";
import {
  getCodeConnectLock,
  GitHubConnectLock,
} from "../CodeRepository/GitHubConnectLock";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Where is your code? One tile per place a repository can be hosted, in
 * the order Code offers them - GitHub, GitLab, Forgejo or Gitea, any Git
 * server - each with its mark, its name and one line on how it connects.
 * GitHub's is locked on a server with no GitHub App, saying so; the others
 * need nothing set up on the server. Someone who may not connect
 * repositories at all sees every tile locked, with the reason once, below.
 */

export interface ComponentProps {
  gitHub: UseGitHubConnect;
  onChoose: (provider: CodeRepositoryType) => void;
}

export const CODE_HOST_CHOICE_TEST_ID: string = "code-host-choice";

const CodeHostChoices: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Whoever may not connect repositories at all, wherever they are hosted.
  const lock: GitHubConnectLock = getCodeConnectLock();
  const isLocked: boolean = lock.isLocked;

  return (
    <div data-testid="code-host-choices">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CODE_HOST_CHOICES_IN_ORDER.map(
          (provider: CodeRepositoryType): ReactElement => {
            const isUnavailable: boolean =
              provider === CodeRepositoryType.GitHub &&
              !props.gitHub.isGitHubAppConfigured;
            const isDisabled: boolean = isLocked || isUnavailable;

            return (
              <button
                key={provider}
                type="button"
                data-testid={CODE_HOST_CHOICE_TEST_ID}
                data-provider={provider}
                disabled={isDisabled}
                onClick={() => {
                  props.onChoose(provider);
                }}
                className={`group flex min-w-0 items-start gap-3 rounded-xl border p-4 text-left shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                  isDisabled
                    ? "cursor-not-allowed border-gray-200 bg-gray-50"
                    : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg ${
                    isDisabled
                      ? "bg-gray-200 text-gray-500"
                      : "bg-gray-900 text-white"
                  }`}
                >
                  <CodeHostMark provider={provider} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm font-semibold ${
                      isDisabled ? "text-gray-500" : "text-gray-900"
                    }`}
                  >
                    {translator.translateText(
                      CODE_HOST_CHOICE_COPY[provider].title,
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm leading-5 text-gray-500">
                    {translator.translateText(
                      isUnavailable
                        ? CODE_CONNECT_COPY.gitHubNotConfigured
                        : CODE_HOST_CHOICE_COPY[provider].description,
                    )}
                  </span>
                </span>
              </button>
            );
          },
        )}
      </div>
      {isLocked && lock.reason ? (
        <p
          data-testid="code-host-choices-lock"
          className="mt-3 text-sm text-gray-600"
        >
          {lock.reason}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * Under Code's Connect GitHub, on its first page: the other places a
 * repository can be, as three quiet buttons - each opens the connect
 * dialog at its step. Locked as the tiles are, for someone who may not
 * connect repositories.
 */
export const CodeOtherHosts: FunctionComponent<{
  // Under Connect GitHub ("Or connect from"), or the only way to connect.
  isAfterGitHub: boolean;
  onChoose: (provider: CodeRepositoryType) => void;
}> = (props: {
  isAfterGitHub: boolean;
  onChoose: (provider: CodeRepositoryType) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const lock: GitHubConnectLock = getCodeConnectLock();

  return (
    <div data-testid="code-other-hosts" className="mt-8">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-gray-200" />
        <span className="text-xs font-medium text-gray-500">
          {translator.translateText(
            props.isAfterGitHub ? "Or connect from" : "Connect from",
          )}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-gray-200" />
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {CODE_HOST_CHOICES_IN_ORDER.filter(
          (provider: CodeRepositoryType): boolean => {
            return provider !== CodeRepositoryType.GitHub;
          },
        ).map((provider: CodeRepositoryType): ReactElement => {
          return (
            <button
              key={provider}
              type="button"
              data-testid="code-other-host"
              data-provider={provider}
              disabled={lock.isLocked}
              onClick={() => {
                props.onChoose(provider);
              }}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                lock.isLocked
                  ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <CodeHostMark provider={provider} className="h-4 w-4" />
              {translator.translateText(CODE_HOST_CHOICE_COPY[provider].title)}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CodeHostChoices;
