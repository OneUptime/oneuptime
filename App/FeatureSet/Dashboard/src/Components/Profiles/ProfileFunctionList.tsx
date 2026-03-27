import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
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
import ProfileUtil, { ParsedStackFrame } from "../../Utils/ProfileUtil";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

export interface ProfileFunctionListProps {
  profileId: string;
  profileType?: string | undefined;
}

interface FunctionRow {
  functionName: string;
  fileName: string;
  selfValue: number;
  totalValue: number;
  sampleCount: number;
}

type SortField =
  | "functionName"
  | "fileName"
  | "selfValue"
  | "totalValue"
  | "sampleCount";

const ProfileFunctionList: FunctionComponent<ProfileFunctionListProps> = (
  props: ProfileFunctionListProps,
): ReactElement => {
  const [samples, setSamples] = useState<Array<ProfileSample>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("selfValue");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

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
    const functionMap: Map<
      string,
      {
        functionName: string;
        fileName: string;
        selfValue: number;
        totalValue: number;
        sampleCount: number;
      }
    > = new Map();

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
            selfValue: 0,
            totalValue: 0,
            sampleCount: 0,
          };
          functionMap.set(key, entry);
        }

        // Only add total value once per sample (avoid double-counting recursive calls)
        if (!seenInThisSample.has(key)) {
          entry.totalValue += value;
          entry.sampleCount += 1;
          seenInThisSample.add(key);
        }

        // Self value is only for the leaf frame
        if (i === stacktrace.length - 1) {
          entry.selfValue += value;
        }
      }
    }

    return Array.from(functionMap.values());
  }, [samples]);

  const sortedRows: Array<FunctionRow> = useMemo(() => {
    const rows: Array<FunctionRow> = [...functionRows];

    rows.sort((a: FunctionRow, b: FunctionRow) => {
      let aVal: string | number = a[sortField];
      let bVal: string | number = b[sortField];

      if (typeof aVal === "string") {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }

      if (aVal < bVal) {
        return sortDirection === "asc" ? -1 : 1;
      }
      if (aVal > bVal) {
        return sortDirection === "asc" ? 1 : -1;
      }
      return 0;
    });

    return rows;
  }, [functionRows, sortField, sortDirection]);

  const handleSort: (field: SortField) => void = useCallback(
    (field: SortField): void => {
      if (field === sortField) {
        setSortDirection((prev: "asc" | "desc") => {
          return prev === "asc" ? "desc" : "asc";
        });
      } else {
        setSortField(field);
        setSortDirection("desc");
      }
    },
    [sortField],
  );

  const getSortIndicator: (field: SortField) => string = useCallback(
    (field: SortField): string => {
      if (field !== sortField) {
        return "";
      }
      return sortDirection === "asc" ? " \u2191" : " \u2193";
    },
    [sortField, sortDirection],
  );

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
      <div className="p-8 text-center text-gray-500">
        No profile samples found for this profile.
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm text-left border border-gray-200 rounded">
        <thead className="bg-gray-50 text-gray-700 font-medium">
          <tr>
            <th
              className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
              onClick={() => {
                handleSort("functionName");
              }}
            >
              Function{getSortIndicator("functionName")}
            </th>
            <th
              className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
              onClick={() => {
                handleSort("fileName");
              }}
            >
              File{getSortIndicator("fileName")}
            </th>
            <th
              className="px-4 py-3 text-right cursor-pointer hover:bg-gray-100 select-none"
              onClick={() => {
                handleSort("selfValue");
              }}
            >
              Self Value{getSortIndicator("selfValue")}
            </th>
            <th
              className="px-4 py-3 text-right cursor-pointer hover:bg-gray-100 select-none"
              onClick={() => {
                handleSort("totalValue");
              }}
            >
              Total Value{getSortIndicator("totalValue")}
            </th>
            <th
              className="px-4 py-3 text-right cursor-pointer hover:bg-gray-100 select-none"
              onClick={() => {
                handleSort("sampleCount");
              }}
            >
              Samples{getSortIndicator("sampleCount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row: FunctionRow, index: number) => {
            return (
              <tr
                key={`${row.functionName}-${row.fileName}-${index}`}
                className="border-t border-gray-200 hover:bg-gray-50"
              >
                <td className="px-4 py-2 font-mono text-xs truncate max-w-xs">
                  {row.functionName}
                </td>
                <td className="px-4 py-2 text-gray-500 text-xs truncate max-w-xs">
                  {row.fileName || "-"}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {row.selfValue.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {row.totalValue.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {row.sampleCount.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ProfileFunctionList;
