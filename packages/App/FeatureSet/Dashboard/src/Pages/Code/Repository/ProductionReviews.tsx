import PageComponentProps from "../../PageComponentProps";
import CodeApi, {
  CodeRepositoryResponse,
} from "../../../Components/Code/CodeApi";
import { CODE_COLUMN_CLASS_NAME } from "../../../Components/Code/CodeAskBox";
import { getCodeHostName } from "../../../Components/Code/CodeHostCopy";
import { getRepositorySettingsRoute } from "../../../Components/Code/CodePaths";
import CodeProductionReviewAsk from "../../../Components/Code/CodeProductionReviewAsk";
import { CodeRepositorySetting } from "../../../Components/Code/CodeRepositorySettingsCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  PRODUCTION_REVIEW_COPY,
  ProductionReviewReconnect,
  getProductionReviewCommand,
  getProductionReviewReconnect,
  inReviewHostWords,
} from "../../../Components/Code/CodeProductionReviewCopy";
import CodeTaskList from "../../../Components/Code/CodeTaskList";
import { CodeTaskListKind } from "Common/Types/AI/CodeTask";
import {
  CodeHost,
  CodeHostCapability,
} from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

export const CODE_PRODUCTION_REVIEWS_TEST_ID: string =
  "code-production-reviews";

/*
 * A repository's pull requests, reviewed against production: what the
 * review does and whether it is on for the repository - how a pull request
 * gets one, on its own or by asking (the GitHub command, while the GitHub
 * App answers commands there, or Review a pull request here, on every
 * host), with a way to Settings, where it is turned on or off - then one
 * row per pull request, newest first, saying what its latest review found.
 * A row opens the review.
 *
 * GitHub, GitLab, Forgejo and Gitea repositories have them, each in its
 * host's words: GitLab says merge request (inReviewHostWords). With none
 * yet, the list says what it will hold: the status line above it already
 * says how a review comes.
 */
const CodeRepositoryProductionReviews: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const repositoryId: string = Navigation.getLastParamAsObjectID(1).toString();

  const [repository, setRepository] = useState<CodeRepositoryResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      setRepository(await CodeApi.getRepository(repositoryId));
      setError(null);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  }, [repositoryId]);

  useEffect(() => {
    load().catch(() => {
      // handled inside load
    });
  }, [load]);

  if (error && !repository) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          load().catch(() => {
            // handled inside load
          });
        }}
      />
    );
  }

  if (!repository) {
    return <PageLoader isVisible={true} />;
  }

  const provider: string | undefined = repository.repository.provider;

  /*
   * A repository on a Git server has no pull requests, so none is reviewed -
   * said plainly, with nothing to turn on (its menu does not offer the
   * page; an address can).
   */
  if (!CodeHost.can(provider, CodeHostCapability.ProductionReview)) {
    return (
      <div
        data-testid={CODE_PRODUCTION_REVIEWS_TEST_ID}
        className={`${CODE_COLUMN_CLASS_NAME} pb-10`}
      >
        <p
          data-testid="code-production-reviews-no-pull-requests"
          className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-700 shadow-sm"
        >
          {translator.translateText(PRODUCTION_REVIEW_COPY.noPullRequests)}
        </p>
      </div>
    );
  }

  // A sentence in the host's words: GitLab's merge request.
  const words: (sentence: string) => string = (sentence: string): string => {
    const inHostWords: string = inReviewHostWords(sentence, provider);

    return translator.translateText(inHostWords) || inHostWords;
  };
  const isOnGitHub: boolean =
    CodeHost.readType(provider) === CodeRepositoryType.GitHub;
  const hostName: string = getCodeHostName({
    provider,
    hostProduct: repository.repository.connection?.hostProduct,
  });
  const isOn: boolean =
    repository.repository.isProductionReviewEnabled === true;
  /*
   * A repository OneUptime no longer reaches - the GitHub App's, or a
   * GitLab, Forgejo or Gitea connection whose token was refused or that is
   * gone - has nothing reviewed, whatever its switch says: the status says
   * that, and where it is fixed.
   */
  const isConnected: boolean = repository.repository.isConnected;
  const status: "on" | "off" | "not-connected" = !isConnected
    ? "not-connected"
    : isOn
      ? "on"
      : "off";
  /*
   * The command is answered only on GitHub, while the GitHub App answers
   * commands in the repository (unset is on): the page never offers one it
   * ignores. Everywhere else Review a pull request, here, asks.
   */
  const areCommandsOn: boolean =
    isOnGitHub && repository.repository.isGitHubCommandsEnabled !== false;
  const command: ReactElement = (
    <code className="break-words rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
      {getProductionReviewCommand()}
    </code>
  );
  /*
   * Off, the one thing to do is to turn it on. Either way the link lands
   * on the switch itself, with More settings, where it is, open.
   */
  const settingsLink: ReactElement = (
    <Link
      to={getRepositorySettingsRoute(
        repositoryId,
        CodeRepositorySetting.ProductionReview,
      )}
      dataTestId="code-production-reviews-settings"
      className="font-medium text-indigo-600 hover:text-indigo-500"
    >
      <>
        {translator.translateText(
          isOn
            ? PRODUCTION_REVIEW_COPY.openSettings
            : PRODUCTION_REVIEW_COPY.turnOnInSettings,
        )}
      </>
    </Link>
  );
  /*
   * Where a repository that is not reached is fixed, named as the fix:
   * GitHub's from Code's Repositories, where GitHub is connected (Connect
   * GitHub); any other host's from its own Settings - Replace access token
   * when its server refused the token, as its Tasks say it, else Go to
   * Settings (getProductionReviewReconnect).
   */
  const reconnect: ProductionReviewReconnect = getProductionReviewReconnect(
    repository.repository,
  );
  const connectLink: ReactElement = (
    <Link
      to={
        reconnect.place === "repositories"
          ? RouteUtil.populateRouteParams(
              RouteMap[PageMap.CODE_REPOSITORIES] as Route,
            )
          : getRepositorySettingsRoute(repositoryId)
      }
      dataTestId="code-production-reviews-connect"
      className="font-medium text-indigo-600 hover:text-indigo-500"
    >
      <>{translator.translateText(reconnect.title)}</>
    </Link>
  );
  const pillClassName: string =
    status === "on"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
      : status === "not-connected"
        ? "bg-amber-50 text-amber-800 ring-amber-600/20"
        : "bg-gray-100 text-gray-600 ring-gray-500/20";
  const dotClassName: string =
    status === "on"
      ? "bg-emerald-500"
      : status === "not-connected"
        ? "bg-amber-500"
        : "bg-gray-400";

  return (
    <div
      data-testid={CODE_PRODUCTION_REVIEWS_TEST_ID}
      className={`${CODE_COLUMN_CLASS_NAME} space-y-6 pb-10`}
    >
      <div className="space-y-3">
        <p className="text-sm leading-6 text-gray-600">
          {words(PRODUCTION_REVIEW_COPY.pageDescription)}
        </p>
        <div
          data-testid="code-production-reviews-status"
          data-production-review={status}
          className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm"
        >
          <span
            className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${pillClassName}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} />
            {translator.translateText(
              status === "on"
                ? PRODUCTION_REVIEW_COPY.statusOnLabel
                : status === "not-connected"
                  ? PRODUCTION_REVIEW_COPY.statusNotConnectedLabel
                  : PRODUCTION_REVIEW_COPY.statusOffLabel,
            )}
          </span>
          <div
            data-testid="code-production-reviews-status-text"
            className="min-w-0 flex-1 basis-56"
          >
            <p className="text-gray-700">
              {status === "not-connected" ? (
                isOnGitHub ? (
                  translator.translateText(
                    PRODUCTION_REVIEW_COPY.statusNotConnected,
                  )
                ) : (
                  translator.translateTemplate(
                    inReviewHostWords(
                      PRODUCTION_REVIEW_COPY.statusNotConnectedHost,
                      provider,
                    ),
                    { host: hostName },
                  )
                )
              ) : isOn ? (
                words(PRODUCTION_REVIEW_COPY.statusOn)
              ) : areCommandsOn ? (
                <TranslatedSentence
                  template={PRODUCTION_REVIEW_COPY.statusOff}
                  slots={{ command }}
                />
              ) : (
                words(PRODUCTION_REVIEW_COPY.statusOffNoCommands)
              )}
            </p>
            {/*
             * On, the pull requests of anyone who cannot write to the
             * repository - outside contributors, forks, bots - wait to be
             * asked: with the command, or here.
             */}
            {status === "on" ? (
              <p
                data-testid="code-production-reviews-status-others"
                className="mt-1 text-gray-500"
              >
                {areCommandsOn ? (
                  <TranslatedSentence
                    template={PRODUCTION_REVIEW_COPY.statusOnOthers}
                    slots={{ command }}
                  />
                ) : (
                  words(PRODUCTION_REVIEW_COPY.statusOnOthersAsk)
                )}
              </p>
            ) : (
              <></>
            )}
          </div>
          {status === "not-connected" ? (
            connectLink
          ) : repository.canAsk ? (
            settingsLink
          ) : (
            <></>
          )}
        </div>
      </div>

      <section
        aria-labelledby="code-production-reviews-heading"
        data-testid="code-production-reviews-list"
      >
        {/*
         * The list's heading, and - for those who may ask, while the
         * repository is reached - Review a pull request: any of them, one
         * from a fork or anyone else too.
         */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
          <h2
            id="code-production-reviews-heading"
            className="flex items-baseline gap-2 text-sm font-semibold text-gray-900"
          >
            {words(PRODUCTION_REVIEW_COPY.listTitle)}
            {reviewCount ? (
              <span
                data-testid="code-production-reviews-count"
                className="text-sm font-normal text-gray-500"
              >
                {translator.formatNumber(reviewCount)}
              </span>
            ) : (
              <></>
            )}
          </h2>
          {repository.canAsk && isConnected ? (
            <CodeProductionReviewAsk
              repositoryId={repositoryId}
              provider={provider}
            />
          ) : (
            <></>
          )}
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <CodeTaskList
            scope={{ repositoryId: new ObjectID(repositoryId).toString() }}
            repositoryHost={{
              provider,
              hostProduct: repository.repository.connection?.hostProduct,
            }}
            kind={CodeTaskListKind.ProductionReviews}
            dataTestId="code-production-review-list"
            onCount={(count: number) => {
              setReviewCount(count);
            }}
            emptyState={
              <div
                data-testid="code-production-reviews-empty"
                className="px-6 py-10 text-center"
              >
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50">
                  <Icon
                    icon={IconProp.DocumentMagnifyingGlass}
                    className="h-5 w-5 text-indigo-500"
                  />
                </div>
                <p className="mt-3 text-sm font-medium text-gray-900">
                  {words(PRODUCTION_REVIEW_COPY.emptyTitle)}
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                  {words(PRODUCTION_REVIEW_COPY.emptyDescription)}
                </p>
              </div>
            }
          />
        </div>
      </section>
    </div>
  );
};

export default CodeRepositoryProductionReviews;
