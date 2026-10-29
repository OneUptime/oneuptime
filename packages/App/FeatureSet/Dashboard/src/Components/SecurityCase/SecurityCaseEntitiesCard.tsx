import SecurityEventSeverityPill from "../SecurityEvents/SecurityEventSeverityPill";
import AppLink from "../AppLink/AppLink";
import {
  CASE_ENTITY_RISK_COLUMN_TITLE,
  CASE_ENTITY_RISK_TOOLTIP,
  ENTITY_RISK_TEST_IDS,
} from "../SecurityEvents/EntityRisk/EntityRiskCopy";
import { getEntityRiskRoute } from "../SecurityEvents/EntityRisk/EntityRiskModel";
import { EntityRiskLevelPill } from "../SecurityEvents/EntityRisk/EntityRiskScore";
import useEntityRiskSettings, {
  EntityRiskSettings,
} from "../SecurityEvents/EntityRisk/useEntityRiskSettings";
import SecurityCaseApi, { EntityActivity } from "./SecurityCaseApi";
import { SecurityEntityChip } from "./SecurityEntityChips";
import SecurityEntityRisk from "Common/Models/DatabaseModels/SecurityEntityRisk";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import {
  getEntityRiskKey,
  getEntityRiskLevel,
  getRiskEntities,
} from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import OcsfSeverity, {
  ocsfSeverityFromId,
} from "Common/Types/SecurityEvent/OcsfSeverity";
import { SecurityEntity } from "Common/Types/SecurityCase/SecurityEntity";
import Card from "Common/UI/Components/Card/Card";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// How far back the card looks: a week, long enough to see an attack's run-up.
export const ENTITY_ACTIVITY_HOURS: number = 24 * 7;

/*
 * The table is a size container: from 40rem up it has a column for each
 * fact - Type, Findings, Worst Severity, Last Seen - and below it (a phone,
 * or a narrow window beside the side menu) the entity's type and when it
 * was last seen go under its value and its worst severity under its count,
 * leaving Entity and Events: two columns a phone holds whole, the value
 * wrapping once where it is long, where three cut the value to a word a
 * line.
 * The classes are spelled out whole, so Tailwind finds them. A wide-only
 * cell is a cell by default and hidden below the width, never a bare
 * `hidden` shown again by a variant: a page's foreign `.hidden` rule would
 * keep that one hidden at every width (ForeignHiddenRuleGuard).
 */
export const ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME: string =
  "[@container(max-width:39.99rem)]:hidden";
export const ENTITIES_TABLE_NARROW_ONLY_CLASS_NAME: string =
  "[@container(min-width:40rem)]:hidden";
/*
 * The entity's risk (Security Events > Entity Risk) takes a column of its
 * own only from 52rem up, where the five beside it keep their one line
 * (a laptop beside the case's side menu is narrower); below that it goes
 * under the value, with the type.
 */
export const ENTITIES_TABLE_RISK_COLUMN_CLASS_NAME: string =
  "[@container(max-width:51.99rem)]:hidden";
export const ENTITIES_TABLE_RISK_UNDER_VALUE_CLASS_NAME: string =
  "[@container(min-width:52rem)]:hidden";

export const SECURITY_CASE_ENTITIES_TEST_IDS: {
  table: string;
  row: string;
  events: string;
  findings: string;
  severity: string;
  severityUnderCount: string;
  typeUnderValue: string;
  lastSeen: string;
  activityError: string;
} = {
  table: "security-case-entities-table",
  row: "security-case-entity-row",
  events: "security-case-entity-events",
  findings: "security-case-entity-findings",
  severity: "security-case-entity-severity",
  severityUnderCount: "security-case-entity-severity-under-count",
  typeUnderValue: "security-case-entity-type-under-value",
  lastSeen: "security-case-entity-last-seen",
  activityError: "security-case-entities-activity-error",
};

export interface ComponentProps {
  entities: Array<SecurityEntity>;
}

const SkeletonCell: FunctionComponent = (): ReactElement => {
  return (
    <span className="inline-block h-3 w-10 animate-pulse rounded bg-gray-100" />
  );
};

/*
 * An entity's risk on the case: its score and level, a link to its page,
 * where what added to it is listed. Nothing for an entity with no risk.
 */
const EntityRiskLink: FunctionComponent<{
  entityValue: string;
  entityType: string;
  score: number;
  threshold: number;
  // Named "Risk" where no column header says what the number is.
  isLabelled?: boolean | undefined;
}> = (props: {
  entityValue: string;
  entityType: string;
  score: number;
  threshold: number;
  isLabelled?: boolean | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <AppLink
      to={getEntityRiskRoute(props.entityValue, props.entityType)}
      className="inline-flex items-center gap-1.5 rounded-md hover:underline"
    >
      <span
        className="inline-flex items-center gap-1.5"
        title={translator.translateText(CASE_ENTITY_RISK_TOOLTIP)}
        data-testid={ENTITY_RISK_TEST_IDS.caseEntityRisk}
      >
        {props.isLabelled ? (
          <span className="text-xs font-medium text-gray-500">
            {translator.translateText(CASE_ENTITY_RISK_COLUMN_TITLE)}
          </span>
        ) : (
          <></>
        )}
        <span className="text-sm font-semibold tabular-nums text-gray-900">
          {translator.formatNumber(props.score)}
        </span>
        <EntityRiskLevelPill
          level={getEntityRiskLevel(props.score, props.threshold)}
        />
      </span>
    </AppLink>
  );
};

/*
 * Who and what the case is about, and how busy each has been across all the
 * project's security events this past week: a user with thousands of events
 * and findings from other rules is a different case from one seen twice.
 * A table, as every Security Events list is; each entity opens in
 * Correlate, and a user's, host's or address's risk opens its page.
 */
const SecurityCaseEntitiesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The entities' columns as wide as a person makes them (Common's
   * Table/ColumnResize): an entity gives way to 10rem, a count, a
   * severity, a time or a risk never.
   */
  const entityColumns: ResizableColumns = useResizableColumns({
    tableKey: "security-case-entities-table",
    columns: [
      { id: "entity", cellNumber: 1 },
      { id: "type", cellNumber: 2 },
      { id: "events", cellNumber: 3 },
      { id: "findings", cellNumber: 4 },
      { id: "worstSeverity", cellNumber: 5 },
      { id: "lastSeen", cellNumber: 6 },
      { id: "risk", cellNumber: 7 },
    ],
  });
  const [activity, setActivity] = useState<Map<string, EntityActivity>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // Each entity's risk score, by its risk key: only the entities that have one.
  const [riskScores, setRiskScores] = useState<Map<string, number>>(new Map());
  const riskSettings: EntityRiskSettings = useEntityRiskSettings();

  const valuesKey: string = props.entities
    .map((entity: SecurityEntity): string => {
      return entity.value;
    })
    .join("\n");

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      if (props.entities.length === 0) {
        setActivity(new Map());
        return;
      }

      setIsLoading(true);
      setError("");

      try {
        const rows: Array<EntityActivity> =
          await SecurityCaseApi.getEntityActivity({
            values: props.entities.map((entity: SecurityEntity): string => {
              return entity.value;
            }),
            hours: ENTITY_ACTIVITY_HOURS,
          });

        if (!isCurrent) {
          return;
        }

        const byValue: Map<string, EntityActivity> = new Map();

        for (const row of rows) {
          byValue.set(row.value.toLowerCase(), row);
        }

        setActivity(byValue);
      } catch (err) {
        if (isCurrent) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [valuesKey]);

  /*
   * The risk of the case's users, hosts and addresses (Security Events >
   * Entity Risk). A read that fails leaves the column empty: the activity
   * above is the card's, and says so on its own.
   */
  useEffect(() => {
    let isCurrent: boolean = true;
    const keys: Array<string> = getRiskEntities(props.entities).map(
      (entity: SecurityEntity): string => {
        return getEntityRiskKey(entity.value);
      },
    );

    if (keys.length === 0) {
      setRiskScores(new Map());
      return () => {};
    }

    ModelAPI.getList<SecurityEntityRisk>({
      modelType: SecurityEntityRisk,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
        entityKey: new Includes(keys),
      },
      limit: keys.length,
      skip: 0,
      select: { entityKey: true, riskScore: true },
      sort: {},
    })
      .then((result: ListResult<SecurityEntityRisk>) => {
        if (!isCurrent) {
          return;
        }

        const scores: Map<string, number> = new Map();

        for (const row of result.data) {
          if (row.entityKey && (row.riskScore || 0) > 0) {
            scores.set(row.entityKey, row.riskScore || 0);
          }
        }

        setRiskScores(scores);
      })
      .catch(() => {
        if (isCurrent) {
          setRiskScores(new Map());
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [valuesKey]);

  const headerCellClassName: string =
    "px-3 py-2 text-left text-xs first:pl-0 last:pr-0 font-medium uppercase tracking-wide text-gray-500";

  return (
    <Card
      title="Entities"
      description="Who and what this case is about, with their activity across all security events in the last 7 days. Open one in Correlate to see everything it touched."
    >
      {props.entities.length === 0 ? (
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.Fingerprint}
          title="This case names no users, hosts or addresses."
          isCompact={true}
        />
      ) : (
        <div className="space-y-3 [container-type:inline-size]">
          {error ? (
            <p
              className="text-sm text-amber-700"
              data-testid={SECURITY_CASE_ENTITIES_TEST_IDS.activityError}
            >
              {translator.translateTemplate(
                "Activity is not available: {{reason}}",
                { reason: error },
              )}
            </p>
          ) : (
            <></>
          )}
          <div className="overflow-x-auto">
            {entityColumns.styles}
            <table
              className={`${entityColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200 text-sm`}
              data-testid={SECURITY_CASE_ENTITIES_TEST_IDS.table}
              {...entityColumns.tableAttributes}
            >
              <thead>
                <tr>
                  <ResizableHeaderCell
                    scope="col"
                    className={headerCellClassName}
                    resize={entityColumns.getResize(
                      "entity",
                      translator.translateText("Entity") || "Entity",
                      ColumnWidthKind.Name,
                    )}
                  >
                    <span>{translator.translateText("Entity") || "Entity"}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    scope="col"
                    className={`${headerCellClassName} ${ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME}`}
                    resize={entityColumns.getResize(
                      "type",
                      translator.translateText("Type") || "Type",
                      ColumnWidthKind.Text,
                    )}
                  >
                    <span>{translator.translateText("Type") || "Type"}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    scope="col"
                    className={`${headerCellClassName} text-right`}
                  title={translator.translateText(
                    "Security events naming it in the last 7 days",
                  )}
                    resize={entityColumns.getResize(
                      "events",
                      translator.translateText("Events") || "Events",
                      ColumnWidthKind.Whole,
                    )}
                  >
                    <span>{translator.translateText("Events") || "Events"}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    scope="col"
                    className={`${headerCellClassName} text-right ${ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME}`}
                    resize={entityColumns.getResize(
                      "findings",
                      translator.translateText("Findings") || "Findings",
                      ColumnWidthKind.Whole,
                    )}
                  >
                    <span>{translator.translateText("Findings") || "Findings"}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    scope="col"
                    className={`${headerCellClassName} ${ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME}`}
                    resize={entityColumns.getResize(
                      "worstSeverity",
                      translator.translateText("Worst Severity") || "Worst Severity",
                      ColumnWidthKind.Whole,
                    )}
                  >
                    <span>{translator.translateText("Worst Severity") || "Worst Severity"}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    scope="col"
                    className={`${headerCellClassName} ${ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME}`}
                    resize={entityColumns.getResize(
                      "lastSeen",
                      translator.translateText("Last Seen") || "Last Seen",
                      ColumnWidthKind.Whole,
                    )}
                  >
                    <span>{translator.translateText("Last Seen") || "Last Seen"}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    scope="col"
                    className={`${headerCellClassName} ${ENTITIES_TABLE_RISK_COLUMN_CLASS_NAME}`}
                    resize={entityColumns.getResize(
                      "risk",
                      translator.translateText(CASE_ENTITY_RISK_COLUMN_TITLE) || CASE_ENTITY_RISK_COLUMN_TITLE,
                      ColumnWidthKind.Whole,
                    )}
                  >
                    <span>{translator.translateText(CASE_ENTITY_RISK_COLUMN_TITLE) || CASE_ENTITY_RISK_COLUMN_TITLE}</span>
                  </ResizableHeaderCell>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {props.entities.map(
                  (entity: SecurityEntity, index: number): ReactElement => {
                    const row: EntityActivity | undefined = activity.get(
                      entity.value.toLowerCase(),
                    );
                    const isRowLoading: boolean = isLoading && !row;
                    const severity: OcsfSeverity | undefined =
                      row && row.findingCount > 0
                        ? ocsfSeverityFromId(row.maxSeverityId)
                        : undefined;
                    const type: string =
                      translator.translateText(entity.type) || entity.type;
                    const lastSeen: string | undefined = row?.lastSeen
                      ? OneUptimeDate.fromNow(row.lastSeen)
                      : undefined;
                    const riskScore: number | undefined = riskScores.get(
                      getEntityRiskKey(entity.value),
                    );
                    const getRiskLink: (
                      isLabelled: boolean,
                    ) => ReactElement | null = (
                      isLabelled: boolean,
                    ): ReactElement | null => {
                      return riskScore !== undefined ? (
                        <EntityRiskLink
                          entityValue={entity.value}
                          entityType={entity.type}
                          score={riskScore}
                          threshold={riskSettings.threshold}
                          isLabelled={isLabelled}
                        />
                      ) : null;
                    };
                    // Drawn in its column, or under the count on a narrow table.
                    const severityPill: ReactElement | null = severity ? (
                      <span
                        title={translator.translatePlural(
                          {
                            one: "{{count}} finding names it",
                            other: "{{count}} findings name it",
                          },
                          row?.findingCount || 0,
                        )}
                      >
                        <SecurityEventSeverityPill severityName={severity} />
                      </span>
                    ) : null;

                    return (
                      <tr
                        key={`${entity.type}-${entity.value}-${index}`}
                        className="hover:bg-gray-50"
                        data-testid={SECURITY_CASE_ENTITIES_TEST_IDS.row}
                      >
                        <td className="px-3 py-2.5 align-top first:pl-0 last:pr-0">
                          {/*
                           * Wrapped, not cut short: on a phone the column
                           * leaves the count room beside it.
                           */}
                          <SecurityEntityChip
                            entity={entity}
                            isValueWrapped={true}
                          />
                          {/*
                           * The type and when, under the value while their
                           * columns are left out - wrapping without leaving
                           * one word alone on its last line.
                           */}
                          <div
                            className={`mt-0.5 pl-0.5 text-xs text-gray-500 text-pretty ${ENTITIES_TABLE_NARROW_ONLY_CLASS_NAME}`}
                            data-testid={
                              SECURITY_CASE_ENTITIES_TEST_IDS.typeUnderValue
                            }
                          >
                            {type}
                            {lastSeen ? (
                              <>
                                {" · "}
                                {translator.translateTemplate(
                                  "last seen {{when}}",
                                  { when: lastSeen },
                                )}
                              </>
                            ) : (
                              <></>
                            )}
                          </div>
                          {/* Its risk, under the value while its column is left out. */}
                          {riskScore !== undefined ? (
                            <div
                              className={`mt-1 ${ENTITIES_TABLE_RISK_UNDER_VALUE_CLASS_NAME}`}
                              data-testid={
                                ENTITY_RISK_TEST_IDS.caseEntityRiskUnderValue
                              }
                            >
                              {getRiskLink(true)}
                            </div>
                          ) : (
                            <></>
                          )}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2.5 first:pl-0 last:pr-0 align-top text-gray-700 ${ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME}`}
                        >
                          {type}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 first:pl-0 last:pr-0 text-right align-top font-semibold tabular-nums text-gray-900">
                          <span
                            data-testid={SECURITY_CASE_ENTITIES_TEST_IDS.events}
                          >
                            {isRowLoading ? (
                              <SkeletonCell />
                            ) : (
                              translator.formatNumber(row?.eventCount || 0)
                            )}
                          </span>
                          {/* The worst severity, under the count while its column is left out. */}
                          {severityPill && !isRowLoading ? (
                            <div
                              className={`mt-1 font-normal ${ENTITIES_TABLE_NARROW_ONLY_CLASS_NAME}`}
                              data-testid={
                                SECURITY_CASE_ENTITIES_TEST_IDS.severityUnderCount
                              }
                            >
                              {severityPill}
                            </div>
                          ) : (
                            <></>
                          )}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2.5 first:pl-0 last:pr-0 text-right align-top tabular-nums text-gray-700 ${ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME}`}
                          data-testid={SECURITY_CASE_ENTITIES_TEST_IDS.findings}
                        >
                          {isRowLoading ? (
                            <SkeletonCell />
                          ) : (
                            translator.formatNumber(row?.findingCount || 0)
                          )}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2.5 first:pl-0 last:pr-0 align-top ${ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME}`}
                          data-testid={SECURITY_CASE_ENTITIES_TEST_IDS.severity}
                        >
                          {isRowLoading ? (
                            <SkeletonCell />
                          ) : severityPill ? (
                            severityPill
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2.5 first:pl-0 last:pr-0 align-top text-gray-500 ${ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME}`}
                          data-testid={SECURITY_CASE_ENTITIES_TEST_IDS.lastSeen}
                        >
                          {isRowLoading ? <SkeletonCell /> : lastSeen || "-"}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2.5 first:pl-0 last:pr-0 align-top ${ENTITIES_TABLE_RISK_COLUMN_CLASS_NAME}`}
                          data-testid={
                            ENTITY_RISK_TEST_IDS.caseEntityRiskColumn
                          }
                        >
                          {getRiskLink(false) || (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
};

export default SecurityCaseEntitiesCard;
