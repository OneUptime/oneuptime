import CalendarFeedAPI from "./CalendarFeedAPI";
import { FeedStatus } from "./CalendarFeedTypes";
import {
  COVERAGE_GAPS_DESCRIPTION,
  DISABLED_FEED_COPY,
  PROJECT_FEED_CURRENT_PATH,
  PROJECT_FEED_PUBLISH_PATH,
  PROJECT_FEED_ROTATE_PATH,
  REGENERATE_WARNING_COPY,
  SHARED_LINK_OWNERSHIP_COPY,
  getScheduleFeedCurrentPath,
  getScheduleFeedPublishPath,
  getScheduleFeedRotatePath,
} from "./CalendarFeedUtil";
import FeedStatusLine from "./FeedStatusLine";
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
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
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

const SharedCalendarFeedCard: FunctionComponent<ComponentProps> = (
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

  const load: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
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
      await load();
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
   * `undefined` means the schedule has not loaded yet - no warning, rather
   * than a warning that flashes and vanishes. `null` or "" is a legacy
   * schedule without a timezone, which is the case worth flagging.
   */
  const isLegacyTimezone: boolean =
    props.scheduleTimezone === null || props.scheduleTimezone === "";

  /* ---------- card buttons (editors only) ---------- */

  const buttons: Array<CardButtonSchema> = [];

  if (status && status.exists) {
    const regenerate: CardButtonSchema | null = PermissionGate.gateCardButton(
      {
        title: "Regenerate link",
        icon: IconProp.Refresh,
        buttonStyle: ButtonStyleType.OUTLINE,
        disabled: isBusy,
        onClick: () => {
          setShowRegenerateConfirm(true);
        },
      },
      model,
      ModelAction.Update,
      { singularName: singularName },
    );

    if (regenerate) {
      buttons.push(regenerate);
    }

    const toggle: CardButtonSchema | null = PermissionGate.gateCardButton(
      {
        title: status.isEnabled ? "Disable" : "Enable",
        icon: status.isEnabled ? IconProp.BellSlash : IconProp.Bell,
        buttonStyle: ButtonStyleType.OUTLINE,
        disabled: isBusy,
        onClick: () => {
          setEnabled(!status.isEnabled).catch(() => {
            // setEnabled routes every failure into the error state.
          });
        },
      },
      model,
      ModelAction.Update,
      { singularName: singularName },
    );

    if (toggle) {
      buttons.push(toggle);
    }
  }

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
    body = (
      <ErrorMessage
        message={error || "Could not load the shared calendar link."}
      />
    );
  } else if (!status.exists) {
    let publishControl: ReactElement;

    if (createGate.isAllowed) {
      publishControl = (
        <Button
          title={
            translateString("Publish shared link") || "Publish shared link"
          }
          icon={IconProp.Link}
          buttonStyle={ButtonStyleType.PRIMARY}
          isLoading={isBusy}
          dataTestId={`${idPrefix}-publish`}
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
      <div className="space-y-3" data-testid={`${idPrefix}-empty`}>
        {error && <ErrorMessage message={error} />}
        <div className="text-sm text-gray-600">
          {translateString(
            isSchedule
              ? "No shared link has been published for this schedule yet. Once published, anyone with the link sees everyone's shifts on it - handy for a team calendar."
              : "No project-wide link has been published yet. Once published, anyone with the link sees every shift on every schedule in this project.",
          )}
        </div>
        {publishControl}
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
                "The stored link can no longer be read, usually because the server's encryption secret changed. Subscribers keep working, but the link cannot be shown until an editor regenerates it.",
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

        <FeedStatusLine
          status={status}
          now={props.now}
          showRotatedAgo={true}
          idPrefix={idPrefix}
        />

        {status.previousTokenExpiresAt && (
          <div
            className="text-sm text-gray-500"
            data-testid={`${idPrefix}-previous-link`}
          >
            {translateString("The previous link keeps working until")}{" "}
            {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              OneUptimeDate.fromString(status.previousTokenExpiresAt),
            )}
            .
          </div>
        )}

        <div
          className="text-sm text-gray-500"
          data-testid={`${idPrefix}-ownership`}
        >
          {translateString(SHARED_LINK_OWNERSHIP_COPY)}
        </div>

        {isSchedule && isLegacyTimezone && (
          <Alert
            type={AlertType.WARNING}
            dataTestId={`${idPrefix}-timezone-warning`}
            title={
              translateString(
                "This schedule has no timezone, so shift times in the calendar description are shown in UTC. Set a timezone on the schedule to fix this.",
              ) || ""
            }
          />
        )}
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
        buttons={buttons}
      >
        {body}
      </Card>

      {status && status.exists && status.feedId && (
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
            load().catch(() => {
              // load routes every failure into the error state.
            });
          }}
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
