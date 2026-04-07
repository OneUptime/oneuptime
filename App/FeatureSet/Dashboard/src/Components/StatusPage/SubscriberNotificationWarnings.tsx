import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

export interface ComponentProps {
  statusPageId: ObjectID;
}

interface StatusPageVisibilitySettings {
  showIncidentsOnStatusPage?: boolean;
  showAnnouncementsOnStatusPage?: boolean;
  showScheduledMaintenanceEventsOnStatusPage?: boolean;
  showEpisodesOnStatusPage?: boolean;
  enableSubscribers?: boolean;
}

interface WarningItem {
  feature: string;
  detail: string;
  setting: string;
}

const SubscriberNotificationWarnings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [settings, setSettings] =
    useState<StatusPageVisibilitySettings | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useAsyncEffect(async () => {
    try {
      setIsLoading(true);
      const statusPage: StatusPage | null = await ModelAPI.getItem<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        select: {
          showIncidentsOnStatusPage: true,
          showAnnouncementsOnStatusPage: true,
          showScheduledMaintenanceEventsOnStatusPage: true,
          showEpisodesOnStatusPage: true,
          enableSubscribers: true,
        },
      });

      if (statusPage) {
        setSettings({
          showIncidentsOnStatusPage: statusPage.showIncidentsOnStatusPage,
          showAnnouncementsOnStatusPage:
            statusPage.showAnnouncementsOnStatusPage,
          showScheduledMaintenanceEventsOnStatusPage:
            statusPage.showScheduledMaintenanceEventsOnStatusPage,
          showEpisodesOnStatusPage: statusPage.showEpisodesOnStatusPage,
          enableSubscribers: statusPage.enableSubscribers,
        });
      }
    } catch {
      // Fail silently - warnings won't show but functionality continues
    } finally {
      setIsLoading(false);
    }
  }, [props.statusPageId.toString()]);

  if (isLoading || !settings) {
    return <Fragment />;
  }

  // If subscribers are globally disabled, show a single clear message
  if (!settings.enableSubscribers) {
    return (
      <Alert
        type={AlertType.WARNING}
        strongTitle="Subscribers Disabled"
        title="Subscribers are disabled for this status page. No notifications will be sent to any subscriber. Enable subscribers in Status Page Settings to start sending notifications."
      />
    );
  }

  const warnings: Array<WarningItem> = [];

  if (!settings.showIncidentsOnStatusPage) {
    warnings.push({
      feature: "Incidents",
      detail: "creation, state changes, and public notes",
      setting: "Show Incidents",
    });
  }

  if (!settings.showAnnouncementsOnStatusPage) {
    warnings.push({
      feature: "Announcements",
      detail: "creation",
      setting: "Show Announcements",
    });
  }

  if (!settings.showScheduledMaintenanceEventsOnStatusPage) {
    warnings.push({
      feature: "Scheduled Maintenance",
      detail: "creation, state changes, and public notes",
      setting: "Show Scheduled Maintenance Events",
    });
  }

  if (!settings.showEpisodesOnStatusPage) {
    warnings.push({
      feature: "Episodes",
      detail: "creation, state changes, and public notes",
      setting: "Show Episodes",
    });
  }

  if (warnings.length === 0) {
    return <Fragment />;
  }

  return (
    <Alert
      type={AlertType.WARNING}
      strongTitle="Some subscriber notifications are disabled"
      title={
        <div>
          <p>
            {
              "The following event types are hidden on this status page. Subscribers will not receive notifications for them. To fix this, enable the corresponding settings in Status Page Settings."
            }
          </p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            {warnings.map((warning: WarningItem, index: number) => {
              return (
                <li key={index}>
                  <span className="font-medium">{warning.feature}</span>
                  {" — "}
                  {`no notifications for ${warning.detail}. Enable `}
                  <span className="font-medium">{`"${warning.setting}"`}</span>
                  {" to fix."}
                </li>
              );
            })}
          </ul>
        </div>
      }
    />
  );
};

export default SubscriberNotificationWarnings;
