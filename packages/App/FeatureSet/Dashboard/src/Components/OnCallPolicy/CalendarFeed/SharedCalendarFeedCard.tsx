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
  COVERAGE_GAPS_DESCRIPTION,
  FeedHealth,
  PROJECT_FEED_CURRENT_PATH,
  PROJECT_FEED_PUBLISH_PATH,
  PROJECT_FEED_ROTATE_PATH,
  REGENERATE_WARNING_COPY,
  SHARED_FEED_EMPTY_TITLE,
  SHARED_LINK_OWNERSHIP_COPY,
  SHARED_NEEDS_REGENERATION_COPY,
  SHARED_PREVIOUS_LINK_COPY,
  getFeedHealth,
  getScheduleFeedCurrentPath,
  getScheduleFeedPublishPath,
  getScheduleFeedRotatePath,
} from "./CalendarFeedUtil";
import FeedCardFooter from "./FeedCardFooter";
import FeedDeploymentWarnings from "./FeedDeploymentWarnings";
import FeedEmptyState from "./FeedEmptyState";
import { FeedManageAction, getFeedManageMenuButtons } from "./FeedManageMenu";
import FeedStatusPanel from "./FeedStatusPanel";
import CalendarFeedLinks from "../CalendarFeedLinks";
import OnCallDutyPolicyScheduleCalendarFeed from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import ProjectOnCallCalendarFeed from "Common/Models/DatabaseModels/ProjectOnCallCalendarFeed";
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
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
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
 * A shared calendar link - one per schedule, or one for the whole project.
 *
 * Unlike the personal link, this one is a PROJECT capability: whoever holds
 * the URL sees everybody's shifts, so publishing, regenerating and disabling
 * it are gated on the schedule's Edit permission (the feed models copy the
 * schedule's access-control lists verbatim), while any reader of the schedule
 * may copy an already-published link. The gate is the same PermissionGate the
 * rest of the dashboard uses, so a viewer sees a disabled button that names
 * the missing permission rather than a working button that fails on submit.
 */
export enum SharedCalendarFeedKind {
  Schedule = "schedule",
  Project = "project",
}

export interface ComponentProps {
  kind: SharedCalendarFeedKind;
  /** Required for the schedule kind; ignored for the project kind. */
  scheduleId?: ObjectID | undefined;
  /**
   * The schedule's timezone, when known. Empty means a legacy schedule whose
   * feed is rendered in UTC, which is worth a warning next to the link.
   */
  scheduleTimezone?: string | null | undefined;
  /** Injected by tests; the page passes nothing and gets the real clock. */
  now?: Date | undefined;
}

type SharedFeedModel =
  | OnCallDutyPolicyScheduleCalendarFeed
  | ProjectOnCallCalendarFeed;

interface SharedFeedPaths {
  current: string;
  publish: string;
  rotate: string;
}

type GetPathsFunction = (
  kind: SharedCalendarFeedKind,
  scheduleId: ObjectID | undefined,
) => SharedFeedPaths;

export const getSharedFeedPaths: GetPathsFunction = (
  kind: SharedCalendarFeedKind,
  scheduleId: ObjectID | undefined,
): SharedFeedPaths => {
  if (kind === SharedCalendarFeedKind.Project) {
    return {
      current: PROJECT_FEED_CURRENT_PATH,
      publish: PROJECT_FEED_PUBLISH_PATH,
      rotate: PROJECT_FEED_ROTATE_PATH,
    };
  }

  const id: string = scheduleId ? scheduleId.toString() : "";

  return {
    current: getScheduleFeedCurrentPath(id),
    publish: getScheduleFeedPublishPath(id),
    rotate: getScheduleFeedRotatePath(id),
  };
};

interface LoadOptions {
  // Keep what the card shows while it reads: a re-read after an action.
  keepContent?: boolean | undefined;
}

const SharedCalendarFeedCard: FunctionComponent<ComponentProps> = (
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
  const [settingsRefresher, setSettingsRefresher] = useState<boolean>(false);

  const isSchedule: boolean = props.kind === SharedCalendarFeedKind.Schedule;
  const idPrefix: string = isSchedule
    ? "schedule-shared-calendar-feed"
    : "project-shared-calendar-feed";

  const modelType: { new (): SharedFeedModel } = isSchedule
    ? OnCallDutyPolicyScheduleCalendarFeed
    : ProjectOnCallCalendarFeed;

  const model: SharedFeedModel = new modelType();

  const singularName: string = isSchedule
    ? "schedule calendar link"
    : "project calendar link";

  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
    { singularName: singularName },
  );

  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
    { singularName: singularName },
  );

  const paths: SharedFeedPaths = getSharedFeedPaths(
    props.kind,
    props.scheduleId,
  );

  /*
   * The first read of a link - this schedule's, or another one's after the
   * page moves on - puts the loader in the card's place. A re-read after an
   * action (Disable or Enable link, saving the settings) keeps the card as
   * it is until the answer arrives, as the personal card does.
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
        paths.current,
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
  }, [props.kind, props.scheduleId?.toString()]);

  const postAction: (path: string) => Promise<void> = async (
    path: string,
  ): Promise<void> => {
    setIsBusy(true);
    setError("");

    try {
      const result: FeedStatus = await CalendarFeedAPI.postFeedAction(path);
      setStatus(result);
      setIsUnsupported(false);
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
      await ModelAPI.updateById<SharedFeedModel>({
        modelType: modelType,
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

  const hasLink: boolean = Boolean(
    status && status.exists && status.urls && !status.needsRegeneration,
  );

  /*
   * Below the Growth plan the server renders the shared feed empty
   * (decision 1.3) and refuses the settings write with a 402, so publishing
   * here would hand the team a link that can never show a shift. The gate
   * takes the Publish button's place and says why.
   */
  const isOnPlan: boolean = isCalendarFeedAccessibleOnCurrentPlan();

  const planGate: ReactElement = <CalendarFeedPlanGate idPrefix={idPrefix} />;

  /*
   * `undefined` means the schedule has not loaded yet - no warning, rather
   * than a warning that flashes and vanishes. `null` or "" is a legacy
   * schedule without a timezone, which is the case worth flagging.
   */
  const isLegacyTimezone: boolean =
    props.scheduleTimezone === null || props.scheduleTimezone === "";

  /*
   * ---------- the ⋯ menu (editors act, everyone else sees why not) ----------
   *
   * Regenerate and Disable / Enable need Edit on the schedule. A reader who
   * lacks it still finds them in the menu, locked, saying which permission
   * they need; with no permission snapshot yet - nothing worth saying - the
   * menu is left out rather than accusing the reader of lacking one.
   */
  const lockedReason: string | undefined = updateGate.isAllowed
    ? undefined
    : updateGate.disabledReason;
  const mayManage: boolean = updateGate.isAllowed || Boolean(lockedReason);

  const manageActions: Array<FeedManageAction> = [];

  if (status && status.exists && mayManage) {
    manageActions.push({
      key: "regenerate",
      text: "Regenerate link",
      icon: IconProp.Refresh,
      isDisabled: isBusy,
      disabledReason: lockedReason,
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
      disabledReason: lockedReason,
      dataTestId: `${idPrefix}-toggle`,
      onClick: () => {
        setEnabled(!status.isEnabled).catch(() => {
          // setEnabled routes every failure into the error state.
        });
      },
    });
  }

  /*
   * A failed action is said above the card's body, in red - unless the
   * dialog that started it is still open and says it there.
   */
  const actionError: ReactElement | null =
    error && !showRegenerateConfirm ? (
      <Alert
        type={AlertType.DANGER}
        title={error}
        dataTestId={`${idPrefix}-error`}
      />
    ) : null;

  /* ---------- body ---------- */

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
    /*
     * On a below-plan project the status read itself is refused with a 402
     * (the model is Growth-gated for read too), so the failure IS the plan.
     * Show the gate and its billing link rather than relaying the server's
     * sentence with nothing to act on.
     */
    body = isOnPlan ? (
      <Alert
        type={AlertType.DANGER}
        strongTitle="Could not load the shared calendar link."
        title={error}
        textOnRight="Try again"
        dataTestId={`${idPrefix}-load-error`}
        onClick={() => {
          load().catch(() => {
            // load routes every failure into the error state.
          });
        }}
      />
    ) : (
      planGate
    );
  } else if (status.refusedReason) {
    /*
     * The project-wide link shows every schedule, and this reader may read
     * only some of them: the server says why, and nothing else about it.
     */
    body = (
      <Alert
        type={AlertType.INFO}
        title={status.refusedReason}
        dataTestId={`${idPrefix}-refused`}
      />
    );
  } else if (!status.exists) {
    let publishControl: ReactElement;

    /*
     * Publish starts the panel's text column, as the personal card's
     * Generate calendar link does: a Button keeps a left margin for a
     * dialog's footer from md up, which set it 12px in from the text above.
     */
    if (!isOnPlan) {
      publishControl = planGate;
    } else if (createGate.isAllowed) {
      publishControl = (
        <Button
          title={
            translateString("Publish shared link") || "Publish shared link"
          }
          icon={IconProp.Link}
          buttonStyle={ButtonStyleType.PRIMARY}
          isLoading={isBusy}
          dataTestId={`${idPrefix}-publish`}
          className={FEED_PANEL_BUTTON_CLASS_NAME}
          onClick={() => {
            postAction(paths.publish).catch(() => {
              // postAction routes every failure into the error state.
            });
          }}
        />
      );
    } else if (createGate.disabledReason) {
      publishControl = (
        <Button
          title={
            translateString("Publish shared link") || "Publish shared link"
          }
          icon={IconProp.Link}
          buttonStyle={ButtonStyleType.PRIMARY}
          disabled={true}
          tooltip={createGate.disabledReason}
          dataTestId={`${idPrefix}-publish`}
          className={FEED_PANEL_BUTTON_CLASS_NAME}
          onClick={() => {
            // Locked. The tooltip says which permission is missing.
          }}
        />
      );
    } else {
      publishControl = (
        <div
          className="text-sm text-gray-500"
          data-testid={`${idPrefix}-ask-editor`}
        >
          {translateString(
            isSchedule
              ? "Ask an editor of this schedule to publish it."
              : "Ask a project editor to publish it.",
          )}
        </div>
      );
    }

    body = (
      <div className="space-y-4" data-testid={`${idPrefix}-empty`}>
        {actionError}
        {/*
         * Above the panel, not inside it. The server sends these even with no
         * feed, and they say the link will be unreachable or unencrypted -
         * worth reading before publishing, not after it.
         */}
        <FeedDeploymentWarnings
          hostWarning={status.hostWarning}
          protocolWarning={status.protocolWarning}
          privateHost={status.privateHost}
          idPrefix={idPrefix}
        />
        {/*
         * The same panel as the personal card, so the two halves of the
         * schedule page's subscribe card read as one thing. No bullet list:
         * who the shared link is for is the whole of what there is to say,
         * and the sentence already says it.
         */}
        <FeedEmptyState
          idPrefix={idPrefix}
          icon={IconProp.Team}
          title={SHARED_FEED_EMPTY_TITLE}
          description={
            isSchedule
              ? "No shared link for this schedule yet. Anyone with the link sees everyone's shifts - handy for a team calendar."
              : "No project-wide link has been published yet. Once published, anyone with the link sees every shift on every schedule in this project."
          }
          control={publishControl}
        />
      </div>
    );
  } else {
    const health: FeedHealth = getFeedHealth(
      status,
      props.now || OneUptimeDate.getCurrentDate(),
    );

    const truncatedWarning: ReactElement | null = status.lastRenderTruncated ? (
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

    const timezoneWarning: ReactElement | null =
      isSchedule && isLegacyTimezone ? (
        <Alert
          type={AlertType.WARNING}
          dataTestId={`${idPrefix}-timezone-warning`}
          title={
            translateString(
              "This schedule has no timezone, so shift times in the calendar description are shown in UTC. Set a timezone on the schedule to fix this.",
            ) || ""
          }
        />
      ) : null;

    /*
     * Whatever the reader must know before anything else - a failed action,
     * the plan, a deployment that makes the link unreachable, a shortened
     * calendar, a schedule without a timezone - goes above both columns.
     */
    const hasNotices: boolean = Boolean(
      actionError ||
        !isOnPlan ||
        status.hostWarning ||
        status.protocolWarning ||
        status.privateHost ||
        truncatedWarning ||
        timezoneWarning,
    );

    // The footer sits outside the spaced stack (see PersonalCalendarFeedCard).
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
              {timezoneWarning}
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
                showRotatedAgo={true}
                idPrefix={idPrefix}
                previousLinkCopy={SHARED_PREVIOUS_LINK_COPY}
                needsRegenerationCopy={SHARED_NEEDS_REGENERATION_COPY}
                isBusy={isBusy}
                onEnable={
                  updateGate.isAllowed
                    ? () => {
                        setEnabled(true).catch(() => {
                          // setEnabled routes every failure into the error state.
                        });
                      }
                    : undefined
                }
                onRegenerate={
                  updateGate.isAllowed
                    ? () => {
                        setError("");
                        setShowRegenerateConfirm(true);
                      }
                    : undefined
                }
              />
            </div>
          </div>
        </div>

        <FeedCardFooter
          icon={IconProp.Lock}
          dataTestId={`${idPrefix}-ownership`}
        >
          {translateString(SHARED_LINK_OWNERSHIP_COPY)}
        </FeedCardFooter>
      </div>
    );
  }

  return (
    <Fragment>
      <Card
        title={
          isSchedule
            ? "Everyone's shifts on this schedule (shared team link)"
            : "Everyone's shifts in this project (shared link)"
        }
        description={
          isSchedule
            ? "One link for the whole team. It belongs to the project: editors publish and regenerate it, anyone who can see this schedule may copy it."
            : "One link for every schedule in the project. It belongs to the project: editors publish and regenerate it, anyone who can see the project's schedules may copy it."
        }
        buttons={getFeedManageMenuButtons({
          actions: manageActions,
          idPrefix: idPrefix,
        })}
      >
        {body}
      </Card>

      {status && status.exists && status.feedId && isOnPlan && (
        <CardModelDetail<SharedFeedModel>
          name="Shared Calendar Feed > Settings"
          cardProps={{
            title: "Shared link settings",
            description:
              "What the shared link includes and how far it looks back and ahead.",
          }}
          isEditable={updateGate.isAllowed}
          editButtonText="Edit settings"
          refresher={settingsRefresher}
          onSaveSuccess={() => {
            load({ keepContent: true }).catch(() => {
              // load routes every failure into the error state.
            });
          }}
          /*
           * One page, as the personal link's settings are: the link's few
           * settings, which this card lists, edited where they are read.
           * They were three steps (coverage gaps, time range, and one
           * switch on a step of its own), so changing one meant finding its
           * step first. The minimum gap shows only while gaps are shown.
           */
          formFields={[
            {
              field: {
                includeCoverageGaps: true,
              },
              title: "Show coverage gaps",
              description: COVERAGE_GAPS_DESCRIPTION,
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
            {
              field: {
                minimumGapMinutes: true,
              },
              title: "Minimum gap to show (minutes)",
              description:
                "Gaps shorter than this are left out (1 to 10080 minutes).",
              fieldType: FormFieldSchemaType.Number,
              required: true,
              showIf: (values: FormValues<SharedFeedModel>): boolean => {
                return Boolean(values.includeCoverageGaps);
              },
              validation: {
                minValue: 1,
                maxValue: 10080,
              },
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
            {
              field: {
                rotateWhenMemberLeaves: true,
              },
              title: "Regenerate when someone leaves the project",
              description:
                "Rotates this link automatically whenever a member is removed from the project, so a former colleague's calendar stops updating.",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
          ]}
          modelDetailProps={{
            modelType: modelType,
            id: `${idPrefix}-settings`,
            modelId: new ObjectID(status.feedId),
            showDetailsInNumberOfColumns: 3,
            /*
             * Compact: each setting takes its whole third of the card (the
             * default style sizes a field to a third of its own grid cell).
             */
            style: DetailStyle.Compact,
            fields: [
              {
                field: {
                  includeCoverageGaps: true,
                },
                title: "Show coverage gaps",
                fieldType: FieldType.Boolean,
              },
              {
                field: {
                  minimumGapMinutes: true,
                },
                title: "Minimum gap to show (minutes)",
                fieldType: FieldType.Number,
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
              {
                field: {
                  rotateWhenMemberLeaves: true,
                },
                title: "Regenerate when someone leaves the project",
                fieldType: FieldType.Boolean,
              },
            ],
          }}
        />
      )}

      {showRegenerateConfirm && (
        <ConfirmModal
          title="Regenerate shared link?"
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
            postAction(paths.rotate).catch(() => {
              // postAction routes every failure into the error state.
            });
          }}
        />
      )}
    </Fragment>
  );
};

export default SharedCalendarFeedCard;
