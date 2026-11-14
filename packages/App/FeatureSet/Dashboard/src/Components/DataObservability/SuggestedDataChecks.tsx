import DataObservabilityApi from "./DataObservabilityApi";
import { getDataCheckAlertConditionWords } from "./DataCheckAlertConditionWords";
import { getDataCheckTypeLabel } from "./DataCheckTypeWords";
import DataCheckFactsLine from "./DataCheckFactsLine";
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
  DataCheckSuggestionWords,
  ExistingDataCheck,
  suggestDataChecks,
  SuggestionTable,
} from "Common/Types/DataObservability/DataCheckSuggestions";
import { DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES } from "Common/Types/DataObservability/DataCheckType";
import { DataColumnSensitivity } from "Common/Types/DataObservability/DataColumnSensitivity";
import { getDataTableKey } from "Common/Types/DataObservability/DataObservabilityMetric";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
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

/*
 * A suggested check's name, what it measures and when it alerts, and the
 * line that says why it is suggested.
 */
export const SUGGESTED_CHECK_NAME_TEST_ID: string = "suggested-check-name";
export const SUGGESTED_CHECK_FACTS_TEST_ID: string = "suggested-check-facts";
export const SUGGESTED_CHECK_REASON_TEST_ID: string = "suggested-check-reason";

// Why the suggestions could not be read, added or dismissed.
export const SUGGESTED_CHECKS_ERROR_TEST_ID: string = "suggested-checks-error";

/*
 * Each suggestion's row: its words, and its Add and Dismiss beside them
 * once the card is wide enough for both (a container query, 36rem), under
 * them before that. Keyed to the viewport (md), the buttons stood beside
 * the words from 768px, where the card beside the table's side menu is
 * some 430px wide: the words had 150px, a German column's name broke
 * mid-word ("primary_billing_conta / ct_email") and a reason ran to seven
 * lines.
 */
export const SUGGESTED_CHECKS_LIST_CLASS_NAME: string =
  "divide-y divide-gray-100 [container-type:inline-size]";

export const SUGGESTED_CHECK_ROW_CLASS_NAME: string =
  "flex flex-col gap-3 py-3 [@container(min-width:36rem)]:flex-row [@container(min-width:36rem)]:items-center [@container(min-width:36rem)]:justify-between [@container(min-width:36rem)]:gap-4";

/*
 * The row's buttons, at the start of their line under the words: a NORMAL
 * button keeps a dialog footer's margin from md up (Button's md:ml-3), and
 * Add stood 12px in from the words above it. The * covers a button a
 * tooltip wraps.
 *
 * Each button's words stay on one line (whitespace-nowrap). Below md, Add
 * is as wide as the row (a NORMAL button's w-full) and Dismiss is as wide
 * as its words, so the two shrank together and Dismiss gave up most of
 * its width: on a phone, Japanese broke it mid-word ("非表 / 示"), and
 * Persian's two words stacked in a button half as wide as they are. Add
 * gives the room now, down to its own words.
 */
export const SUGGESTED_CHECK_BUTTONS_CLASS_NAME: string =
  "flex shrink-0 gap-2 whitespace-nowrap [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0";

// The most other tables of the store read to find what a reference points at.
const MAX_OTHER_TABLES: number = 1000;

// The most a check's name and description hold.
const MAX_CHECK_NAME_LENGTH: number = 100;
const MAX_CHECK_DESCRIPTION_LENGTH: number = 500;

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

  /*
   * A suggestion's name or reason in the reader's language (#7221), with
   * the column, table and data type it names as they are. Drawn, each name
   * is set apart where it could move the words around it; saved, it is
   * not - the marks are characters, and would be kept in the check.
   */
  const wordsOf: (
    words: DataCheckSuggestionWords,
    options: { isDrawn: boolean },
  ) => string = (
    words: DataCheckSuggestionWords,
    options: { isDrawn: boolean },
  ): string => {
    return translator.translateTemplate(
      words.template,
      words.values,
      options.isDrawn ? { setsValuesApart: true } : undefined,
    );
  };

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      const [checks, tables, dismissals, sensitiveColumns]: [
        ListResult<DataCheck>,
        ListResult<DataAsset>,
        Array<RecommendationDismissal>,
        Array<DataColumnSensitivity>,
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
        // Extra to the suggestions: without it the others are still offered.
        DataObservabilityApi.getTableSensitivity(props.dataAssetId).catch(
          (): Array<DataColumnSensitivity> => {
            return [];
          },
        ),
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
          sensitiveColumns,
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
    // Added as the reader read it: its name and why, in their language.
    check.name = wordsOf(suggestion.nameWords, { isDrawn: false }).slice(
      0,
      MAX_CHECK_NAME_LENGTH,
    );
    check.description = wordsOf(suggestion.reasonWords, {
      isDrawn: false,
    }).slice(0, MAX_CHECK_DESCRIPTION_LENGTH);
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
      <div>
        {error ? (
          /*
           * Why the suggestions could not be read, added or dismissed, in
           * the words the server wrote it in - English, whatever the
           * page's language: a line of its own, read the way its words
           * are, so on an Arabic or Persian page it keeps its full stop at
           * its end, as each suggestion's name and reason do.
           */
          <IsolatedLine
            as="p"
            text={error}
            className="mb-3 break-words text-sm text-red-600"
            dataTestId={SUGGESTED_CHECKS_ERROR_TEST_ID}
          />
        ) : (
          <></>
        )}
        <ul className={SUGGESTED_CHECKS_LIST_CLASS_NAME}>
          {suggestions.map((suggestion: DataCheckSuggestion): ReactElement => {
            return (
              <li
                key={suggestion.id}
                className={SUGGESTED_CHECK_ROW_CLASS_NAME}
              >
                <div className="min-w-0 space-y-1 [@container(min-width:36rem)]:flex-1">
                  {/*
                   * The suggestion's name and reason, in the reader's
                   * language with the names it gives set apart: each line
                   * reads the way its words do, so a line the language has
                   * no words for yet reads as English, its full stop at its
                   * end, on an Arabic or Persian page too.
                   */}
                  <IsolatedLine
                    as="span"
                    text={wordsOf(suggestion.nameWords, { isDrawn: true })}
                    className="block break-words font-medium text-gray-900"
                    dataTestId={SUGGESTED_CHECK_NAME_TEST_ID}
                  />
                  <DataCheckFactsLine
                    facts={[
                      getDataCheckTypeLabel({
                        translator: translator,
                        checkType: suggestion.checkType,
                      }),
                      getDataCheckAlertConditionWords({
                        translator: translator,
                        condition: suggestion.alertCondition,
                        threshold: suggestion.alertThreshold,
                      }),
                    ]}
                    dataTestId={SUGGESTED_CHECK_FACTS_TEST_ID}
                  />
                  <IsolatedLine
                    as="span"
                    text={wordsOf(suggestion.reasonWords, { isDrawn: true })}
                    className="block break-words text-sm text-gray-600"
                    dataTestId={SUGGESTED_CHECK_REASON_TEST_ID}
                  />
                </div>
                <div className={SUGGESTED_CHECK_BUTTONS_CLASS_NAME}>
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
