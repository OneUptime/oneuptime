import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ProfileUtil, { ModuleCategory } from "../../Utils/ProfileUtil";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface ProfileFunctionListProps {
  profileId: string;
  profileType?: string | undefined;
  unit?: string | undefined;
}

/**
 * Wire shape of one entry returned by /telemetry/profiles/function-list.
 * Matches `FunctionListItem` on the server.
 */
interface ServerFunctionListItem {
  functionName: string;
  fileName: string;
  selfValue: number;
  totalValue: number;
  sampleCount: number;
  frameType: string;
}

interface FunctionRow {
  functionName: string;
  fileName: string;
  category: ModuleCategory;
  selfValue: number;
  totalValue: number;
  sampleCount: number;
}

type RankMode = "self" | "total";

const FUNCTION_LIST_LIMIT: number = 100;

const ProfileFunctionList: FunctionComponent<ProfileFunctionListProps> = (
  props: ProfileFunctionListProps,
): ReactElement => {
  const [functionRows, setFunctionRows] = useState<Array<FunctionRow>>([]);
  const [windowTotal, setWindowTotal] = useState<number>(0);
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [rankMode, setRankMode] = useState<RankMode>("self");
  const [onlyOwnCode, setOnlyOwnCode] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");

  /*
   * The selector pill stores either a category (e.g. "cpu") or a raw
   * type — expand it to the raw type strings agents actually emit so
   * the server filters with IN (...) instead of a literal equality
   * that would miss rows.
   */
  const queryProfileTypes: Array<string> | undefined =
    ProfileUtil.getQueryProfileTypes(props.profileType);

  const unit: string =
    props.unit ||
    (queryProfileTypes && queryProfileTypes.length > 0
      ? ProfileUtil.getProfileTypeUnit(queryProfileTypes[0]!)
      : "nanoseconds");

  const loadFunctions: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      /*
       * The server aggregates over every sample in the profile and
       * ranks before applying the limit — so the top-N is exact, which
       * a client-side aggregation of a capped raw-sample fetch can
       * never guarantee.
       */
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/profiles/function-list",
          ),
          data: {
            profileId: props.profileId,
            profileTypes: queryProfileTypes,
            limit: FUNCTION_LIST_LIMIT,
            sortBy: rankMode === "total" ? "totalValue" : "selfValue",
          },
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const items: Array<ServerFunctionListItem> = (response.data[
        "functions"
      ] || []) as unknown as Array<ServerFunctionListItem>;

      setFunctionRows(
        items.map((item: ServerFunctionListItem): FunctionRow => {
          return {
            functionName: item.functionName || "",
            fileName: item.fileName || "",
            category: ProfileUtil.getModuleCategory(item.fileName || ""),
            selfValue: Number(item.selfValue || 0),
            totalValue: Number(item.totalValue || 0),
            sampleCount: Number(item.sampleCount || 0),
          };
        }),
      );
      setWindowTotal(Number(response.data["windowTotal"] || 0));
      setIsTruncated(Boolean(response.data["truncated"]));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadFunctions();
  }, [props.profileId, props.profileType, rankMode]);

  const displayedRows: Array<FunctionRow> = useMemo(() => {
    let rows: Array<FunctionRow> = [...functionRows];

    if (onlyOwnCode) {
      rows = rows.filter((r: FunctionRow) => {
        return r.category === "own";
      });
    }

    const q: string = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r: FunctionRow) => {
        return (
          r.functionName.toLowerCase().includes(q) ||
          r.fileName.toLowerCase().includes(q)
        );
      });
    }

    return rows;
  }, [functionRows, onlyOwnCode, search]);

  const topValue: number = displayedRows[0]
    ? rankMode === "total"
      ? displayedRows[0].totalValue
      : displayedRows[0].selfValue
    : 0;

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          void loadFunctions();
        }}
      />
    );
  }

  if (functionRows.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">
        No performance data in this profile yet.
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50/50 p-3 text-xs text-gray-600 leading-relaxed">
        <div className="flex items-start gap-2">
          <Icon
            icon={IconProp.InformationCircle}
            className="h-3.5 w-3.5 mt-0.5 text-gray-400 flex-shrink-0"
          />
          <div>
            <span className="font-medium text-gray-800">Self</span> = work the
            function did itself.{" "}
            <span className="font-medium text-gray-800">Total</span> = work it
            plus everything it called. Optimizing a function only helps if it
            has a meaningful <em>self</em> value — a high total but low self
            just means it orchestrated slow work.
          </div>
        </div>
      </div>

      {isTruncated && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Icon
            icon={IconProp.Alert}
            className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-amber-500"
          />
          <span>
            Data is truncated to the largest stacks — the sample limit was hit.
            Per-function values may undercount; percentages are of the full
            window.
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => {
              setRankMode("self");
            }}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              rankMode === "self"
                ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Rank by self time
          </button>
          <button
            type="button"
            onClick={() => {
              setRankMode("total");
            }}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              rankMode === "total"
                ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Rank by total time
          </button>
        </div>

        <label className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer px-2.5 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 select-none">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            checked={onlyOwnCode}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setOnlyOwnCode(e.target.checked);
            }}
          />
          Only my code
        </label>

        <div className="relative flex-1 min-w-[180px] max-w-sm ml-auto">
          <Icon
            icon={IconProp.Search}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400"
          />
          <input
            type="text"
            placeholder="Search…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearch(e.target.value);
            }}
          />
        </div>
      </div>

      {/* Rows */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="grid grid-cols-[2.5rem_1fr_9rem_8rem] px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-200">
          <div>#</div>
          <div>Function</div>
          <div className="text-right">Self</div>
          <div className="text-right">Total</div>
        </div>

        {displayedRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No functions matched your filters.
          </div>
        ) : (
          displayedRows.map((row: FunctionRow, index: number) => {
            const primary: number =
              rankMode === "total" ? row.totalValue : row.selfValue;
            const barPct: number =
              topValue > 0 ? (primary / topValue) * 100 : 0;
            const selfSharePct: number =
              windowTotal > 0 ? (row.selfValue / windowTotal) * 100 : 0;
            const style: { bg: string } = ProfileUtil.getModuleFrameStyle(
              row.category,
              0.7,
            );

            return (
              <div
                key={`${row.functionName}-${row.fileName}-${index}`}
                className="grid grid-cols-[2.5rem_1fr_9rem_8rem] px-4 py-2.5 items-center border-t border-gray-100 hover:bg-gray-50/60 transition-colors"
              >
                <div className="text-xs font-mono text-gray-400">
                  {index + 1}
                </div>

                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-sm ${style.bg} flex-shrink-0`}
                      title={ProfileUtil.getModuleCategoryLabel(row.category)}
                    />
                    <span className="font-mono text-sm text-gray-900 truncate">
                      {row.functionName || "(anonymous)"}
                    </span>
                  </div>
                  {row.fileName && (
                    <div className="text-[11px] text-gray-400 ml-4 font-mono truncate">
                      {ProfileUtil.formatFileName(row.fileName, 80)}
                    </div>
                  )}
                  <div className="mt-1.5 ml-4 w-full max-w-lg h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        rankMode === "self" ? "bg-orange-400" : "bg-indigo-400"
                      }`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-mono font-semibold text-gray-900">
                    {ProfileUtil.formatProfileValue(row.selfValue, unit)}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {ProfileUtil.formatPercent(selfSharePct)} of total
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-mono text-gray-700">
                    {ProfileUtil.formatProfileValue(row.totalValue, unit)}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {row.sampleCount.toLocaleString()} samples
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ProfileFunctionList;
