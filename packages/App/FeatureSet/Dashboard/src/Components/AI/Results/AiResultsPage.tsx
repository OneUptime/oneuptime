import {
  AI_RESULTS_EMPTY_DESCRIPTION,
  AI_RESULTS_EMPTY_STATE_ID,
  AI_RESULTS_EMPTY_TITLE,
  AI_RESULTS_LOAD_ERROR,
  AI_RESULTS_NOT_READABLE_DESCRIPTION,
  AI_RESULTS_NOT_READABLE_TITLE,
  AI_RESULTS_UNREADABLE_RESPONSE,
  canReadAnyAiResults,
  hasAiResults,
  parseAiOutcomes,
} from "./AiResultsData";
import AiResultsView from "./AiResultsView";
import ProjectAiNotice from "../../AISettings/ProjectAiNotice";
import { ProjectAiNoticeContext } from "../../AISettings/ProjectAiSettingsCopy";
import { AI_OUTCOMES_PATH, AiOutcomes } from "Common/Types/AI/AiOutcomes";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Settings → AI → AI Results (issue #6800): what OneUptime AI's work came
 * to for the project over the last 12 weeks - the pages it kept from waking
 * people, the fixes that worked, the root causes it got right - so a team
 * can see whether it is worth keeping on, and whether it is getting better.
 *
 * It loads the project's outcomes (POST /ai-activity/outcomes, counted on
 * the server behind the reader's own read access) and draws AiResultsView,
 * with an empty state while there is nothing to count yet, another when
 * the reader may read none of it, a loader, and an error with a retry.
 * With AI off for the project, a notice at the top says so.
 */

const AiResultsPage: FunctionComponent = (): ReactElement => {
  const [outcomes, setOutcomes] = useState<AiOutcomes | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [refresher, setRefresher] = useState<boolean>(false);

  // The latest request: an answer to an older one (before a retry) is dropped.
  const requestRef: MutableRefObject<number> = useRef<number>(0);

  const fetchOutcomes: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const request: number = ++requestRef.current;
      setIsLoading(true);
      setError("");

      let parsed: AiOutcomes | null = null;
      let failure: string = "";

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              AI_OUTCOMES_PATH,
            ),
            data: {},
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        parsed = parseAiOutcomes(response.data);

        if (!parsed) {
          throw new Error(translateTemplate(AI_RESULTS_UNREADABLE_RESPONSE));
        }
      } catch (err) {
        parsed = null;
        failure = API.getFriendlyMessage(err);
      }

      if (request !== requestRef.current) {
        return;
      }

      setOutcomes(parsed);
      setError(failure);
      setIsLoading(false);
    }, []);

  useEffect(() => {
    fetchOutcomes().catch(() => {
      // handled inside fetchOutcomes
    });
  }, [fetchOutcomes, refresher]);

  let body: ReactElement;

  if (isLoading) {
    body = (
      <div data-testid="ai-results-loading">
        <PageLoader isVisible={true} />
      </div>
    );
  } else if (!outcomes) {
    body = (
      <div data-testid="ai-results-error">
        <ErrorMessage
          message={error || AI_RESULTS_LOAD_ERROR}
          onRefreshClick={() => {
            setRefresher(!refresher);
          }}
        />
      </div>
    );
  } else if (!canReadAnyAiResults(outcomes)) {
    body = (
      <div data-testid="ai-results-not-readable">
        <EmptyState
          id={`${AI_RESULTS_EMPTY_STATE_ID}-not-readable`}
          icon={IconProp.Lock}
          title={AI_RESULTS_NOT_READABLE_TITLE}
          description={AI_RESULTS_NOT_READABLE_DESCRIPTION}
          showSolidBackground={true}
          paddingClassName="py-12"
        />
      </div>
    );
  } else if (!hasAiResults(outcomes)) {
    body = (
      <div data-testid="ai-results-empty">
        <EmptyState
          id={AI_RESULTS_EMPTY_STATE_ID}
          icon={IconProp.ArrowTrendingUp}
          title={AI_RESULTS_EMPTY_TITLE}
          description={AI_RESULTS_EMPTY_DESCRIPTION}
          showSolidBackground={true}
          paddingClassName="py-12"
        />
      </div>
    );
  } else {
    body = <AiResultsView outcomes={outcomes} />;
  }

  return (
    <Fragment>
      <ProjectAiNotice context={ProjectAiNoticeContext.ActivityInsights} />
      {body}
    </Fragment>
  );
};

export default AiResultsPage;
