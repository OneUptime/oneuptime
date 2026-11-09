import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ScheduledMaintenanceStateUtil from "../../Utils/ScheduledMaintenanceState";
import AppLink from "../AppLink/AppLink";

/*
 * WHILE MAINTENANCE HOLDS AN APP PLATFORMS ENVIRONMENT.
 *
 * A scheduled maintenance event in progress that holds an environment - in
 * its Affected Resources, as its Scheduled Maintenance tab creates it -
 * holds the monitors of every app in it: they open no incident or alert
 * until it ends (MonitorMaintenanceSuppression), though their status still
 * follows what they read. A team that opens an app's page mid-deploy and
 * sees its error rate climb with nothing paging needs to read why at the
 * top, so the app's page and the environment's Overview say it, with the
 * event a click away and the environment's events beside it.
 *
 * Nothing is drawn while no event holds the environment, while the reads
 * are on their way, or when they fail (a role that may not read scheduled
 * maintenance, say): a notice is not worth an error of its own.
 */

// The page it is on: an app's, or the environment's own.
export enum CloudEnvironmentMaintenanceNoticeScope {
  App = "app",
  Environment = "environment",
}

export const CLOUD_ENVIRONMENT_MAINTENANCE_NOTICE_TITLE: string =
  translationKey("Under maintenance");

// What it says, by page, while the event's end is ahead and once it is past.
export const CLOUD_ENVIRONMENT_MAINTENANCE_SENTENCES: Readonly<
  Record<
    CloudEnvironmentMaintenanceNoticeScope,
    { until: string; overrun: string }
  >
> = {
  [CloudEnvironmentMaintenanceNoticeScope.App]: {
    until: translationKey(
      "{{event}} covers this app's environment until {{time}}. Until then, the app's monitors open no incidents or alerts.",
    ),
    overrun: translationKey(
      "{{event}} covers this app's environment. Until it ends, the app's monitors open no incidents or alerts.",
    ),
  },
  [CloudEnvironmentMaintenanceNoticeScope.Environment]: {
    until: translationKey(
      "{{event}} covers this environment until {{time}}. Until then, the monitors of its apps open no incidents or alerts.",
    ),
    overrun: translationKey(
      "{{event}} covers this environment. Until it ends, the monitors of its apps open no incidents or alerts.",
    ),
  },
};

export const CLOUD_ENVIRONMENT_MAINTENANCE_VIEW_EVENTS: string =
  translationKey("View events");

export const CLOUD_ENVIRONMENT_MAINTENANCE_NOTICE_TEST_ID: string =
  "cloud-environment-maintenance-notice";

export interface ComponentProps {
  environmentId: ObjectID;
  scope: CloudEnvironmentMaintenanceNoticeScope;
}

/*
 * Of the events in progress that hold the environment, the one that holds
 * it longest: its end is when the monitors alert again. One with no end
 * written holds it longest of all.
 */
export function getLongestHoldingEvent(
  events: ReadonlyArray<ScheduledMaintenance>,
): ScheduledMaintenance | null {
  let longest: ScheduledMaintenance | null = null;

  for (const event of events) {
    if (!longest) {
      longest = event;
      continue;
    }

    if (!event.endsAt) {
      if (longest.endsAt) {
        longest = event;
      }
      continue;
    }

    if (
      longest.endsAt &&
      OneUptimeDate.fromString(event.endsAt).getTime() >
        OneUptimeDate.fromString(longest.endsAt).getTime()
    ) {
      longest = event;
    }
  }

  return longest;
}

/*
 * The events in progress that hold an environment, read as its Scheduled
 * Maintenance tab would list them: in progress in the project's own
 * states (Common/Utils/ScheduledMaintenanceStart), as the server reads
 * them to hold the monitors.
 */
export async function loadEventsHoldingEnvironment(
  environmentId: ObjectID,
): Promise<Array<ScheduledMaintenance>> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  const states: Array<ScheduledMaintenanceState> =
    await ScheduledMaintenanceStateUtil.getInProgressScheduledMaintenanceStates(
      projectId,
    );

  const stateIds: Array<string> = states
    .map((state: ScheduledMaintenanceState): string => {
      return state.id?.toString() || "";
    })
    .filter(Boolean);

  if (stateIds.length === 0) {
    return [];
  }

  const list: ListResult<ScheduledMaintenance> =
    await ModelAPI.getList<ScheduledMaintenance>({
      modelType: ScheduledMaintenance,
      query: {
        projectId: projectId,
        cloudResources: new Includes([environmentId]),
        currentScheduledMaintenanceStateId: new Includes(stateIds),
      },
      select: {
        _id: true,
        title: true,
        endsAt: true,
      },
      sort: { endsAt: SortOrder.Descending },
      skip: 0,
      limit: 10,
    });

  return list.data;
}

const CloudEnvironmentMaintenanceNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [event, setEvent] = useState<ScheduledMaintenance | null>(null);
  const environmentId: string = props.environmentId.toString();

  useEffect(() => {
    let isCancelled: boolean = false;

    setEvent(null);

    loadEventsHoldingEnvironment(new ObjectID(environmentId))
      .then((events: Array<ScheduledMaintenance>): void => {
        if (!isCancelled) {
          setEvent(getLongestHoldingEvent(events));
        }
      })
      .catch((): void => {
        // No notice: the page it sits on reports its own failures.
      });

    return (): void => {
      isCancelled = true;
    };
  }, [environmentId]);

  const eventsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_SCHEDULED_MAINTENANCE
    ] as Route,
    { modelId: new ObjectID(environmentId) },
  );

  const endsAt: Date | null = event?.endsAt
    ? OneUptimeDate.fromString(event.endsAt)
    : null;
  const isEndAhead: boolean = Boolean(
    endsAt && endsAt.getTime() > OneUptimeDate.getCurrentDate().getTime(),
  );
  const sentences: { until: string; overrun: string } =
    CLOUD_ENVIRONMENT_MAINTENANCE_SENTENCES[props.scope];

  return event ? (
    <div className="mb-5">
      <AlertBanner
        type={AlertBannerType.Info}
        icon={IconProp.Clock}
        title={CLOUD_ENVIRONMENT_MAINTENANCE_NOTICE_TITLE}
        dataTestId={CLOUD_ENVIRONMENT_MAINTENANCE_NOTICE_TEST_ID}
        rightElement={
          <AppLink
            to={eventsRoute}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            {translator.translateText(
              CLOUD_ENVIRONMENT_MAINTENANCE_VIEW_EVENTS,
            ) || CLOUD_ENVIRONMENT_MAINTENANCE_VIEW_EVENTS}
          </AppLink>
        }
      >
        <p>
          <TranslatedSentence
            template={isEndAhead ? sentences.until : sentences.overrun}
            slots={{
              event: event._id ? (
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
                    { modelId: new ObjectID(event._id.toString()) },
                  )}
                  className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500"
                >
                  <bdi>{event.title || ""}</bdi>
                </AppLink>
              ) : (
                <bdi className="font-medium text-gray-900">
                  {event.title || ""}
                </bdi>
              ),
            }}
            values={
              isEndAhead && endsAt
                ? {
                    time: OneUptimeDate.getDateAsCompactLocalString(endsAt),
                  }
                : undefined
            }
          />
        </p>
      </AlertBanner>
    </div>
  ) : (
    <></>
  );
};

export default CloudEnvironmentMaintenanceNotice;
