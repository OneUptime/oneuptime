import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import Card from "Common/UI/Components/Card/Card";

interface OutcomeStats {
  total: number;
  open: number;
  merged: number;
  closedUnmerged: number;
  acceptanceRatePercent: number | null;
}

/*
 * Outcome counts for the project's AI-authored fix pull requests — how often
 * humans merge what the agent writes. Renders nothing until the project has
 * at least one agent PR, so new projects never see an empty scoreboard.
 */
const AIFixOutcomeStats: FunctionComponent = (): ReactElement => {
  const [stats, setStats] = useState<OutcomeStats | undefined>(undefined);

  useEffect(() => {
    const fetchStats: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/ai-agent-task-pull-request/outcome-stats",
            ),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setStats({
          total: (response.data?.["total"] as number) || 0,
          open: (response.data?.["open"] as number) || 0,
          merged: (response.data?.["merged"] as number) || 0,
          closedUnmerged: (response.data?.["closedUnmerged"] as number) || 0,
          acceptanceRatePercent: response.data?.["acceptanceRatePercent"] as
            | number
            | null,
        });
      } catch {
        // Supplementary data — stay silent on failure.
        setStats(undefined);
      }
    };

    void fetchStats();
  }, []);

  if (!stats || stats.total === 0) {
    return <Fragment />;
  }

  return (
    <Card
      title="Fix Pull Request Outcomes"
      description="How the pull requests opened by the AI agent were received. States sync from GitHub every 30 minutes."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-100 mt-2">
        <div className="px-4 py-2">
          <div className="text-sm text-gray-500">Total fix PRs</div>
          <div className="text-2xl font-semibold text-gray-900">
            {stats.total}
          </div>
        </div>
        <div className="px-4 py-2">
          <div className="text-sm text-gray-500">Merged</div>
          <div className="text-2xl font-semibold text-emerald-600">
            {stats.merged}
          </div>
        </div>
        <div className="px-4 py-2">
          <div className="text-sm text-gray-500">Closed unmerged</div>
          <div className="text-2xl font-semibold text-rose-600">
            {stats.closedUnmerged}
          </div>
        </div>
        <div className="px-4 py-2">
          <div className="text-sm text-gray-500">Acceptance rate</div>
          <div className="text-2xl font-semibold text-gray-900">
            {stats.acceptanceRatePercent === null
              ? "—"
              : `${stats.acceptanceRatePercent}%`}
          </div>
          {stats.acceptanceRatePercent === null && (
            <div className="text-xs text-gray-400">
              No merged or closed PRs yet
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

export default AIFixOutcomeStats;
