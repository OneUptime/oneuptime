import CalendarFeedAPI from "./CalendarFeedAPI";
import { FeedStatus } from "./CalendarFeedTypes";
import {
  DISABLED_FEED_COPY,
  PERSONAL_FEED_CURRENT_PATH,
  PERSONAL_FEED_ROTATE_PATH,
  PLANNING_NOT_AUDIT_COPY,
  REGENERATE_WARNING_COPY,
} from "./CalendarFeedUtil";
import FeedStatusLine from "./FeedStatusLine";
import CalendarFeedLinks from "../CalendarFeedLinks";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import UserOnCallCalendarFeed from "Common/Models/DatabaseModels/UserOnCallCalendarFeed";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  MAX_FUTURE_DAYS,
  MAX_PAST_DAYS,
  MIN_FUTURE_DAYS,
} from "Common/Types/OnCallDutyPolicy/CalendarFeedWindow";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The reader's own calendar link for the current project.
 *
 * Two variants share the same status read:
 *
 *   full     - the User Settings page. Generate / regenerate / disable / delete
 *              plus the settings, the bookkeeping line and the pointer to the
 *              Time Log.
 *   schedule - the "Only my shifts on this schedule" half of the schedule
 *              page's subscribe card. The same link with `?schedule=` added,
 *              and a pointer to the full page for everything else.
 *
 * The link is minted by POST /feed/rotate on both first use and regeneration;
 * there is deliberately no client-side token anywhere - the browser only ever
 * sees the URL the server chose to return.
 */
export enum PersonalCalendarFeedVariant {
  Full = "full",
  Schedule = "schedule",
}

export interface ComponentProps {
  variant: PersonalCalendarFeedVariant;
  /** Required for the schedule variant; ignored otherwise. */
  scheduleId?: ObjectID | undefined;
  /** Injected by tests; the page passes nothing and gets the real clock. */
  now?: Date | undefined;
}

const PersonalCalendarFeedCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isUnsupported, setIsUnsupported] = useState<boolean>(false);
  const [status, setStatus] = useState<FeedStatus | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] =
    useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [settingsRefresher, setSettingsRefresher] = useState<boolean>(false);

  const isFull: boolean = props.variant === PersonalCalendarFeedVariant.Full;
  const idPrefix: string = isFull
    ? "personal-calendar-feed"
    : "schedule-personal-calendar-feed";

  const load: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const result: FeedStatus | null = await CalendarFeedAPI.getFeedStatus(
        PERSONAL_FEED_CURRENT_PATH,
      );

      if (!result) {
        setIsUnsupported(true);
        setStatus(null);
      } else {
        setIsUnsupported(false);
        setStatus(result);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {
      // load routes every failure into the error state.
    });
  }, []);

  const rotate: () => Promise<void> = async (): Promise<void> => {
    setIsBusy(true);
    setError("");

    try {
      const result: FeedStatus = await CalendarFeedAPI.postFeedAction(
        PERSONAL_FEED_ROTATE_PATH,
      );
      setStatus(result);
      setShowRegenerateConfirm(false);
      setSettingsRefresher((value: boolean): boolean => {
        return !value;
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsBusy(false);
    }
  };

  const setEnabled: (isEnabled: boolean) => Promise<void> = async (
    isEnabled: boolean,
  ): Promise<void> => {
    if (!status || !status.feedId) {
      return;
    }

    setIsBusy(true);
    setError("");

    try {
      await ModelAPI.updateById<UserOnCallCalendarFeed>({
        modelType: UserOnCallCalendarFeed,
        id: new ObjectID(status.feedId),
        data: {
          isEnabled: isEnabled,
        },
      });
      await load();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsBusy(false);
    }
  };

  const deleteFeed: () => Promise<void> = async (): Promise<void> => {
    if (!status || !status.feedId) {
      return;
    }

    setIsBusy(true);
    setError("");

    try {
      await ModelAPI.deleteItem<UserOnCallCalendarFeed>({
        modelType: UserOnCallCalendarFeed,
        id: new ObjectID(status.feedId),
      });
      setShowDeleteConfirm(false);
      await load();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsBusy(false);
    }
  };

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route,
  );

  const timeLogRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.ON_CALLDUTY_USER_TIME_LOGS] as Route,
  );

  const hasLink: boolean = Boolean(
    status && status.exists && status.urls && !status.needsRegeneration,
  );

  const generateButton: ReactElement = (
    <Button
      title={
        translateString("Generate calendar link") || "Generate calendar link"
      }
      icon={IconProp.Link}
      buttonStyle={ButtonStyleType.PRIMARY}
      isLoading={isBusy}
      dataTestId={`${idPrefix}-generate`}
      onClick={() => {
        rotate().catch(() => {
          // rotate routes every failure into the error state.
        });
      }}
    />
  );

  /* ---------- schedule variant ---------- */

  if (!isFull) {
    let body: ReactElement;

    if (isLoading) {
      body = <ComponentLoader />;
    } else if (isUnsupported) {
      body = (
        <div
          className="text-sm text-gray-500"
          data-testid={`${idPrefix}-unsupported`}
        >
          {translateString("This server does not offer calendar feeds yet.")}
        </div>
      );
    } else if (error) {
      body = <ErrorMessage message={error} />;
    } else if (status && hasLink && status.isEnabled && status.urls) {
      body = (
        <CalendarFeedLinks
          urls={status.urls}
          scheduleId={props.scheduleId}
          hostWarning={status.hostWarning}
          protocolWarning={status.protocolWarning}
          showRefreshAlert={false}
          idPrefix={idPrefix}
        />
      );
    } else if (status && status.exists && !status.isEnabled) {
      body = (
        <Alert
          type={AlertType.WARNING}
          title={translateString(DISABLED_FEED_COPY) || DISABLED_FEED_COPY}
        />
      );
    } else if (status && status.needsRegeneration) {
      body = (
        <Alert
          type={AlertType.WARNING}
          title={
            translateString(
              "Your calendar link needs to be regenerated before it can be shown here.",
            ) || ""
          }
        />
      );
    } else {
      body = (
        <div className="space-y-2">
          <div className="text-sm text-gray-500">
            {translateString(
              "You do not have a calendar link yet. Generate one to subscribe to your shifts.",
            )}
          </div>
          {generateButton}
        </div>
      );
    }

    return (
      <div className="space-y-3" data-testid={idPrefix}>
        <div>
          <div className="text-base font-semibold text-gray-900">
            {translateString("Only my shifts on this schedule")}
          </div>
          <div className="text-sm text-gray-500">
            {translateString(
              "Your personal link, narrowed to this schedule. It stays private to you.",
            )}
          </div>
        </div>
        {body}
        <div className="text-sm">
          <Link to={settingsRoute} className="text-indigo-600 hover:underline">
            {translateString("Manage your calendar link and reminders")}
          </Link>
        </div>
      </div>
    );
  }

  /* ---------- full variant ---------- */

  const buttons: Array<CardButtonSchema> = [];

  if (status && status.exists) {
    buttons.push({
      title: "Regenerate link",
      icon: IconProp.Refresh,
      buttonStyle: ButtonStyleType.OUTLINE,
      disabled: isBusy,
      onClick: () => {
        setShowRegenerateConfirm(true);
      },
    });

    buttons.push({
      title: status.isEnabled ? "Disable" : "Enable",
      icon: status.isEnabled ? IconProp.BellSlash : IconProp.Bell,
      buttonStyle: ButtonStyleType.OUTLINE,
      disabled: isBusy,
      onClick: () => {
        setEnabled(!status.isEnabled).catch(() => {
          // setEnabled routes every failure into the error state.
        });
      },
    });

    buttons.push({
      title: "Delete",
      icon: IconProp.Trash,
      buttonStyle: ButtonStyleType.DANGER_OUTLINE,
      disabled: isBusy,
      onClick: () => {
        setShowDeleteConfirm(true);
      },
    });
  }

  let body: ReactElement;

  if (isLoading) {
    body = <ComponentLoader />;
  } else if (isUnsupported) {
    body = (
      <Alert
        type={AlertType.INFO}
        dataTestId={`${idPrefix}-unsupported`}
        title={
          translateString(
            "This server does not offer calendar feeds yet. Ask whoever runs it to upgrade OneUptime.",
          ) || ""
        }
      />
    );
  } else if (!status) {
    body = (
      <ErrorMessage message={error || "Could not load your calendar link."} />
    );
  } else if (!status.exists) {
    body = (
      <div className="space-y-3" data-testid={`${idPrefix}-empty`}>
        {error && <ErrorMessage message={error} />}
        <div className="text-sm text-gray-600">
          {translateString(
            "Generate a private link, then subscribe to it from your calendar app. The link shows every shift you hold on this project's schedules, including shifts you cover for someone else.",
          )}
        </div>
        {generateButton}
      </div>
    );
  } else {
    body = (
      <div className="space-y-4" data-testid={`${idPrefix}-active`}>
        {error && <ErrorMessage message={error} />}

        {status.needsRegeneration && (
          <Alert
            type={AlertType.WARNING}
            dataTestId={`${idPrefix}-needs-regeneration`}
            title={
              translateString(
                "The stored link can no longer be read, usually because the server's encryption secret changed. Subscribers keep working, but the link cannot be shown until you regenerate it.",
              ) || ""
            }
          />
        )}

        {!status.isEnabled && (
          <Alert
            type={AlertType.WARNING}
            dataTestId={`${idPrefix}-disabled`}
            title={translateString(DISABLED_FEED_COPY) || DISABLED_FEED_COPY}
          />
        )}

        {hasLink && status.urls && (
          <CalendarFeedLinks
            urls={status.urls}
            hostWarning={status.hostWarning}
            protocolWarning={status.protocolWarning}
            lastRenderTruncated={status.lastRenderTruncated}
            idPrefix={idPrefix}
          />
        )}

        <FeedStatusLine status={status} now={props.now} idPrefix={idPrefix} />

        {status.previousTokenExpiresAt && (
          <div
            className="text-sm text-gray-500"
            data-testid={`${idPrefix}-previous-link`}
          >
            {translateString("Your previous link keeps working until")}{" "}
            {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              OneUptimeDate.fromString(status.previousTokenExpiresAt),
            )}
            .
          </div>
        )}

        <div
          className="text-sm text-gray-500"
          data-testid={`${idPrefix}-time-log`}
        >
          {translateString(PLANNING_NOT_AUDIT_COPY)}{" "}
          <Link to={timeLogRoute} className="text-indigo-600 hover:underline">
            {translateString("Open the On-Call Time Log")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Fragment>
      <Card
        title="Subscribe to your on-call shifts"
        description="Add your shifts on this project's schedules to Google Calendar, Outlook, Apple Calendar or any app that can subscribe to a calendar link."
        buttons={buttons}
      >
        {body}
      </Card>

      {status && status.exists && status.feedId && (
        <CardModelDetail<UserOnCallCalendarFeed>
          name="Calendar Feed > Settings"
          cardProps={{
            title: "Calendar feed settings",
            description:
              "What the link includes and how far it looks back and ahead.",
          }}
          isEditable={true}
          editButtonText="Edit settings"
          refresher={settingsRefresher}
          onSaveSuccess={() => {
            load().catch(() => {
              // load routes every failure into the error state.
            });
          }}
          formFields={[
            {
              field: {
                includeCoveringShifts: true,
              },
              title: "Include shifts I cover for others",
              description:
                "Shifts you hold because an override names you as the cover.",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
            {
              field: {
                pastDays: true,
              },
              title: "Days of past shifts",
              description: `How many days back the calendar reaches (0 to ${MAX_PAST_DAYS}).`,
              fieldType: FormFieldSchemaType.Number,
              required: true,
              validation: {
                minValue: 0,
                maxValue: MAX_PAST_DAYS,
              },
            },
            {
              field: {
                futureDays: true,
              },
              title: "Days ahead",
              description: `How far ahead the calendar reaches (${MIN_FUTURE_DAYS} to ${MAX_FUTURE_DAYS}).`,
              fieldType: FormFieldSchemaType.Number,
              required: true,
              validation: {
                minValue: MIN_FUTURE_DAYS,
                maxValue: MAX_FUTURE_DAYS,
              },
            },
          ]}
          modelDetailProps={{
            modelType: UserOnCallCalendarFeed,
            id: "calendar-feed-settings",
            modelId: new ObjectID(status.feedId),
            showDetailsInNumberOfColumns: 3,
            fields: [
              {
                field: {
                  includeCoveringShifts: true,
                },
                title: "Include shifts I cover for others",
                fieldType: FieldType.Boolean,
              },
              {
                field: {
                  pastDays: true,
                },
                title: "Days of past shifts",
                fieldType: FieldType.Number,
              },
              {
                field: {
                  futureDays: true,
                },
                title: "Days ahead",
                fieldType: FieldType.Number,
              },
            ],
          }}
        />
      )}

      {showRegenerateConfirm && (
        <ConfirmModal
          title="Regenerate calendar link?"
          description={translateString(REGENERATE_WARNING_COPY) || ""}
          submitButtonText="Regenerate link"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isBusy}
          error={error || undefined}
          onClose={() => {
            setShowRegenerateConfirm(false);
          }}
          onSubmit={() => {
            rotate().catch(() => {
              // rotate routes every failure into the error state.
            });
          }}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmModal
          title="Delete calendar link?"
          description={
            translateString(
              "Every app subscribed to this link stops updating. You can generate a new link at any time.",
            ) || ""
          }
          submitButtonText="Delete"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isBusy}
          error={error || undefined}
          onClose={() => {
            setShowDeleteConfirm(false);
          }}
          onSubmit={() => {
            deleteFeed().catch(() => {
              // deleteFeed routes every failure into the error state.
            });
          }}
        />
      )}
    </Fragment>
  );
};

export default PersonalCalendarFeedCard;
