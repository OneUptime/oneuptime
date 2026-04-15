import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ProfileSample from "Common/Models/AnalyticsModels/ProfileSample";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ProfileUtil, {
  ModuleCategory,
  ParsedStackFrame,
} from "../../Utils/ProfileUtil";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface ProfileFunctionListProps {
  profileId: string;
  profileType?: string | undefined;
  unit?: string | undefined;
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

const ProfileFunctionList: FunctionComponent<ProfileFunctionListProps> = (
  props: ProfileFunctionListProps,
): ReactElement => {
  const [samples, setSamples] = useState<Array<ProfileSample>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [rankMode, setRankMode] = useState<RankMode>("self");
  const [onlyOwnCode, setOnlyOwnCode] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");

  const unit: string =
    props.unit ||
    (props.profileType
      ? ProfileUtil.getProfileTypeUnit(props.profileType)
      : "nanoseconds");

  const loadSamples: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const result: ListResult<ProfileSample> = await AnalyticsModelAPI.getList(
        {
          modelType: ProfileSample,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            profileId: props.profileId,
            ...(props.profileType ? { profileType: props.profileType } : {}),
          },
          select: {
            stacktrace: true,
            frameTypes: true,
            value: true,
            profileType: true,
          },
          limit: 10000,
          skip: 0,
          sort: {
            value: SortOrder.Descending,
          },
        },
      );

      setSamples(result.data || []);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSamples();
  }, [props.profileId, props.profileType]);

  const functionRows: Array<FunctionRow> = useMemo(() => {
    const functionMap: Map<string, FunctionRow> = new Map();

    for (const sample of samples) {
      const stacktrace: Array<string> = sample.stacktrace || [];
      const value: number = sample.value || 0;

      const seenInThisSample: Set<string> = new Set<string>();

      for (let i: number = 0; i < stacktrace.length; i++) {
        const frame: string = stacktrace[i]!;
        const parsed: ParsedStackFrame = ProfileUtil.parseStackFrame(frame);
        const key: string = `${parsed.functionName}@${parsed.fileName}`;

        let entry: FunctionRow | undefined = functionMap.get(key);

        if (!entry) {
          entry = {
            functionName: parsed.functionName,
            fileName: parsed.fileName,
            category: ProfileUtil.getModuleCategory(parsed.fileName),
            selfValue: 0,
            totalValue: 0,
            sampleCount: 0,
          };
          functionMap.set(key, entry);
        }

        if (!seenInThisSample.has(key)) {
          entry.totalValue += value;
          entry.sampleCount += 1;
          seenInThisSample.add(key);
        }

        if (i === stacktrace.length - 1) {
          entry.selfValue += value;
        }
      }
    }

    return Array.from(functionMap.values());
  }, [samples]);

  const totalValue: number = useMemo(() => {
    // Sum of all self values = total cost of the profile.
    let t: number = 0;
    for (const row of functionRows) {
      t += row.selfValue;
    }
    return t;
  }, [functionRows]);

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

    rows.sort((a: FunctionRow, b: FunctionRow) => {
      if (rankMode === "total") {
        return b.totalValue - a.totalValue;
      }
      return b.selfValue - a.selfValue;
    });

    return rows.slice(0, 100);
  }, [functionRows, onlyOwnCode, search, rankMode]);

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
          void loadSamples();
        }}
      />
    );
  }

  if (samples.length === 0) {
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
        <div className="grid grid-cols-[2.5rem_1fr_9rem_7rem] px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-200">
          <div>#</div>
          <div>Function</div>
          <div className="text-right">
            {rankMode === "self" ? "Self" : "Total"}
          </div>
          <div className="text-right">
            {rankMode === "self" ? "Total" : "Self"}
          </div>
        </div>

        {displayedRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No functions matched your filters.
          </div>
        ) : (
          displayedRows.map((row: FunctionRow, index: number) => {
            const primary: number =
              rankMode === "self" ? row.selfValue : row.totalValue;
            const secondary: number =
              rankMode === "self" ? row.totalValue : row.selfValue;
            const barPct: number =
              topValue > 0 ? (primary / topValue) * 100 : 0;
            const sharePct: number =
              totalValue > 0 ? (row.selfValue / totalValue) * 100 : 0;
            const style: { bg: string } = ProfileUtil.getModuleFrameStyle(
              row.category,
              0.7,
            );

            return (
              <div
                key={`${row.functionName}-${row.fileName}-${index}`}
                className="grid grid-cols-[2.5rem_1fr_9rem_7rem] px-4 py-2.5 items-center border-t border-gray-100 hover:bg-gray-50/60 transition-colors"
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
                        rankMode === "self"
                          ? "bg-orange-400"
                          : "bg-indigo-400"
                      }`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-mono font-semibold text-gray-900">
                    {ProfileUtil.formatProfileValue(primary, unit)}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {rankMode === "self"
                      ? `${ProfileUtil.formatPercent(sharePct)} of total`
                      : `${row.sampleCount.toLocaleString()} samples`}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-mono text-gray-700">
                    {ProfileUtil.formatProfileValue(secondary, unit)}
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
