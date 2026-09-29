import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
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
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";

interface OutcomeStats {
  total: number;
  open: number;
  merged: number;
  closedUnmerged: number;
  acceptanceRatePercent: number | null;
  /*
   * Merged PRs whose CI concluded Green (or expected-failure for should-fail
   * regression-test PRs). Merged PRs without CI are honestly NOT counted as
   * verified.
   */
  verifiedGreen: number;
  verifiedGreenRatePercent: number | null;
}

interface StatTile {
  key: string;
  title: string;
  value: string;
  hint: string;
  valueClassName: string;
}

const AIFixOutcomeStatValue: FunctionComponent<{
  tile: StatTile;
}> = (props: { tile: StatTile }): ReactElement => {
  return (
    <div className="mt-1">
      <div className={`text-3xl font-semibold ${props.tile.valueClassName}`}>
        {props.tile.value}
      </div>
      <div className="mt-2 text-sm text-gray-500">{props.tile.hint}</div>
    </div>
  );
};

/*
 * Outcome counts for the project's AI-authored fix pull requests — how often
 * humans merge what the agent writes. Renders nothing until the project has
 * at least one agent PR, so new projects never see an empty scoreboard.
 */
const AIFixOutcomeStats: FunctionComponent = (): ReactElement => {
  const [stats, setStats] = useState<OutcomeStats | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchStats: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        setIsLoading(true);
        setError("");

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
          verifiedGreen: (response.data?.["verifiedGreen"] as number) || 0,
          verifiedGreenRatePercent: response.data?.[
            "verifiedGreenRatePercent"
          ] as number | null,
        });
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    }, []);

  useEffect(() => {
    fetchStats().catch(() => {
      // handled inside fetchStats
    });
  }, [fetchStats]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[1, 2, 3, 4, 5].map((key: number): ReactElement => {
          return (
            <InfoCard
              key={key}
              title=""
              value={
                <div className="mt-1 space-y-2">
                  <div className="h-8 w-14 animate-pulse rounded bg-gray-100"></div>
                  <div className="h-4 w-24 animate-pulse rounded bg-gray-100"></div>
                </div>
              }
            />
          );
        })}
      </div>
    );
  }

  /*
   * A vanishing scoreboard is indistinguishable from a project with no PRs,
   * so surface the failure instead of returning nothing.
   */
  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          fetchStats().catch(() => {
            // handled inside fetchStats
          });
        }}
      />
    );
  }

  if (!stats || stats.total === 0) {
    return <Fragment />;
  }

  const tiles: Array<StatTile> = [
    {
      key: "total",
      title: "Total fix PRs",
      value: stats.total.toLocaleString(),
      hint: `${stats.open.toLocaleString()} still open`,
      valueClassName: "text-gray-900",
    },
    {
      key: "merged",
      title: "Merged",
      value: stats.merged.toLocaleString(),
      hint: "Accepted by a human reviewer",
      valueClassName: "text-emerald-600",
    },
    {
      key: "closed-unmerged",
      title: "Closed unmerged",
      value: stats.closedUnmerged.toLocaleString(),
      hint: "Rejected by a human reviewer",
      valueClassName: "text-rose-600",
    },
    {
      key: "acceptance-rate",
      title: "Acceptance rate",
      value:
        stats.acceptanceRatePercent === null
          ? "—"
          : `${stats.acceptanceRatePercent}%`,
      hint:
        stats.acceptanceRatePercent === null
          ? "No merged or closed PRs yet"
          : `${stats.merged.toLocaleString()} of ${(
              stats.merged + stats.closedUnmerged
            ).toLocaleString()} reviewed PRs merged`,
      valueClassName: "text-gray-900",
    },
    /*
     * CI-verified rate (B4 Tier 1): merged PRs whose CI concluded green (or
     * expected-failure for should-fail regression tests). Merged PRs without
     * CI count against the rate — absence of CI is never presented as
     * verified.
     */
    {
      key: "ci-verified",
      title: "CI-verified merges",
      value:
        stats.verifiedGreenRatePercent === null
          ? "—"
          : `${stats.verifiedGreenRatePercent}%`,
      hint:
        stats.verifiedGreenRatePercent === null
          ? "No merged PRs yet"
          : `${stats.verifiedGreen.toLocaleString()} of ${stats.merged.toLocaleString()} merged with CI green`,
      valueClassName: "text-gray-900",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {tiles.map((tile: StatTile): ReactElement => {
        return (
          <InfoCard
            key={tile.key}
            title={tile.title}
            value={<AIFixOutcomeStatValue tile={tile} />}
          />
        );
      })}
    </div>
  );
};

export default AIFixOutcomeStats;
