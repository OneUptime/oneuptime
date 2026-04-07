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

  const warnings: Array<string> = [];

  if (!settings.enableSubscribers) {
    warnings.push(
      "Subscribers are disabled for this status page. Subscribers will not receive any notifications until subscribers are enabled in Status Page Settings.",
    );
  }

  if (!settings.showIncidentsOnStatusPage) {
    warnings.push(
      "Incidents are hidden on this status page. Subscribers will not receive notifications for incident creation, state changes, or public notes. To enable these notifications, turn on 'Show Incidents' in Status Page Settings.",
    );
  }

  if (!settings.showAnnouncementsOnStatusPage) {
    warnings.push(
      "Announcements are hidden on this status page. Subscribers will not receive notifications when announcements are created. To enable these notifications, turn on 'Show Announcements' in Status Page Settings.",
    );
  }

  if (!settings.showScheduledMaintenanceEventsOnStatusPage) {
    warnings.push(
      "Scheduled maintenance events are hidden on this status page. Subscribers will not receive notifications for scheduled maintenance creation, state changes, or public notes. To enable these notifications, turn on 'Show Scheduled Maintenance Events' in Status Page Settings.",
    );
  }

  if (!settings.showEpisodesOnStatusPage) {
    warnings.push(
      "Episodes are hidden on this status page. Subscribers will not receive notifications for episode creation, state changes, or public notes. To enable these notifications, turn on 'Show Episodes' in Status Page Settings.",
    );
  }

  if (warnings.length === 0) {
    return <Fragment />;
  }

  return (
    <div className="mt-5 mb-5">
      {warnings.map((warning: string, index: number) => {
        return (
          <Alert
            key={index}
            type={AlertType.WARNING}
            strongTitle="Subscriber Notification Warning"
            title={warning}
          />
        );
      })}
    </div>
  );
};

export default SubscriberNotificationWarnings;
