import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import {
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
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Pill from "../Pill/Pill";
import { ColumnWidthKind } from "../Table/ColumnResize/ColumnWidths";
import ResizableHeaderCell from "../Table/ColumnResize/ResizableHeaderCell";
import useResizableColumns, {
  ResizableColumns,
} from "../Table/ColumnResize/useResizableColumns";
import { getTableHeaderButtons } from "../Table/TableHeaderControls";
import TableEmptyState, { TableEmptyStateKind } from "../Table/TableEmptyState";
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

export const SignalRows: FunctionComponent<{
  scope: TelemetryIngestionBudgetScopeStatus;
  showKeyName: boolean;
}> = (props: {
  scope: TelemetryIngestionBudgetScopeStatus;
  showKeyName: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const signals: Array<TelemetryIngestionBudgetSignalStatus> =
    props.scope.signals.filter(isTelemetryIngestionBudgetSignalShown);

  return (
    <Fragment>
      {signals.map(
        (signal: TelemetryIngestionBudgetSignalStatus): ReactElement => {
          const state: TelemetryIngestionBudgetState = signal.state;
          const label: string = TELEMETRY_INGESTION_BUDGET_STATE_LABELS[state];

          return (
            <tr
              key={`${props.scope.ingestionKeyId || "project"}-${signal.signal}`}
              data-testid={`telemetry-ingestion-budget-row-${props.scope.ingestionKeyId || "project"}-${signal.signal}`}
              className="border-t border-gray-100"
            >
              {props.showKeyName ? (
                <td className="py-3 pr-4 align-top text-sm font-medium text-gray-900">
                  <bdi>{props.scope.ingestionKeyName || "—"}</bdi>
                </td>
              ) : (
                <></>
              )}
              <td className="py-3 pr-4 align-top text-sm font-medium text-gray-900">
                {getTelemetryUsageSignalTitle(signal.signal, translator)}
              </td>
              <td className="py-3 pr-4 align-top text-sm text-gray-700">
                <div className="tabular-nums">
                  {signal.usedBytes === null
                    ? "—"
                    : formatTelemetryIngestionBudgetBytes(
                        signal.usedBytes,
                        translator,
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
                  {signal.dailyBudgetBytes === null
                    ? "—"
                    : formatTelemetryIngestionBudgetBytes(
                        signal.dailyBudgetBytes,
                        translator,
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
                  {signal.rateLimitBytesPerSecond === null
                    ? "—"
                    : formatTelemetryIngestionBudgetRate(
                        signal.rateLimitBytesPerSecond,
                        translator,
                      )}
                </span>
              </td>
              <td className="max-md:hidden py-3 pr-4 align-top text-sm text-gray-700 md:table-cell">
                <span className="tabular-nums">
                  {signal.droppedBytes
                    ? formatTelemetryIngestionBudgetBytes(
                        signal.droppedBytes,
                        translator,
                      )
                    : "—"}
                </span>
              </td>
              <td className="max-md:hidden py-3 pr-4 align-top text-sm text-gray-700 md:table-cell">
                <span className="tabular-nums">
                  {signal.throttledRequests
                    ? translator.translatePlural(
                        {
                          one: "{{count}} request",
                          other: "{{count}} requests",
                        },
                        signal.throttledRequests,
                      )
                    : "—"}
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

export const SignalTable: FunctionComponent<{
  scopes: Array<TelemetryIngestionBudgetScopeStatus>;
  showKeyName: boolean;
  dataTestId: string;
}> = (props: {
  scopes: Array<TelemetryIngestionBudgetScopeStatus>;
  showKeyName: boolean;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The columns as wide as a person makes them (Table/ColumnResize), each
   * table's remembered under its own name: a key's name and a signal give
   * way, the amounts and the state never. A row's cells are in this order
   * (SignalRows), the key's name first where the table lists keys.
   */
  const cellOffset: number = props.showKeyName ? 1 : 0;
  const columns: ResizableColumns = useResizableColumns({
    tableKey: props.dataTestId,
    columns: [
      ...(props.showKeyName ? [{ id: "ingestionKey", cellNumber: 1 }] : []),
      { id: "signal", cellNumber: cellOffset + 1 },
      { id: "usedToday", cellNumber: cellOffset + 2 },
      { id: "dailyBudget", cellNumber: cellOffset + 3 },
      { id: "rateLimit", cellNumber: cellOffset + 4 },
      { id: "dropped", cellNumber: cellOffset + 5 },
      { id: "throttled", cellNumber: cellOffset + 6 },
      { id: "status", cellNumber: cellOffset + 7 },
    ],
  });

  // A header cell that sizes its column, named as the header says it.
  const headerCell: (data: {
    id: string;
    title: string;
    kind: ColumnWidthKind;
    className: string;
  }) => ReactElement = (data: {
    id: string;
    title: string;
    kind: ColumnWidthKind;
    className: string;
  }): ReactElement => {
    return (
      <ResizableHeaderCell
        key={data.id}
        className={data.className}
        resize={columns.getResize(data.id, data.title, data.kind)}
      >
        {data.title}
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
            {props.showKeyName ? (
              headerCell({
                id: "ingestionKey",
                title: translator.translateText("Ingestion Key"),
                kind: ColumnWidthKind.Name,
                className: "pb-2 pr-4 font-medium",
              })
            ) : (
              <></>
            )}
            {headerCell({
              id: "signal",
              title: translator.translateText("Signal"),
              kind: props.showKeyName
                ? ColumnWidthKind.Text
                : ColumnWidthKind.Name,
              className: "pb-2 pr-4 font-medium",
            })}
            {headerCell({
              id: "usedToday",
              title: translator.translateText("Used Today"),
              kind: ColumnWidthKind.Whole,
              className: "pb-2 pr-4 font-medium",
            })}
            {headerCell({
              id: "dailyBudget",
              title: translator.translateText("Daily Budget"),
              kind: ColumnWidthKind.Whole,
              className: "pb-2 pr-4 font-medium",
            })}
            {headerCell({
              id: "rateLimit",
              title: translator.translateText("Rate Limit"),
              kind: ColumnWidthKind.Whole,
              className: "max-md:hidden pb-2 pr-4 font-medium md:table-cell",
            })}
            {headerCell({
              id: "dropped",
              title: translator.translateText("Dropped"),
              kind: ColumnWidthKind.Whole,
              className: "max-md:hidden pb-2 pr-4 font-medium md:table-cell",
            })}
            {headerCell({
              id: "throttled",
              title: translator.translateText("Throttled"),
              kind: ColumnWidthKind.Whole,
              className: "max-md:hidden pb-2 pr-4 font-medium md:table-cell",
            })}
            {headerCell({
              id: "status",
              title: translator.translateText("Status"),
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
                  key={scope.ingestionKeyId || "project"}
                  scope={scope}
                  showKeyName={props.showKeyName}
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
        if (isCurrent) {
          setStatus(loaded);
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
      return <ComponentLoader />;
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
          showKeyName={false}
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
            showKeyName={true}
            dataTestId="telemetry-ingestion-budget-key-table"
          />
        </Card>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TelemetryIngestionBudgetStatusCard;
