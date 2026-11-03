import DataObservabilityApi from "./DataObservabilityApi";
import RecommendationDismissalUtil from "../Recommendations/RecommendationDismissalUtil";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import DataCheck from "Common/Models/DatabaseModels/DataCheck";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  DataAssetColumn,
  readDataAssetColumns,
} from "Common/Types/DataObservability/DataAssetColumn";
import {
  DataCheckSuggestion,
  ExistingDataCheck,
  suggestDataChecks,
  SuggestionTable,
} from "Common/Types/DataObservability/DataCheckSuggestions";
import { DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES } from "Common/Types/DataObservability/DataCheckType";
import { getDataTableKey } from "Common/Types/DataObservability/DataObservabilityMetric";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  dataAssetId: ObjectID;
  dataStoreId: ObjectID | null;
  tableName: string;
  columns: Array<DataAssetColumn>;
  // Called once a suggestion became a check, so the list below shows it.
  onChecksAdded: () => void;
}

// Dismissals of suggested checks are kept per table.
export const SUGGESTION_RESOURCE_TYPE: string = "DataAsset";

// The most other tables of the store read to find what a reference points at.
const MAX_OTHER_TABLES: number = 1000;

/*
 * The checks this table's columns call for (DataCheckSuggestions), offered
 * above its checks: add one, add them all, or dismiss one for good. Each
 * added suggestion is an ordinary check, with its alert set up as any check
 * saved by hand.
 */
const SuggestedDataChecks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [suggestions, setSuggestions] = useState<Array<DataCheckSuggestion>>(
    [],
  );
  const [readCount, setReadCount] = useState<number>(0);
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      const [checks, tables, dismissals]: [
        ListResult<DataCheck>,
        ListResult<DataAsset>,
        Array<RecommendationDismissal>,
      ] = await Promise.all([
        ModelAPI.getList<DataCheck>({
          modelType: DataCheck,
          query: { dataAssetId: props.dataAssetId },
          select: { checkType: true, columnName: true, segmentColumn: true },
          limit: 500,
          skip: 0,
          sort: {},
        }),
        props.dataStoreId
          ? ModelAPI.getList<DataAsset>({
              modelType: DataAsset,
              query: { dataStoreId: props.dataStoreId, isDropped: false },
              select: { schemaName: true, name: true, columns: true },
              limit: MAX_OTHER_TABLES,
              skip: 0,
              sort: {},
            })
          : Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 }),
        RecommendationDismissalUtil.getDismissals({
          resourceType: SUGGESTION_RESOURCE_TYPE,
          resourceId: props.dataAssetId,
          recommendationType: RecommendationType.DataCheck,
        }),
      ]);

      if (!isCurrent) {
        return;
      }

      const otherTables: Array<SuggestionTable> = tables.data
        .filter((table: DataAsset) => {
          return table.id?.toString() !== props.dataAssetId.toString();
        })
        .map((table: DataAsset): SuggestionTable => {
          return {
            tableKey: getDataTableKey(table.schemaName || "", table.name || ""),
            name: table.name || "",
            columns: readDataAssetColumns(table.columns),
          };
        });

      setSuggestions(
        suggestDataChecks({
          tableName: props.tableName,
          columns: props.columns,
          otherTables,
          existing: checks.data.map((check: DataCheck): ExistingDataCheck => {
            return {
              checkType: check.checkType || "",
              columnName: check.columnName,
              segmentColumn: check.segmentColumn,
            };
          }),
          dismissedIds: dismissals.map(
            (dismissal: RecommendationDismissal): string => {
              return dismissal.recommendationId || "";
            },
          ),
        }),
      );
    };

    read().catch((err: unknown) => {
      if (isCurrent) {
        setError(API.getFriendlyMessage(err));
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [props.dataAssetId.toString(), readCount]);

  const markWorking: (id: string, isWorking: boolean) => void = (
    id: string,
    isWorking: boolean,
  ): void => {
    setWorking((previous: Set<string>): Set<string> => {
      const next: Set<string> = new Set(previous);

      if (isWorking) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  };

  const add: (suggestion: DataCheckSuggestion) => Promise<void> = async (
    suggestion: DataCheckSuggestion,
  ): Promise<void> => {
    const check: DataCheck = new DataCheck();
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId) {
      check.projectId = projectId;
    }

    check.dataAssetId = props.dataAssetId;
    check.name = suggestion.name.slice(0, 100);
    check.description = suggestion.reason;
    check.checkType = suggestion.checkType;
    check.intervalInMinutes = DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES;
    check.alertCondition = suggestion.alertCondition;

    if (suggestion.columnName) {
      check.columnName = suggestion.columnName;
    }

    if (suggestion.segmentColumn) {
      check.segmentColumn = suggestion.segmentColumn;
    }

    if (suggestion.pattern) {
      check.pattern = suggestion.pattern;
    }

    if (suggestion.referenceTableKey) {
      check.referenceTableKey = suggestion.referenceTableKey;
    }

    if (suggestion.referenceColumnName) {
      check.referenceColumnName = suggestion.referenceColumnName;
    }

    if (suggestion.alertThreshold !== undefined) {
      check.alertThreshold = suggestion.alertThreshold;
    }

    const response: HTTPResponse<
      JSONObject | JSONArray | DataCheck | Array<DataCheck>
    > = await ModelAPI.create<DataCheck>({
      model: check,
      modelType: DataCheck,
    });
    const createdId: ObjectID | null =
      (response.data as DataCheck | undefined)?.id || null;

    if (createdId) {
      await DataObservabilityApi.syncCheckAlert(createdId);
    }
  };

  const addSuggestions: (
    chosen: Array<DataCheckSuggestion>,
  ) => Promise<void> = async (
    chosen: Array<DataCheckSuggestion>,
  ): Promise<void> => {
    setError("");

    for (const suggestion of chosen) {
      markWorking(suggestion.id, true);

      try {
        await add(suggestion);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      markWorking(suggestion.id, false);
    }

    setReadCount((count: number): number => {
      return count + 1;
    });
    props.onChecksAdded();
  };

  const dismiss: (suggestion: DataCheckSuggestion) => Promise<void> = async (
    suggestion: DataCheckSuggestion,
  ): Promise<void> => {
    setError("");
    markWorking(suggestion.id, true);

    try {
      await RecommendationDismissalUtil.dismiss({
        recommendationId: suggestion.id,
        recommendationType: RecommendationType.DataCheck,
        resourceType: SUGGESTION_RESOURCE_TYPE,
        resourceId: props.dataAssetId,
      });
      setSuggestions((previous: Array<DataCheckSuggestion>) => {
        return previous.filter((candidate: DataCheckSuggestion) => {
          return candidate.id !== suggestion.id;
        });
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    markWorking(suggestion.id, false);
  };

  if (suggestions.length === 0 && !error) {
    return <></>;
  }

  return (
    <Card
      title="Suggested Checks"
      description="Checks this table's columns call for, from their names and types. No row was read to suggest them."
      buttons={[
        {
          title: "Add All",
          phoneTitle: "Add",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Add,
          disabled: working.size > 0 || suggestions.length === 0,
          onClick: () => {
            void addSuggestions(suggestions);
          },
        },
      ]}
    >
      <div className="px-6 pb-6">
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : <></>}
        <ul className="divide-y divide-gray-100">
          {suggestions.map((suggestion: DataCheckSuggestion): ReactElement => {
            return (
              <li
                key={suggestion.id}
                className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <span className="block font-medium text-gray-900">
                    {suggestion.name}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {translator.translateText(suggestion.checkType) ||
                      suggestion.checkType}
                    {" · "}
                    {translator.translateText(suggestion.alertCondition) ||
                      suggestion.alertCondition}
                    {suggestion.alertThreshold !== undefined
                      ? ` ${suggestion.alertThreshold}`
                      : ""}
                  </span>
                  <span className="block text-sm text-gray-600">
                    {suggestion.reason}
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    title="Add"
                    buttonStyle={ButtonStyleType.NORMAL}
                    icon={IconProp.Add}
                    isLoading={working.has(suggestion.id)}
                    onClick={() => {
                      void addSuggestions([suggestion]);
                    }}
                  />
                  <Button
                    title="Dismiss"
                    buttonStyle={ButtonStyleType.OUTLINE}
                    disabled={working.has(suggestion.id)}
                    onClick={() => {
                      void dismiss(suggestion);
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
};

export default SuggestedDataChecks;
