import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { HomeCounts } from "./HomeOverviewData";
import { formatRelativeTime, isJustNow } from "./HomeRelativeTime";
import OverviewStats from "./OverviewStats";
import {
  getProjectHealth,
  ProjectHealth,
  ProjectHealthKind,
  ProjectHealthTone,
  translateProjectHealthText,
} from "./ProjectHealth";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The top of Home: one sentence that says whether anything is wrong in the
 * project, and the five numbers it is made of. Its colour follows the worst
 * thing open - red for an incident, amber for anything else that needs
 * someone, indigo for maintenance in progress, green when all is well and
 * grey before anything is monitored.
 */

export interface ComponentProps {
  counts: HomeCounts | null;
  isLoading: boolean;
  isRefreshing: boolean;
  // Why the last load failed, or "".
  error: string;
  loadedAt: Date | null;
  now: Date;
  onRefresh: () => void;
  /*
   * Whether the signed-in user may create a monitor (Home's create gates).
   * Before anything is monitored, the headline then ends on the button that
   * does what it suggests.
   */
  canCreateMonitor?: boolean | undefined;
}

/*
 * The one primary button on Home, and only before anything is monitored: the
 * headline says to create a monitor, so it offers to. The Button component's
 * PRIMARY look, as a link so it opens in a new tab too.
 */
export const CREATE_FIRST_MONITOR_BUTTON_CLASS_NAME: string =
  "mt-4 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

interface ToneClassNames {
  // The band behind the headline.
  band: string;
  // The disc behind the icon.
  disc: string;
}

const TONE_CLASS_NAMES: Record<ProjectHealthTone, ToneClassNames> = {
  [ProjectHealthTone.Danger]: { band: "bg-red-50", disc: "bg-red-600" },
  [ProjectHealthTone.Warning]: { band: "bg-amber-50", disc: "bg-amber-500" },
  [ProjectHealthTone.Info]: { band: "bg-indigo-50", disc: "bg-indigo-600" },
  [ProjectHealthTone.Success]: {
    band: "bg-emerald-50",
    disc: "bg-emerald-500",
  },
  [ProjectHealthTone.Neutral]: { band: "bg-gray-50", disc: "bg-gray-500" },
};

const ProjectHealthCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const health: ProjectHealth | null = props.counts
    ? getProjectHealth(props.counts)
    : null;

  const getUpdatedElement: () => ReactElement | null =
    (): ReactElement | null => {
      if (!props.loadedAt) {
        return null;
      }

      const updatedText: string = isJustNow({
        date: props.loadedAt,
        now: props.now,
      })
        ? translator.translateText("Updated just now") || "Updated just now"
        : translator.translateTemplate("Updated {{time}}", {
            time: formatRelativeTime({
              date: props.loadedAt,
              now: props.now,
              language: translator.language,
            }),
          });

      return (
        <span
          data-testid="home-health-updated"
          title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            props.loadedAt,
          )}
        >
          {updatedText}
        </span>
      );
    };

  const refreshLabel: string = translator.translateText("Refresh") || "Refresh";

  const refreshButton: ReactElement = (
    <button
      type="button"
      onClick={props.onRefresh}
      disabled={props.isLoading || props.isRefreshing}
      aria-label={refreshLabel}
      title={refreshLabel}
      data-testid="home-health-refresh"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-white hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default"
    >
      <Icon
        icon={IconProp.Refresh}
        className={`h-4 w-4 ${props.isRefreshing ? "animate-spin" : ""}`}
      />
    </button>
  );

  // Nothing could be read at all: say so, and offer to try again.
  if (!props.isLoading && !health) {
    return (
      <section
        data-testid="home-project-health"
        data-health="error"
        className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      >
        <div className="flex flex-col gap-4 bg-gray-50 px-5 py-5 sm:flex-row sm:items-start sm:justify-between md:px-6">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-gray-500">
              <Icon icon={IconProp.Error} className="h-6 w-6 text-white" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">
                {translator.translateText(
                  "We could not load what is happening in this project",
                )}
              </h2>
              <p
                data-testid="home-health-error"
                className="mt-1 max-w-2xl break-words text-sm text-gray-600"
              >
                {props.error ||
                  translator.translateText(
                    "Something went wrong. Please try again.",
                  )}
              </p>
              <button
                type="button"
                onClick={props.onRefresh}
                data-testid="home-health-try-again"
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon icon={IconProp.Refresh} className="h-4 w-4" />
                {translator.translateText("Try again")}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const tone: ProjectHealthTone = health?.tone || ProjectHealthTone.Neutral;

  return (
    <section
      data-testid="home-project-health"
      data-health={health ? health.kind : "loading"}
      aria-busy={props.isLoading || props.isRefreshing}
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div
        className={`flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between md:px-6 ${TONE_CLASS_NAMES[tone].band}`}
      >
        <div className="flex min-w-0 items-start gap-4">
          {health ? (
            <span
              className={`relative flex h-11 w-11 flex-none items-center justify-center rounded-full ${TONE_CLASS_NAMES[tone].disc}`}
              aria-hidden="true"
            >
              {/*
               * A ring ripples out of the disc while an incident is open:
               * "this is happening right now". Never under reduced motion.
               */}
              {health.kind === ProjectHealthKind.Incidents ? (
                <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-40 motion-safe:animate-ping"></span>
              ) : null}
              <Icon
                icon={health.icon}
                className="relative h-6 w-6 text-white"
              />
            </span>
          ) : (
            <span className="h-11 w-11 flex-none animate-pulse rounded-full bg-gray-200"></span>
          )}
          <div className="min-w-0">
            {health ? (
              <>
                <h2
                  data-testid="home-health-headline"
                  className="text-lg font-semibold text-gray-900 sm:text-xl"
                >
                  {translateProjectHealthText(translator, health.headline)}
                </h2>
                <p
                  data-testid="home-health-summary"
                  className="mt-1 max-w-2xl text-sm text-gray-600"
                >
                  {translateProjectHealthText(translator, health.summary)}
                </p>
                {health.kind === ProjectHealthKind.NotSetUp &&
                props.canCreateMonitor ? (
                  <AppLink
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.MONITOR_CREATE] as Route,
                    )}
                    className={CREATE_FIRST_MONITOR_BUTTON_CLASS_NAME}
                  >
                    <span
                      data-testid="home-health-create-monitor"
                      className="inline-flex items-center gap-1.5"
                    >
                      <Icon icon={IconProp.Add} className="h-4 w-4 flex-none" />
                      <span className="whitespace-nowrap">
                        {translator.translateText("Create your first monitor")}
                      </span>
                    </span>
                  </AppLink>
                ) : null}
              </>
            ) : (
              <div data-testid="home-health-loading" className="space-y-2">
                <div className="h-6 w-56 animate-pulse rounded bg-gray-200"></div>
                <div className="h-4 w-80 max-w-full animate-pulse rounded bg-gray-200"></div>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2 text-xs text-gray-500 sm:pt-1">
          {props.error && health ? (
            <span
              data-testid="home-health-refresh-failed"
              className="font-medium text-red-600"
              title={props.error}
            >
              {translator.translateText("Could not refresh")}
            </span>
          ) : (
            getUpdatedElement()
          )}
          {refreshButton}
        </div>
      </div>
      <OverviewStats counts={props.counts} isLoading={props.isLoading} />
    </section>
  );
};

export default ProjectHealthCard;
