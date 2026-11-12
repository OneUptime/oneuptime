import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import {
  readTelemetryIngestionBudgetStatus,
  TelemetryIngestionBudgetScopeStatus,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetSignalStatus,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import { PluralTemplate, Translator } from "../../../Types/Translator";
import { translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Alert, { AlertType } from "../Alerts/Alert";
import Link from "../Link/Link";
import { getTelemetryUsageSignalTitle } from "../TelemetryUsage/TelemetryUsageWords";
import { formatTelemetryIngestionBudgetBytes } from "./TelemetryIngestionBudgetWords";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The line an explorer (Logs, Traces, Metrics, Profiles, Security Events)
 * shows above its data while the signal's ingestion budget is past its
 * warning or used up - the moment someone wonders why new data stopped
 * arriving. Nothing at all otherwise, and nothing when the status cannot be
 * read (a role that does not read usage, a network error, an answer that is
 * not a status): it is a notice, never a reason for the page to fail.
 */

export const BUDGET_USED_UP: string = translationKey(
  "{{signal}}: today's ingestion budget of {{budget}} is used up, so new data is refused until the budget resets at {{resetsAt}}.",
);
export const BUDGET_PAST_WARNING: string = translationKey(
  "{{signal}}: {{percent}}% of today's ingestion budget of {{budget}} is used. Once it is used up, new data is refused until the budget resets at {{resetsAt}}.",
);
export const KEY_BUDGETS_USED_UP: PluralTemplate = {
  one: "{{signal}}: {{count}} ingestion key has used up its own budget for today, so data sent with it is refused until {{resetsAt}}.",
  other:
    "{{signal}}: {{count}} ingestion keys have used up their own budgets for today, so data sent with them is refused until {{resetsAt}}.",
};
export const SEE_BUDGETS: string = translationKey("See budgets");

export const TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID: string =
  "telemetry-ingestion-budget-banner";

export interface TelemetryIngestionBudgetBannerNotice {
  type: AlertType;
  text: string;
}

const findSignal: (
  scope: TelemetryIngestionBudgetScopeStatus,
  signal: TelemetryIngestionBudgetSignal,
) => TelemetryIngestionBudgetSignalStatus | undefined = (
  scope: TelemetryIngestionBudgetScopeStatus,
  signal: TelemetryIngestionBudgetSignal,
): TelemetryIngestionBudgetSignalStatus | undefined => {
  return scope.signals.find(
    (status: TelemetryIngestionBudgetSignalStatus): boolean => {
      return status.signal === signal;
    },
  );
};

/*
 * What the banner says for a signal, or null for nothing: the project's
 * budget first (used up, then past its warning), else keys of the project
 * that used theirs up. Pure, so a plain test reads it.
 */
export const getTelemetryIngestionBudgetBannerNotice: (data: {
  status: TelemetryIngestionBudgetStatus;
  signal: TelemetryIngestionBudgetSignal;
  translator: Translator;
}) => TelemetryIngestionBudgetBannerNotice | null = (data: {
  status: TelemetryIngestionBudgetStatus;
  signal: TelemetryIngestionBudgetSignal;
  translator: Translator;
}): TelemetryIngestionBudgetBannerNotice | null => {
  const project: TelemetryIngestionBudgetSignalStatus | undefined = findSignal(
    data.status.project,
    data.signal,
  );
  const signalTitle: string = getTelemetryUsageSignalTitle(
    data.signal,
    data.translator,
  );
  const resetsAt: string = OneUptimeDate.getDateAsFormattedStringInTimezone({
    date: data.status.resetsAt,
    timezone: data.status.timezone,
  });

  if (project && project.dailyBudgetBytes !== null) {
    const budget: string = formatTelemetryIngestionBudgetBytes(
      project.dailyBudgetBytes,
      data.translator,
    );

    if (project.state === TelemetryIngestionBudgetState.Exhausted) {
      return {
        type: AlertType.DANGER,
        text: data.translator.translateTemplate(BUDGET_USED_UP, {
          signal: signalTitle,
          budget: budget,
          resetsAt: resetsAt,
        }),
      };
    }

    if (project.state === TelemetryIngestionBudgetState.Warning) {
      return {
        type: AlertType.WARNING,
        text: data.translator.translateTemplate(BUDGET_PAST_WARNING, {
          signal: signalTitle,
          percent: data.translator.formatNumber(
            Math.floor(project.percentUsed || 0),
          ),
          budget: budget,
          resetsAt: resetsAt,
        }),
      };
    }
  }

  const exhaustedKeys: number = data.status.ingestionKeys.filter(
    (key: TelemetryIngestionBudgetScopeStatus): boolean => {
      return (
        findSignal(key, data.signal)?.state ===
        TelemetryIngestionBudgetState.Exhausted
      );
    },
  ).length;

  if (exhaustedKeys > 0) {
    return {
      type: AlertType.WARNING,
      text: data.translator.translatePlural(
        KEY_BUDGETS_USED_UP,
        exhaustedKeys,
        {
          signal: signalTitle,
          resetsAt: resetsAt,
        },
      ),
    };
  }

  return null;
};

export interface ComponentProps {
  signal: TelemetryIngestionBudgetSignal;
  fetchStatus: () => Promise<TelemetryIngestionBudgetStatus>;
  // Where the budgets are shown in full, for the "See budgets" link.
  budgetsRoute?: Route | undefined;
}

const TelemetryIngestionBudgetBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [status, setStatus] = useState<TelemetryIngestionBudgetStatus | null>(
    null,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    props
      .fetchStatus()
      .then((loaded: TelemetryIngestionBudgetStatus) => {
        if (isCurrent) {
          /*
           * Read again, as it came off the network: an answer that is not a
           * status (a proxy's, an older server's, a test double's {}) is
           * no status, which draws nothing, rather than a throw while the
           * explorer under this banner draws.
           */
          setStatus(readTelemetryIngestionBudgetStatus(loaded));
        }
      })
      .catch(() => {
        // A notice only: a status that cannot be read shows nothing.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.signal]);

  if (!status) {
    return <></>;
  }

  const notice: TelemetryIngestionBudgetBannerNotice | null =
    getTelemetryIngestionBudgetBannerNotice({
      status: status,
      signal: props.signal,
      translator: translator,
    });

  if (!notice) {
    return <></>;
  }

  return (
    <div
      className="mb-4"
      data-testid={TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID}
    >
      <Alert
        type={notice.type}
        title={
          <span>
            {notice.text}
            {props.budgetsRoute ? (
              <Link
                to={props.budgetsRoute}
                className="ml-2 font-medium underline"
                dataTestId="telemetry-ingestion-budget-banner-link"
              >
                {translator.translateText(SEE_BUDGETS)}
              </Link>
            ) : (
              <></>
            )}
          </span>
        }
      />
    </div>
  );
};

export default TelemetryIngestionBudgetBanner;
