import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ActiveMonitorLimitUtil, {
  ActiveMonitorLimitKind,
  ActiveMonitorLimitStatus,
  NO_ACTIVE_MONITOR_LIMIT,
} from "Common/Types/Monitor/ActiveMonitorLimit";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Link from "Common/UI/Components/Link/Link";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE PLAN'S LIMIT ON ACTIVE MONITORS, SAID BEFORE ANYONE IS REFUSED.
 *
 * A project whose plan caps active monitors - a plan bought from a reseller,
 * or the Free plan - is refused a new one at its limit, on every path, by
 * the server (Common/Server/Utils/Billing/ActiveMonitorLimit). This says so
 * where monitors are made and listed, so nobody fills in the Create Monitor
 * form to be refused at the end of it, and a project already past its limit
 * hears that its monitors keep running and what to do:
 *
 *  - on Create Monitor, at the limit or past it (AtOrOverLimit);
 *  - on the monitor list, only past it (OverLimit) - at the limit there is
 *    nothing wrong to say until someone adds one.
 *
 * Nothing is drawn while the status loads, when it cannot be read, or when
 * the project has no limit: the server's refusal says the same, in the same
 * terms, if it comes to that.
 */

export enum ActiveMonitorLimitNoticeShowWhen {
  AtOrOverLimit = "AtOrOverLimit",
  OverLimit = "OverLimit",
}

export interface ComponentProps {
  showWhen: ActiveMonitorLimitNoticeShowWhen;
  className?: string | undefined;
}

/*
 * What the notice says, in the reader's language: where the project stands,
 * what to do (with the plan's link after it), and what counts.
 */
export interface ActiveMonitorLimitNoticeCopy {
  title: string;
  state: Array<string>;
  action: string;
  linkText: string;
  note: string;
}

// A sentence that ends the way Chinese and Japanese end one takes no space after it.
const FULL_WIDTH_SENTENCE_END: RegExp = /[。！？]$/;

// Whole sentences, one after another, as the reader's language runs them on.
export const joinSentences: (sentences: Array<string>) => string = (
  sentences: Array<string>,
): string => {
  return sentences.reduce((text: string, sentence: string): string => {
    if (!text) {
      return sentence;
    }

    return FULL_WIDTH_SENTENCE_END.test(text)
      ? `${text}${sentence}`
      : `${text} ${sentence}`;
  }, "");
};

export const ACTIVE_MONITOR_LIMIT_ROUTE: string =
  "/monitor/active-monitor-limit";

// The project's limit and, when it has one, how many active monitors it has.
export const fetchActiveMonitorLimitStatus: () => Promise<ActiveMonitorLimitStatus> =
  async (): Promise<ActiveMonitorLimitStatus> => {
    const response: HTTPResponse<JSONObject> = (await API.get<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        ACTIVE_MONITOR_LIMIT_ROUTE,
      ),
      headers: ModelAPI.getCommonHeaders(),
    })) as HTTPResponse<JSONObject>;

    return ActiveMonitorLimitUtil.fromJSON(response.data);
  };

// The words for a project at or past its limit.
export const getActiveMonitorLimitNoticeCopy: (data: {
  status: ActiveMonitorLimitStatus;
  translator: Translator;
}) => ActiveMonitorLimitNoticeCopy | null = (data: {
  status: ActiveMonitorLimitStatus;
  translator: Translator;
}): ActiveMonitorLimitNoticeCopy | null => {
  const { status, translator } = data;

  if (!status.limit || status.activeMonitors === null) {
    return null;
  }

  const isFreePlan: boolean =
    status.limit.kind === ActiveMonitorLimitKind.FreePlan;
  const isOverLimit: boolean = ActiveMonitorLimitUtil.isOverLimit(status);
  const limit: number = status.limit.limit;
  const activeMonitors: string = translator.formatNumber(
    status.activeMonitors,
  );

  let title: string;

  if (isOverLimit) {
    title = translator.translateText(
      "This project has more active monitors than its plan includes",
    ) as string;
  } else if (isFreePlan) {
    title = translator.translateText(
      "You've reached the Free plan's monitor limit",
    ) as string;
  } else {
    title = translator.translateText(
      "You've reached your plan's monitor limit",
    ) as string;
  }

  const state: Array<string> = [
    isFreePlan
      ? translator.translatePlural(
          {
            one: "The Free plan includes {{count}} active monitor, and this project has {{activeMonitors}}.",
            other:
              "The Free plan includes {{count}} active monitors, and this project has {{activeMonitors}}.",
          },
          limit,
          { activeMonitors: activeMonitors },
        )
      : translator.translatePlural(
          {
            one: "Your plan includes {{count}} active monitor, and this project has {{activeMonitors}}.",
            other:
              "Your plan includes {{count}} active monitors, and this project has {{activeMonitors}}.",
          },
          limit,
          { activeMonitors: activeMonitors },
        ),
  ];

  if (isOverLimit) {
    state.push(
      translator.translateTemplate(
        "Every monitor it has keeps running, but no new one can be added until it has fewer than {{limit}}.",
        { limit: translator.formatNumber(limit) },
      ),
    );
  }

  return {
    title: title,
    state: state,
    action: isFreePlan
      ? (translator.translateText("Upgrade your plan to add more.") as string)
      : (translator.translateText(
          "To add more, delete monitors you no longer need or change your plan.",
        ) as string),
    linkText: isFreePlan
      ? (translator.translateText("View plans") as string)
      : (translator.translateText("View plan") as string),
    note: translator.translateText(
      "Manual monitors don't count towards the limit. Monitors that are turned off or archived do.",
    ) as string,
  };
};

const ActiveMonitorLimitNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [status, setStatus] = useState<ActiveMonitorLimitStatus>(
    NO_ACTIVE_MONITOR_LIMIT,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    fetchActiveMonitorLimitStatus()
      .then((value: ActiveMonitorLimitStatus) => {
        if (isCurrent) {
          setStatus(value);
        }
      })
      .catch(() => {
        /*
         * Quiet: the notice is a heads-up. A create at the limit is refused
         * by the server in the same terms whatever this could read.
         */
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const isShown: boolean =
    props.showWhen === ActiveMonitorLimitNoticeShowWhen.OverLimit
      ? ActiveMonitorLimitUtil.isOverLimit(status)
      : ActiveMonitorLimitUtil.isAtOrOverLimit(status);

  if (!isShown) {
    return <></>;
  }

  const copy: ActiveMonitorLimitNoticeCopy | null =
    getActiveMonitorLimitNoticeCopy({
      status: status,
      translator: translator,
    });

  if (!copy) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.WARNING}
      className={props.className || "mb-5"}
      dataTestId="active-monitor-limit-notice"
      strongTitle={copy.title}
      title={
        <div className="space-y-2">
          <p data-testid="active-monitor-limit-notice-state">
            {joinSentences(copy.state)}
          </p>
          <p data-testid="active-monitor-limit-notice-action">
            {copy.action}{" "}
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_BILLING] as Route,
              )}
              className="whitespace-nowrap font-semibold underline underline-offset-2"
            >
              {copy.linkText}
            </Link>
          </p>
          <p
            className="text-xs leading-5 opacity-80"
            data-testid="active-monitor-limit-notice-note"
          >
            {copy.note}
          </p>
        </div>
      }
    />
  );
};

export default ActiveMonitorLimitNotice;
