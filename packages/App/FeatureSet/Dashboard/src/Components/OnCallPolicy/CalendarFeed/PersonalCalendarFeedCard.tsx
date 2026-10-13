import CalendarFeedAPI from "./CalendarFeedAPI";
import {
  FEED_BODY_GRID_CLASS_NAME,
  FEED_PANEL_BUTTON_CLASS_NAME,
  FEED_SUBSCRIBE_COLUMN_CLASS_NAME,
  getFeedStatusColumnClassName,
} from "./CalendarFeedLayout";
import CalendarFeedPlanGate, {
  isCalendarFeedAccessibleOnCurrentPlan,
} from "./CalendarFeedPlanGate";
import { FeedStatus } from "./CalendarFeedTypes";
import {
  DISABLED_FEED_COPY,
  FeedHealth,
  PERSONAL_FEED_CURRENT_PATH,
  PERSONAL_FEED_EMPTY_DESCRIPTION,
  PERSONAL_FEED_EMPTY_POINT_COVERING,
  PERSONAL_FEED_EMPTY_POINT_PRIVATE,
  PERSONAL_FEED_EMPTY_POINT_SHIFTS,
  PERSONAL_FEED_EMPTY_TITLE,
  PERSONAL_FEED_ROTATE_PATH,
  PERSONAL_NEEDS_REGENERATION_COPY,
  PERSONAL_PREVIOUS_LINK_COPY,
  PLANNING_NOT_AUDIT_COPY,
  REGENERATE_WARNING_COPY,
  getFeedHealth,
} from "./CalendarFeedUtil";
import FeedCardFooter from "./FeedCardFooter";
import FeedDeploymentWarnings from "./FeedDeploymentWarnings";
import FeedEmptyState, { FeedEmptyStatePoint } from "./FeedEmptyState";
import { FeedManageAction, getFeedManageMenuButtons } from "./FeedManageMenu";
import FeedStatusPanel from "./FeedStatusPanel";
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
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslateValue from "Common/UI/Utils/Translation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
 *   full     - the User Settings page. One card in the order a reader needs
 *              it: subscribing (an option per calendar app, or the link to
 *              copy) beside whether it works (FeedStatusPanel), the rare
 *              actions - Regenerate, Disable, Delete - folded into the
 *              header's ⋯ (FeedManageMenu), and the pointer to the Time Log
 *              as a quiet footer. Then the settings card.
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

interface LoadOptions {
  // Keep what the card shows while it reads: a re-read after an action.
  keepContent?: boolean | undefined;
}

const PersonalCalendarFeedCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();

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

  /*
   * Reads the link's status. The first read, and Try again after a failed
   * one, put the loader in the card's place: there is nothing to show yet.
   * A re-read after something the reader did - Disable or Enable link,
   * Delete link, saving the settings - keeps the card as it is until the
   * answer arrives, so the card does not collapse to a spinner and back
   * under the reader's pointer (the page jumped by the card's height).
   */
  const load: (options?: LoadOptions) => Promise<void> = async (
    options?: LoadOptions,
  ): Promise<void> => {
    if (!options?.keepContent) {
      setIsLoading(true);
    }
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

  const reload: () => void = (): void => {
    load().catch(() => {
      // load routes every failure into the error state.
    });
  };

  // A re-read after an action: the card keeps what it shows meanwhile.
  const refresh: () => void = (): void => {
    load({ keepContent: true }).catch(() => {
      // load routes every failure into the error state.
    });
  };

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
      await load({ keepContent: true });
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
      await load({ keepContent: true });
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

  /*
   * Below the Growth plan the server renders every feed empty (decision 1.3)
   * and refuses the settings write with a 402, so offering "Generate calendar
   * link" would hand the reader a link that can never show a shift. The gate
   * takes the button's place and says why.
   */
  const isOnPlan: boolean = isCalendarFeedAccessibleOnCurrentPlan();

  const planGate: ReactElement = <CalendarFeedPlanGate idPrefix={idPrefix} />;

  /*
   * A Button keeps a left margin for a dialog's footer from md up; here it
   * starts the panel's text column, so it lines up with the text above it.
   */
  const generateControl: ReactElement = isOnPlan ? (
    <Button
      title={
        translateString("Generate calendar link") || "Generate calendar link"
      }
      icon={IconProp.Link}
      buttonStyle={ButtonStyleType.PRIMARY}
      isLoading={isBusy}
      dataTestId={`${idPrefix}-generate`}
      className={FEED_PANEL_BUTTON_CLASS_NAME}
      onClick={() => {
        rotate().catch(() => {
          // rotate routes every failure into the error state.
        });
      }}
    />
  ) : (
    planGate
  );

  /*
   * What the reader is actually deciding about: two lines of "what lands in
   * my calendar" and one that says the URL is the credential. The last is a
   * lock rather than a tick because it is a caution, not a feature.
   */
  const emptyStatePoints: Array<FeedEmptyStatePoint> = [
    {
      icon: IconProp.Check,
      iconClassName: "text-indigo-600",
      text: PERSONAL_FEED_EMPTY_POINT_SHIFTS,
    },
    {
      icon: IconProp.Check,
      iconClassName: "text-indigo-600",
      text: PERSONAL_FEED_EMPTY_POINT_COVERING,
    },
    {
      icon: IconProp.Lock,
      text: PERSONAL_FEED_EMPTY_POINT_PRIVATE,
    },
  ];

  /*
   * A failed action is said above the card's body, in red - unless the
   * dialog that started it is still open and says it there.
   */
  const actionError: ReactElement | null =
    error && !showRegenerateConfirm && !showDeleteConfirm ? (
      <Alert
        type={AlertType.DANGER}
        title={error}
        dataTestId={`${idPrefix}-error`}
      />
    ) : null;

  /*
   * The status read itself failed: the server's reason, and a way to try
   * again without reloading the page.
   */
  const loadError: ReactElement = (
    <Alert
      type={AlertType.DANGER}
      strongTitle="Could not load your calendar link."
      title={error}
      textOnRight="Try again"
      dataTestId={`${idPrefix}-load-error`}
      onClick={reload}
    />
  );

  const truncatedWarning: ReactElement | null =
    status && status.lastRenderTruncated ? (
      <Alert
        type={AlertType.WARNING}
        title={
          translateString(
            "The last calendar was shortened because it would have exceeded the event limit. Reduce the days ahead in the settings to see every shift.",
          ) || ""
        }
        dataTestId={`${idPrefix}-truncated-warning`}
      />
    ) : null;

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
    } else if (!status) {
      body = loadError;
    } else if (hasLink && status.isEnabled && status.urls) {
      body = (
        <div className="space-y-4">
          {actionError}
          <FeedDeploymentWarnings
            hostWarning={status.hostWarning}
            protocolWarning={status.protocolWarning}
            privateHost={status.privateHost}
            idPrefix={idPrefix}
          />
          {truncatedWarning}
          <CalendarFeedLinks
            urls={status.urls}
            scheduleId={props.scheduleId}
            tokenHint={status.tokenHint}
            idPrefix={idPrefix}
            isAlone={true}
          />
        </div>
      );
    } else if (status.exists && !status.isEnabled) {
      body = (
        <Alert
          type={AlertType.WARNING}
          dataTestId={`${idPrefix}-disabled`}
          title={translateString(DISABLED_FEED_COPY) || DISABLED_FEED_COPY}
        />
      );
    } else if (status.needsRegeneration) {
      body = (
        <Alert
          type={AlertType.WARNING}
          dataTestId={`${idPrefix}-needs-regeneration`}
          title={
            translateString(
              "Your calendar link needs to be regenerated before it can be shown here.",
            ) || ""
          }
        />
      );
    } else {
      /*
       * The same panel as the settings page, without the bullets: this is one
       * half of a card on somebody else's page, and the three lines of
       * "what's in it" belong where the reader went looking for the feature.
       */
      body = (
        <div className="space-y-4">
          {actionError}
          <FeedEmptyState
            idPrefix={idPrefix}
            title={PERSONAL_FEED_EMPTY_TITLE}
            description={PERSONAL_FEED_EMPTY_DESCRIPTION}
            control={generateControl}
          />
        </div>
      );
    }

    return (
      <div className="space-y-4" data-testid={idPrefix}>
        <div>
          <div className="text-base font-semibold text-gray-900">
            {translateString("Only my shifts on this schedule")}
          </div>
          <div className="mt-0.5 text-sm text-gray-500">
            {translateString(
              "Your personal link, narrowed to this schedule. It stays private to you.",
            )}
          </div>
        </div>
        {body}
        <div className="text-sm">
          <Link
            to={settingsRoute}
            className="font-medium text-indigo-600 hover:underline"
          >
            {translateString("Manage your calendar link and reminders")}
          </Link>
        </div>
      </div>
    );
  }

  /* ---------- full variant ---------- */

  const manageActions: Array<FeedManageAction> = [];

  if (status && status.exists) {
    manageActions.push({
      key: "regenerate",
      text: "Regenerate link",
      icon: IconProp.Refresh,
      isDisabled: isBusy,
      dataTestId: `${idPrefix}-regenerate`,
      onClick: () => {
        setError("");
        setShowRegenerateConfirm(true);
      },
    });

    manageActions.push({
      key: "toggle",
      text: status.isEnabled ? "Disable link" : "Enable link",
      icon: status.isEnabled ? IconProp.BellSlash : IconProp.Bell,
      isDisabled: isBusy,
      dataTestId: `${idPrefix}-toggle`,
      onClick: () => {
        setEnabled(!status.isEnabled).catch(() => {
          // setEnabled routes every failure into the error state.
        });
      },
    });

    manageActions.push({
      key: "delete",
      text: "Delete link",
      icon: IconProp.Trash,
      isDestructive: true,
      isDisabled: isBusy,
      dataTestId: `${idPrefix}-delete`,
      onClick: () => {
        setError("");
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
    body = loadError;
  } else if (!status.exists) {
    body = (
      <div className="space-y-4" data-testid={`${idPrefix}-empty`}>
        {actionError}
        {/*
         * Above the panel, not inside it. The server sends these even with no
         * feed, and they say the link will be unreachable or unencrypted -
         * worth reading before the click, not after it.
         */}
        <FeedDeploymentWarnings
          hostWarning={status.hostWarning}
          protocolWarning={status.protocolWarning}
          privateHost={status.privateHost}
          idPrefix={idPrefix}
        />
        <FeedEmptyState
          idPrefix={idPrefix}
          title={PERSONAL_FEED_EMPTY_TITLE}
          description={PERSONAL_FEED_EMPTY_DESCRIPTION}
          points={emptyStatePoints}
          control={generateControl}
        />
      </div>
    );
  } else {
    const health: FeedHealth = getFeedHealth(
      status,
      props.now || OneUptimeDate.getCurrentDate(),
    );

    /*
     * Whatever the reader must know before anything else - a failed action,
     * the plan, a deployment that makes the link unreachable, a shortened
     * calendar - goes above both columns, at the card's full width.
     */
    const hasNotices: boolean = Boolean(
      actionError ||
        !isOnPlan ||
        status.hostWarning ||
        status.protocolWarning ||
        status.privateHost ||
        truncatedWarning,
    );

    /*
     * The footer is outside the spaced stack on purpose: Tailwind's space-y
     * also sets every later child's bottom margin, which would cancel the
     * footer's own and leave it short of the card's bottom edge.
     */
    body = (
      <div data-testid={`${idPrefix}-active`}>
        <div className="space-y-6">
          {hasNotices && (
            <div className="space-y-4" data-testid={`${idPrefix}-notices`}>
              {actionError}
              {planGate}
              <FeedDeploymentWarnings
                hostWarning={status.hostWarning}
                protocolWarning={status.protocolWarning}
                privateHost={status.privateHost}
                idPrefix={idPrefix}
              />
              {truncatedWarning}
            </div>
          )}

          <div className={FEED_BODY_GRID_CLASS_NAME}>
            {hasLink && status.urls && (
              <div className={FEED_SUBSCRIBE_COLUMN_CLASS_NAME}>
                <CalendarFeedLinks
                  urls={status.urls}
                  tokenHint={status.tokenHint}
                  idPrefix={idPrefix}
                />
              </div>
            )}
            <div
              className={getFeedStatusColumnClassName({
                hasLink: hasLink,
                health: health,
              })}
            >
              <FeedStatusPanel
                status={status}
                now={props.now}
                idPrefix={idPrefix}
                previousLinkCopy={PERSONAL_PREVIOUS_LINK_COPY}
                needsRegenerationCopy={PERSONAL_NEEDS_REGENERATION_COPY}
                isBusy={isBusy}
                onEnable={() => {
                  setEnabled(true).catch(() => {
                    // setEnabled routes every failure into the error state.
                  });
                }}
                onRegenerate={() => {
                  setError("");
                  setShowRegenerateConfirm(true);
                }}
              />
            </div>
          </div>
        </div>

        <FeedCardFooter
          icon={IconProp.Clock}
          dataTestId={`${idPrefix}-time-log`}
        >
          {translateString(PLANNING_NOT_AUDIT_COPY)}{" "}
          <Link
            to={timeLogRoute}
            className="font-medium text-indigo-600 hover:underline"
          >
            {translateString("Open the On-Call Time Log")}
          </Link>
        </FeedCardFooter>
      </div>
    );
  }

  return (
    <Fragment>
      <Card
        title="Subscribe to your on-call shifts"
        description="Add your shifts on this project's schedules to Google Calendar, Outlook, Apple Calendar or any app that can subscribe to a calendar link."
        buttons={getFeedManageMenuButtons({
          actions: manageActions,
          idPrefix: idPrefix,
        })}
      >
        {body}
      </Card>

      {status && status.exists && status.feedId && isOnPlan && (
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
            refresh();
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
              description: translator.translateTemplate(
                "How many days back the calendar reaches (0 to {{max}}).",
                { max: MAX_PAST_DAYS },
              ),
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
              description: translator.translateTemplate(
                "How far ahead the calendar reaches ({{min}} to {{max}}).",
                { min: MIN_FUTURE_DAYS, max: MAX_FUTURE_DAYS },
              ),
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
            /*
             * Compact: each setting takes its whole third of the card. The
             * default style sizes a field to a third of its own grid cell,
             * which squeezed "Include shifts I cover for others" into five
             * lines of a column 100px wide.
             */
            style: DetailStyle.Compact,
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
            setError("");
          }}
          onSubmit={() => {
            rotate().catch(() => {
              // rotate routes every failure into the error state.
            });
          }}
        />
      )}

      {/*
       * The button says what it does, as the menu item that opened the
       * dialog does - and as Regenerate's says "Regenerate link".
       */}
      {showDeleteConfirm && (
        <ConfirmModal
          title="Delete calendar link?"
          description={
            translateString(
              "Every app subscribed to this link stops updating. You can generate a new link at any time.",
            ) || ""
          }
          submitButtonText="Delete link"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isBusy}
          error={error || undefined}
          onClose={() => {
            setShowDeleteConfirm(false);
            setError("");
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
