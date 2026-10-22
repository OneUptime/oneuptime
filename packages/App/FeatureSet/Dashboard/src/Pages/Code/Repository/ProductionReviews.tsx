import PageComponentProps from "../../PageComponentProps";
import CodeApi, {
  CodeRepositoryResponse,
} from "../../../Components/Code/CodeApi";
import { CODE_COLUMN_CLASS_NAME } from "../../../Components/Code/CodeAskBox";
import { getRepositorySettingsRoute } from "../../../Components/Code/CodePaths";
import {
  PRODUCTION_REVIEW_COPY,
  getProductionReviewCommand,
} from "../../../Components/Code/CodeProductionReviewCopy";
import CodeTaskList from "../../../Components/Code/CodeTaskList";
import { CodeTaskListKind } from "Common/Types/AI/CodeTask";
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
 * review does and whether it is on for the repository - with a way to
 * Settings, where it is turned on or off - then one row per pull request,
 * newest first, saying what its latest review found. A row opens the
 * review.
 *
 * With none yet, the page says how one comes: on its own when a pull
 * request opens or changes, or by asking on the pull request.
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

  const isOn: boolean =
    repository.repository.isProductionReviewEnabled === true;
  const command: ReactElement = (
    <code className="whitespace-nowrap rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
      {getProductionReviewCommand()}
    </code>
  );
  const settingsLink: ReactElement = (
    <Link
      to={getRepositorySettingsRoute(repositoryId)}
      dataTestId="code-production-reviews-settings"
      className="font-medium text-indigo-600 hover:text-indigo-500"
    >
      <>{translator.translateText(PRODUCTION_REVIEW_COPY.openSettings)}</>
    </Link>
  );

  return (
    <div
      data-testid={CODE_PRODUCTION_REVIEWS_TEST_ID}
      className={`${CODE_COLUMN_CLASS_NAME} space-y-6 pb-10`}
    >
      <div className="space-y-3">
        <p className="text-sm leading-6 text-gray-600">
          {translator.translateText(PRODUCTION_REVIEW_COPY.pageDescription)}
        </p>
        <div
          data-testid="code-production-reviews-status"
          data-production-review={isOn ? "on" : "off"}
          className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm"
        >
          <span
            className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
              isOn
                ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                : "bg-gray-100 text-gray-600 ring-gray-500/20"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isOn ? "bg-emerald-500" : "bg-gray-400"
              }`}
            />
            {translator.translateText(
              isOn
                ? PRODUCTION_REVIEW_COPY.statusOnLabel
                : PRODUCTION_REVIEW_COPY.statusOffLabel,
            )}
          </span>
          <p className="min-w-0 flex-1 basis-56 text-gray-600">
            {isOn ? (
              translator.translateText(PRODUCTION_REVIEW_COPY.statusOn)
            ) : (
              <TranslatedSentence
                template={PRODUCTION_REVIEW_COPY.statusOff}
                slots={{ command }}
              />
            )}
          </p>
          {repository.canAsk ? settingsLink : <></>}
        </div>
      </div>

      <section
        aria-labelledby="code-production-reviews-heading"
        data-testid="code-production-reviews-list"
      >
        <h2
          id="code-production-reviews-heading"
          className="flex items-baseline gap-2 px-1 text-sm font-semibold text-gray-900"
        >
          {translator.translateText(PRODUCTION_REVIEW_COPY.pageTitle)}
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
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <CodeTaskList
            scope={{ repositoryId: new ObjectID(repositoryId).toString() }}
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
                  {translator.translateText(PRODUCTION_REVIEW_COPY.emptyTitle)}
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                  {isOn ? (
                    translator.translateText(PRODUCTION_REVIEW_COPY.emptyOn)
                  ) : (
                    <TranslatedSentence
                      template={PRODUCTION_REVIEW_COPY.emptyOff}
                      slots={{ command }}
                    />
                  )}
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
