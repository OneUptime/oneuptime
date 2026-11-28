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
import ContainedErrorBoundary from "../ContainedErrorBoundary/ContainedErrorBoundary";
import Link from "../Link/Link";
import { getTelemetryUsageSignalTitle } from "../TelemetryUsage/TelemetryUsageWords";
import { formatTelemetryIngestionBudgetBytes } from "./TelemetryIngestionBudgetWords";
import {
  getTelemetryQueueRefusalNoticeText,
  SEE_WHAT_WAS_REFUSED,
} from "./TelemetryQueueRefusalWords";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The line an explorer (Logs, Traces, Metrics, Profiles, Security Events)
 * shows above its data while the signal's ingestion budget is past its
 * warning or used up, or while OneUptime refuses the signal as it catches
 * up on the telemetry queue (#11440) - the moment someone wonders why new
 * data stopped arriving. Nothing at all otherwise, and nothing when the
 * status cannot be read (a role that does not read usage, a network error,
 * an answer that is not a status): it is a notice, never a reason for the
 * page to fail.
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
/*
 * A team's or a label's budget used up (#6386): the data of its services,
 * hosts and other resources (#10101) is dropped.
 */
export const TEAM_LABEL_BUDGETS_USED_UP: PluralTemplate = {
  one: "{{signal}}: {{count}} team or label has used up its own budget for today, so data from its services and other resources is dropped until {{resetsAt}}.",
  other:
    "{{signal}}: {{count}} teams and labels have used up their own budgets for today, so data from their services and other resources is dropped until {{resetsAt}}.",
};
export const SEE_BUDGETS: string = translationKey("See budgets");

export const TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID: string =
  "telemetry-ingestion-budget-banner";

export interface TelemetryIngestionBudgetBannerNotice {
  type: AlertType;
  text: string;
  // What the link to the Usage page says: "See budgets" unless set.
  linkText?: string | undefined;
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
 * budget used up first - nothing more is taken until it resets - then the
 * telemetry queue refusing the signal still (#11440), then the project's
 * budget past its warning, else keys, teams and labels of the project that
 * used theirs up. Pure, so a plain test reads it.
 */
export const getTelemetryIngestionBudgetBannerNotice: (data: {
  status: TelemetryIngestionBudgetStatus;
  signal: TelemetryIngestionBudgetSignal;
  translator: Translator;
  // When the banner is drawn: a queue refusal is told while it is recent.
  now?: Date | undefined;
}) => TelemetryIngestionBudgetBannerNotice | null = (data: {
  status: TelemetryIngestionBudgetStatus;
  signal: TelemetryIngestionBudgetSignal;
  translator: Translator;
  now?: Date | undefined;
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
  const budget: string | null =
    project && project.dailyBudgetBytes !== null
      ? formatTelemetryIngestionBudgetBytes(
          project.dailyBudgetBytes,
          data.translator,
        )
      : null;

  if (
    project &&
    budget !== null &&
    project.state === TelemetryIngestionBudgetState.Exhausted
  ) {
    return {
      type: AlertType.DANGER,
      text: data.translator.translateTemplate(BUDGET_USED_UP, {
        signal: signalTitle,
        budget: budget,
        resetsAt: resetsAt,
      }),
    };
  }

  const queueNotice: string | null = getTelemetryQueueRefusalNoticeText({
    refusals: data.status.queueRefusals || [],
    signal: data.signal,
    translator: data.translator,
    now: data.now || OneUptimeDate.getCurrentDate(),
  });

  if (queueNotice) {
    return {
      type: AlertType.WARNING,
      text: queueNotice,
      linkText: SEE_WHAT_WAS_REFUSED,
    };
  }

  if (project && budget !== null) {
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

  const exhaustedTeamsAndLabels: number = (
    data.status.teamsAndLabels || []
  ).filter((scope: TelemetryIngestionBudgetScopeStatus): boolean => {
    return (
      findSignal(scope, data.signal)?.state ===
      TelemetryIngestionBudgetState.Exhausted
    );
  }).length;

  if (exhaustedTeamsAndLabels > 0) {
    return {
      type: AlertType.WARNING,
      text: data.translator.translatePlural(
        TEAM_LABEL_BUDGETS_USED_UP,
        exhaustedTeamsAndLabels,
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

/*
 * The banner itself: what it reads and what it draws. Exported for tests;
 * a page draws the default export, which holds it in its own boundary.
 */
export const UnguardedTelemetryIngestionBudgetBanner: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
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
                {translator.translateText(notice.linkText || SEE_BUDGETS)}
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

/*
 * A notice never takes the page it sits on down. A bug in the banner's own
 * drawing - a formatter, a translation, a date in an odd zone - unmounted
 * the explorer under it, which went blank (#6486, #7167): each explorer's
 * layout draws the banner above every page under it. So the banner is a
 * part of its own (ContainedErrorBoundary): anything it throws while it
 * draws takes only its place, which then holds nothing, as a status that
 * cannot be read does; and so does a banner whose code will not download
 * (isNotice). Held here, every page that draws it - the Logs, Traces,
 * Metrics, Profiles and Security Events explorers, and any later one - is
 * held the same way. The usage card (TelemetryIngestionBudgetStatusCard),
 * a page's main content, says what went wrong itself instead.
 */
const TelemetryIngestionBudgetBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ContainedErrorBoundary
      isNotice={true}
      // Another signal's banner tries again.
      resetKeys={[props.signal]}
      renderFallback={(): ReactElement => {
        return <></>;
      }}
    >
      <UnguardedTelemetryIngestionBudgetBanner {...props} />
    </ContainedErrorBoundary>
  );
};

export default TelemetryIngestionBudgetBanner;
