import OneUptimeDate from "../../../Types/Date";
import DetailListSkeleton from "../Skeleton/DetailListSkeleton";
import IconProp from "../../../Types/Icon/IconProp";
import {
  readTelemetryIngestionBudgetStatus,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetScopeStatus,
  TelemetryIngestionBudgetSignalStatus,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import { Translator } from "../../../Types/Translator";
import API from "../../Utils/API/API";
import { translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Alert, { AlertType } from "../Alerts/Alert";
import { ButtonStyleType } from "../Button/Button";
import Card from "../Card/Card";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Pill from "../Pill/Pill";
import { getTableHeaderButtons } from "../Table/TableHeaderControls";
import TableEmptyState, { TableEmptyStateKind } from "../Table/TableEmptyState";
import { ColumnWidthKind } from "../Table/ColumnResize/ColumnWidths";
import ResizableHeaderCell from "../Table/ColumnResize/ResizableHeaderCell";
import { SizedColumn } from "../Table/ColumnResize/SizedColumnsStyle";
import useResizableColumns, {
  ResizableColumns,
} from "../Table/ColumnResize/useResizableColumns";
import { getTelemetryUsageSignalTitle } from "../TelemetryUsage/TelemetryUsageWords";
import {
  formatTelemetryIngestionBudgetBytes,
  formatTelemetryIngestionBudgetRate,
  getTelemetryIngestionBudgetBarPercent,
  hasTelemetryIngestionBudgets,
  isTelemetryIngestionBudgetSignalShown,
  TELEMETRY_INGESTION_BUDGET_BAR_COLORS,
  TELEMETRY_INGESTION_BUDGET_SOURCE_LABELS,
  TELEMETRY_INGESTION_BUDGET_STATE_COLORS,
  TELEMETRY_INGESTION_BUDGET_STATE_LABELS,
} from "./TelemetryIngestionBudgetWords";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TableEmptyValue from "../Table/TableEmptyValue";

/*
 * Today's telemetry ingestion budgets: for each signal with a budget or a
 * rate, what was counted against it since the budget day started, what was
 * refused, and whether it is past its warning or used up - for the project,
 * and for each of its ingestion keys with a budget of its own. Project
 * Settings > Telemetry & APM > Usage, an ingestion key's page and the Admin
 * Dashboard's project page draw it, each handing it how to read the status
 * (fetchStatus).
 */

export const TELEMETRY_INGESTION_BUDGET_STATUS_TEST_ID: string =
  "telemetry-ingestion-budget-status";

export const BUDGETS_CARD_TITLE: string = translationKey("Ingestion Budgets");
export const BUDGETS_CARD_DESCRIPTION: string = translationKey(
  "Telemetry counted against today's budgets as it arrives, decompressed. Once a daily budget is used up, that signal is refused until the budget resets at {{resetsAt}}.",
);
export const KEY_BUDGETS_CARD_TITLE: string = translationKey(
  "Ingestion Key Budgets",
);
export const KEY_BUDGETS_CARD_DESCRIPTION: string = translationKey(
  "Ingestion keys with a budget of their own. A key's budget only subdivides the project's.",
);
// A team's or a label's budget (#6386), counted as each batch is processed.
export const TEAM_LABEL_BUDGETS_STATUS_CARD_TITLE: string = translationKey(
  "Team and Label Budgets Today",
);
export const TEAM_LABEL_BUDGETS_STATUS_CARD_DESCRIPTION: string =
  translationKey(
    "What the services of each team and label sent today. Once a budget is used up, their telemetry is dropped until {{resetsAt}}, and the rest of the project keeps sending.",
  );
export const TEAM_SCOPE_LABEL: string = translationKey("Team");
export const LABEL_SCOPE_LABEL: string = translationKey("Label");
export const THIS_KEY_CARD_TITLE: string = translationKey(
  "Today's Budget Usage",
);
export const THIS_KEY_CARD_DESCRIPTION: string = translationKey(
  "What this key sent today against its own budgets. The budget day resets at {{resetsAt}}.",
);
export const NO_BUDGETS_TITLE: string = translationKey("No ingestion budgets");
export const NO_BUDGETS_DESCRIPTION: string = translationKey(
  "Every signal is accepted without a daily budget or a rate limit.",
);
export const COUNTERS_UNAVAILABLE: string = translationKey(
  "Today's counts could not be read right now. Budgets are not enforced while they cannot be counted.",
);
// An answer that is not a status: said as a failed read is, with Refresh.
export const STATUS_UNREADABLE: string = translationKey(
  "Something went wrong. Please try again.",
);

export interface ComponentProps {
  fetchStatus: () => Promise<TelemetryIngestionBudgetStatus>;
  // Draw only this ingestion key's budgets (its own page).
  ingestionKeyId?: string | undefined;
  // Draw nothing when no budget or rate is in force anywhere.
  hideWhenUnbudgeted?: boolean | undefined;
}

const getResetsAt: (status: TelemetryIngestionBudgetStatus) => string = (
  status: TelemetryIngestionBudgetStatus,
): string => {
  return OneUptimeDate.getDateAsFormattedStringInTimezone({
    date: status.resetsAt,
    timezone: status.timezone,
  });
};

/*
 * The name a table lists its scopes by: none (the project's, or one key's
 * own page), each ingestion key's, or each team's and label's (#6386).
 */
export type SignalTableNameColumn = "none" | "ingestionKey" | "teamOrLabel";

// A scope's own id, to key its rows by: the project's has none.
const getScopeRowKey: (scope: TelemetryIngestionBudgetScopeStatus) => string = (
  scope: TelemetryIngestionBudgetScopeStatus,
): string => {
  return scope.ingestionKeyId || scope.teamId || scope.labelId || "project";
};

// A team's or a label's name, and which it is, under it.
const TeamOrLabelName: FunctionComponent<{
  scope: TelemetryIngestionBudgetScopeStatus;
}> = (props: { scope: TelemetryIngestionBudgetScopeStatus }): ReactElement => {
  const translator: Translator = useTranslator();
  const isLabel: boolean =
    props.scope.scope === TelemetryIngestionBudgetScope.Label;
  const name: string | undefined = isLabel
    ? props.scope.labelName
    : props.scope.teamName;
  const kind: string = isLabel ? LABEL_SCOPE_LABEL : TEAM_SCOPE_LABEL;

  return (
    <div>
      <div className="flex items-center gap-2">
        {isLabel && props.scope.labelColor ? (
          <span
            className="inline-block h-2.5 w-2.5 flex-none rounded-full"
            style={{ backgroundColor: props.scope.labelColor }}
            role="presentation"
          />
        ) : (
          <></>
        )}
        <bdi>{name || <TableEmptyValue />}</bdi>
      </div>
      <div className="text-xs font-normal text-gray-500">
        {translator.translateText(kind) || kind}
      </div>
    </div>
  );
};

export const SignalRows: FunctionComponent<{
  scope: TelemetryIngestionBudgetScopeStatus;
  nameColumn: SignalTableNameColumn;
}> = (props: {
  scope: TelemetryIngestionBudgetScopeStatus;
  nameColumn: SignalTableNameColumn;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const signals: Array<TelemetryIngestionBudgetSignalStatus> =
    props.scope.signals.filter(isTelemetryIngestionBudgetSignalShown);
  const rowKey: string = getScopeRowKey(props.scope);

  return (
    <Fragment>
      {signals.map(
        (signal: TelemetryIngestionBudgetSignalStatus): ReactElement => {
          const state: TelemetryIngestionBudgetState = signal.state;
          const label: string = TELEMETRY_INGESTION_BUDGET_STATE_LABELS[state];

          return (
            <tr
              key={`${rowKey}-${signal.signal}`}
              data-testid={`telemetry-ingestion-budget-row-${rowKey}-${signal.signal}`}
              className="border-t border-gray-100"
            >
              {props.nameColumn === "ingestionKey" ? (
                <td className="py-3 pr-4 align-top text-sm font-medium text-gray-900">
                  <bdi>
                    {props.scope.ingestionKeyName || <TableEmptyValue />}
                  </bdi>
                </td>
              ) : (
                <></>
              )}
              {props.nameColumn === "teamOrLabel" ? (
                <td className="py-3 pr-4 align-top text-sm font-medium text-gray-900">
                  <TeamOrLabelName scope={props.scope} />
                </td>
              ) : (
                <></>
              )}
              <td className="py-3 pr-4 align-top text-sm font-medium text-gray-900">
                {getTelemetryUsageSignalTitle(signal.signal, translator)}
              </td>
              <td className="py-3 pr-4 align-top text-sm text-gray-700">
                <div className="tabular-nums">
                  {signal.usedBytes === null ? (
                    <TableEmptyValue />
                  ) : (
                    formatTelemetryIngestionBudgetBytes(
                      signal.usedBytes,
                      translator,
                    )
                  )}
                  {signal.percentUsed !== null ? (
                    <span className="ml-1 text-gray-500">
                      ({translator.formatNumber(Math.floor(signal.percentUsed))}
                      %)
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
                {signal.dailyBudgetBytes !== null ? (
                  <div
                    className="mt-1.5 h-1.5 w-32 overflow-hidden rounded-full bg-gray-100"
                    role="presentation"
                  >
                    <div
                      className={`h-1.5 rounded-full ${TELEMETRY_INGESTION_BUDGET_BAR_COLORS[state]}`}
                      style={{
                        width: `${getTelemetryIngestionBudgetBarPercent(signal)}%`,
                      }}
                    />
                  </div>
                ) : (
                  <></>
                )}
              </td>
              <td className="py-3 pr-4 align-top text-sm text-gray-700">
                <div className="tabular-nums">
                  {signal.dailyBudgetBytes === null ? (
                    <TableEmptyValue />
                  ) : (
                    formatTelemetryIngestionBudgetBytes(
                      signal.dailyBudgetBytes,
                      translator,
                    )
                  )}
                </div>
                {signal.dailyBudgetSource &&
                signal.dailyBudgetBytes !== null ? (
                  <div className="text-xs text-gray-500">
                    {translator.translateText(
                      TELEMETRY_INGESTION_BUDGET_SOURCE_LABELS[
                        signal.dailyBudgetSource
                      ],
                    )}
                  </div>
                ) : (
                  <></>
                )}
              </td>
              <td className="max-md:hidden py-3 pr-4 align-top text-sm text-gray-700 md:table-cell">
                <span className="tabular-nums">
                  {signal.rateLimitBytesPerSecond === null ? (
                    <TableEmptyValue />
                  ) : (
                    formatTelemetryIngestionBudgetRate(
                      signal.rateLimitBytesPerSecond,
                      translator,
                    )
                  )}
                </span>
              </td>
              <td className="max-md:hidden py-3 pr-4 align-top text-sm text-gray-700 md:table-cell">
                <span className="tabular-nums">
                  {signal.droppedBytes ? (
                    formatTelemetryIngestionBudgetBytes(
                      signal.droppedBytes,
                      translator,
                    )
                  ) : (
                    <TableEmptyValue />
                  )}
                </span>
              </td>
              <td className="max-md:hidden py-3 pr-4 align-top text-sm text-gray-700 md:table-cell">
                <span className="tabular-nums">
                  {signal.throttledRequests ? (
                    translator.translatePlural(
                      {
                        one: "{{count}} request",
                        other: "{{count}} requests",
                      },
                      signal.throttledRequests,
                    )
                  ) : (
                    <TableEmptyValue />
                  )}
                </span>
              </td>
              <td className="py-3 align-top text-sm">
                <Pill
                  text={label}
                  color={TELEMETRY_INGESTION_BUDGET_STATE_COLORS[state]}
                />
              </td>
            </tr>
          );
        },
      )}
    </Fragment>
  );
};

/*
 * The table's columns in a row's order: the ingestion key's name first where
 * the table lists keys. The rate, what was dropped and what was throttled
 * fold away on a phone, which has no room for them.
 */
type SignalTableColumnId =
  | "ingestionKey"
  | "teamOrLabel"
  | "signal"
  | "usedToday"
  | "dailyBudget"
  | "rateLimit"
  | "dropped"
  | "throttled"
  | "status";

const getSignalTableColumnIds: (
  nameColumn: SignalTableNameColumn,
) => Array<SignalTableColumnId> = (
  nameColumn: SignalTableNameColumn,
): Array<SignalTableColumnId> => {
  return [
    ...(nameColumn === "none"
      ? []
      : ([nameColumn] as Array<SignalTableColumnId>)),
    "signal",
    "usedToday",
    "dailyBudget",
    "rateLimit",
    "dropped",
    "throttled",
    "status",
  ];
};

export const SignalTable: FunctionComponent<{
  scopes: Array<TelemetryIngestionBudgetScopeStatus>;
  nameColumn: SignalTableNameColumn;
  dataTestId: string;
}> = (props: {
  scopes: Array<TelemetryIngestionBudgetScopeStatus>;
  nameColumn: SignalTableNameColumn;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const isNamed: boolean = props.nameColumn !== "none";

  const titles: Record<SignalTableColumnId, string> = {
    ingestionKey: translator.translateText("Ingestion Key") || "Ingestion Key",
    teamOrLabel: translator.translateText("Team or Label") || "Team or Label",
    signal: translator.translateText("Signal") || "Signal",
    usedToday: translator.translateText("Used Today") || "Used Today",
    dailyBudget: translator.translateText("Daily Budget") || "Daily Budget",
    rateLimit: translator.translateText("Rate Limit") || "Rate Limit",
    dropped: translator.translateText("Dropped") || "Dropped",
    throttled: translator.translateText("Throttled") || "Throttled",
    status: translator.translateText("Status") || "Status",
  };

  /*
   * The columns as wide as a person makes them (Common's
   * Table/ColumnResize), kept apart for the project's signals and the
   * keys': a row's name - the key's, or the signal's where no key is
   * listed - gives way to 10rem, a signal beside its key to 8rem, an amount
   * or a state never.
   */
  const columnIds: Array<SignalTableColumnId> = getSignalTableColumnIds(
    props.nameColumn,
  );
  const columns: ResizableColumns = useResizableColumns({
    tableKey:
      props.nameColumn === "ingestionKey"
        ? "telemetry-ingestion-budget-key-signals"
        : props.nameColumn === "teamOrLabel"
          ? "telemetry-ingestion-budget-team-label-signals"
          : "telemetry-ingestion-budget-signals",
    columns: columnIds.map(
      (id: SignalTableColumnId, index: number): SizedColumn => {
        return { id: id, cellNumber: index + 1 };
      },
    ),
  });

  const headerCell: (data: {
    id: SignalTableColumnId;
    kind: ColumnWidthKind;
    className: string;
  }) => ReactElement = (data: {
    id: SignalTableColumnId;
    kind: ColumnWidthKind;
    className: string;
  }): ReactElement => {
    return (
      <ResizableHeaderCell
        key={data.id}
        scope="col"
        className={data.className}
        resize={columns.getResize(data.id, titles[data.id], data.kind)}
      >
        <span>{titles[data.id]}</span>
      </ResizableHeaderCell>
    );
  };

  return (
    <div className="overflow-x-auto" data-testid={props.dataTestId}>
      {columns.styles}
      <table
        className={`${columns.getTableWidthClassName("min-w-full")} text-left`}
        {...columns.tableAttributes}
      >
        <thead>
          <tr className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {props.nameColumn !== "none" ? (
              headerCell({
                id: props.nameColumn,
                kind: ColumnWidthKind.Name,
                className: "pb-2 pr-4 font-medium",
              })
            ) : (
              <></>
            )}
            {headerCell({
              id: "signal",
              kind: isNamed ? ColumnWidthKind.Text : ColumnWidthKind.Name,
              className: "pb-2 pr-4 font-medium",
            })}
            {headerCell({
              id: "usedToday",
              kind: ColumnWidthKind.Whole,
              className: "pb-2 pr-4 font-medium",
            })}
            {headerCell({
              id: "dailyBudget",
              kind: ColumnWidthKind.Whole,
              className: "pb-2 pr-4 font-medium",
            })}
            {headerCell({
              id: "rateLimit",
              kind: ColumnWidthKind.Whole,
              className: "max-md:hidden pb-2 pr-4 font-medium md:table-cell",
            })}
            {headerCell({
              id: "dropped",
              kind: ColumnWidthKind.Whole,
              className: "max-md:hidden pb-2 pr-4 font-medium md:table-cell",
            })}
            {headerCell({
              id: "throttled",
              kind: ColumnWidthKind.Whole,
              className: "max-md:hidden pb-2 pr-4 font-medium md:table-cell",
            })}
            {headerCell({
              id: "status",
              kind: ColumnWidthKind.Whole,
              className: "pb-2 font-medium",
            })}
          </tr>
        </thead>
        <tbody>
          {props.scopes.map(
            (scope: TelemetryIngestionBudgetScopeStatus): ReactElement => {
              return (
                <SignalRows
                  key={`${scope.scope}-${getScopeRowKey(scope)}`}
                  scope={scope}
                  nameColumn={props.nameColumn}
                />
              );
            },
          )}
        </tbody>
      </table>
    </div>
  );
};

const TelemetryIngestionBudgetStatusCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [status, setStatus] = useState<TelemetryIngestionBudgetStatus | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshCount, setRefreshCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    setIsLoading(true);
    setError("");

    props
      .fetchStatus()
      .then((loaded: TelemetryIngestionBudgetStatus) => {
        /*
         * Read again, as it came off the network: an answer that is not a
         * status fails like a read that failed, rather than a throw while
         * the page draws.
         */
        const readable: TelemetryIngestionBudgetStatus | null =
          readTelemetryIngestionBudgetStatus(loaded);

        if (!readable) {
          throw new Error(STATUS_UNREADABLE);
        }

        if (isCurrent) {
          setStatus(readable);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [refreshCount]);

  const keyScope: TelemetryIngestionBudgetScopeStatus | undefined =
    props.ingestionKeyId && status
      ? status.ingestionKeys.find(
          (key: TelemetryIngestionBudgetScopeStatus): boolean => {
            return key.ingestionKeyId === props.ingestionKeyId;
          },
        )
      : undefined;

  const isUnbudgeted: boolean = Boolean(
    status &&
      (props.ingestionKeyId
        ? !keyScope ||
          !keyScope.signals.some(isTelemetryIngestionBudgetSignalShown)
        : !hasTelemetryIngestionBudgets(status)),
  );

  // Quiet where a budget is the exception: nothing at all while none is set.
  if (props.hideWhenUnbudgeted && (isUnbudgeted || (!status && !error))) {
    return <></>;
  }

  const refreshButtons: ReturnType<typeof getTableHeaderButtons> =
    getTableHeaderButtons([
      {
        title: "",
        buttonStyle: ButtonStyleType.ICON,
        icon: IconProp.Refresh,
        onClick: () => {
          setRefreshCount(refreshCount + 1);
        },
      },
    ]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading && !status) {
      return <DetailListSkeleton fields={3} />;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            setRefreshCount(refreshCount + 1);
          }}
        />
      );
    }

    if (!status || isUnbudgeted) {
      return (
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.ChartBar}
          title={NO_BUDGETS_TITLE}
          description={NO_BUDGETS_DESCRIPTION}
          isCompact={true}
          dataTestId="telemetry-ingestion-budget-empty"
        />
      );
    }

    return (
      <div className="space-y-4">
        {status.countersAvailable ? (
          <></>
        ) : (
          <Alert
            type={AlertType.WARNING}
            title={
              translator.translateText(COUNTERS_UNAVAILABLE) ||
              COUNTERS_UNAVAILABLE
            }
            dataTestId="telemetry-ingestion-budget-counters-unavailable"
          />
        )}
        <SignalTable
          scopes={keyScope ? [keyScope] : [status.project]}
          nameColumn="none"
          dataTestId="telemetry-ingestion-budget-project-table"
        />
      </div>
    );
  };

  const resetsAt: string = status ? getResetsAt(status) : "";
  const budgetedKeys: Array<TelemetryIngestionBudgetScopeStatus> = status
    ? status.ingestionKeys.filter(
        (key: TelemetryIngestionBudgetScopeStatus): boolean => {
          return key.signals.some(isTelemetryIngestionBudgetSignalShown);
        },
      )
    : [];
  const budgetedTeamsAndLabels: Array<TelemetryIngestionBudgetScopeStatus> =
    status
      ? (status.teamsAndLabels || []).filter(
          (scope: TelemetryIngestionBudgetScopeStatus): boolean => {
            return scope.signals.some(isTelemetryIngestionBudgetSignalShown);
          },
        )
      : [];

  return (
    <div data-testid={TELEMETRY_INGESTION_BUDGET_STATUS_TEST_ID}>
      <Card
        title={props.ingestionKeyId ? THIS_KEY_CARD_TITLE : BUDGETS_CARD_TITLE}
        description={
          status
            ? translator.translateTemplate(
                props.ingestionKeyId
                  ? THIS_KEY_CARD_DESCRIPTION
                  : BUDGETS_CARD_DESCRIPTION,
                { resetsAt: resetsAt },
              )
            : undefined
        }
        headerLayout="toolbar"
        buttons={refreshButtons}
      >
        {getBody()}
      </Card>

      {!props.ingestionKeyId && status && !error && budgetedKeys.length > 0 ? (
        <Card
          title={KEY_BUDGETS_CARD_TITLE}
          description={KEY_BUDGETS_CARD_DESCRIPTION}
        >
          <SignalTable
            scopes={budgetedKeys}
            nameColumn="ingestionKey"
            dataTestId="telemetry-ingestion-budget-key-table"
          />
        </Card>
      ) : (
        <></>
      )}

      {!props.ingestionKeyId &&
      status &&
      !error &&
      budgetedTeamsAndLabels.length > 0 ? (
        <Card
          title={TEAM_LABEL_BUDGETS_STATUS_CARD_TITLE}
          description={translator.translateTemplate(
            TEAM_LABEL_BUDGETS_STATUS_CARD_DESCRIPTION,
            { resetsAt: resetsAt },
          )}
        >
          <SignalTable
            scopes={budgetedTeamsAndLabels}
            nameColumn="teamOrLabel"
            dataTestId="telemetry-ingestion-budget-team-label-table"
          />
        </Card>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TelemetryIngestionBudgetStatusCard;
