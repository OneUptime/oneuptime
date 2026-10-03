import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Link from "Common/UI/Components/Link/Link";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { DisplaySwitchColumn } from "./StatusPageDisplaySettingsCopy";

/*
 * On a status page's subscriber pages, while the page hides one of the
 * event types it can notify about: a page that does not show incidents (or
 * episodes, announcements, scheduled maintenance) does not notify its
 * subscribers about them either, which nothing on these pages says
 * otherwise. The switches are on Advanced Settings, in the "What your status
 * page shows" card, which the warning links to.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

interface HiddenEventType {
  column: DisplaySwitchColumn;
  // The event type's name.
  name: string;
}

// In the order the "What your status page shows" card lists them.
const EVENT_TYPES: ReadonlyArray<HiddenEventType> = [
  { column: "showIncidentsOnStatusPage", name: translationKey("Incidents") },
  { column: "showEpisodesOnStatusPage", name: translationKey("Episodes") },
  {
    column: "showAnnouncementsOnStatusPage",
    name: translationKey("Announcements"),
  },
  {
    column: "showScheduledMaintenanceEventsOnStatusPage",
    name: translationKey("Scheduled Maintenance"),
  },
];

export const SubscriberNotificationWarningsCopy: {
  title: string;
  description: string;
  link: string;
} = {
  title: translationKey("Some subscriber notifications are disabled"),
  description: translationKey(
    "This status page hides these event types, so its subscribers are not notified about them:",
  ),
  link: translationKey("Change what your status page shows"),
};

const SubscriberNotificationWarnings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [hidden, setHidden] = useState<Array<HiddenEventType> | null>(null);

  useAsyncEffect(async () => {
    try {
      const statusPage: StatusPage | null = await ModelAPI.getItem<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        select: {
          showIncidentsOnStatusPage: true,
          showEpisodesOnStatusPage: true,
          showAnnouncementsOnStatusPage: true,
          showScheduledMaintenanceEventsOnStatusPage: true,
        },
      });

      if (statusPage) {
        setHidden(
          EVENT_TYPES.filter((eventType: HiddenEventType): boolean => {
            // Each column defaults to on, so only an explicit false hides.
            return statusPage[eventType.column] === false;
          }),
        );
      }
    } catch {
      // Fail silently - warnings won't show but functionality continues
    }
  }, [props.statusPageId.toString()]);

  if (!hidden || hidden.length === 0) {
    return <Fragment />;
  }

  return (
    <Alert
      type={AlertType.WARNING}
      strongTitle={SubscriberNotificationWarningsCopy.title}
      dataTestId="subscriber-notification-warnings"
      title={
        <div>
          <p>
            {translator.translateText(
              SubscriberNotificationWarningsCopy.description,
            )}
          </p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            {hidden.map((eventType: HiddenEventType): ReactElement => {
              return (
                <li key={eventType.column} className="font-medium">
                  {translator.translateText(eventType.name)}
                </li>
              );
            })}
          </ul>
          <p className="mt-2">
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.STATUS_PAGE_VIEW_SETTINGS] as Route,
                { modelId: props.statusPageId },
              )}
              className="font-medium underline"
            >
              {translator.translateText(
                SubscriberNotificationWarningsCopy.link,
              )}
            </Link>
          </p>
        </div>
      }
    />
  );
};

export default SubscriberNotificationWarnings;
