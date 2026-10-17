import CalendarFeedLinks from "../OnCallPolicy/CalendarFeedLinks";
import CalendarFeedAPI from "../OnCallPolicy/CalendarFeed/CalendarFeedAPI";
import MaintenanceCalendarFeedAPI, {
  MaintenanceCalendarFeedRead,
} from "./MaintenanceCalendarFeedAPI";
import { FEED_PANEL_BUTTON_CLASS_NAME } from "../OnCallPolicy/CalendarFeed/CalendarFeedLayout";
import { FeedStatus } from "../OnCallPolicy/CalendarFeed/CalendarFeedTypes";
import {
  REGENERATE_WARNING_COPY,
  SHARED_NEEDS_REGENERATION_COPY,
  SHARED_PREVIOUS_LINK_COPY,
} from "../OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import FeedDeploymentWarnings from "../OnCallPolicy/CalendarFeed/FeedDeploymentWarnings";
import FeedEmptyState from "../OnCallPolicy/CalendarFeed/FeedEmptyState";
import {
  FeedManageAction,
  getFeedManageMenuButtons,
} from "../OnCallPolicy/CalendarFeed/FeedManageMenu";
import FeedStatusPanel from "../OnCallPolicy/CalendarFeed/FeedStatusPanel";
import ScheduledMaintenanceCalendarFeed from "Common/Models/DatabaseModels/ScheduledMaintenanceCalendarFeed";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Subscribe to calendar on Scheduled Maintenance > Events: the team's
 * calendar link for scheduled maintenance, in a dialog.
 *
 * The link is the project's, like the on-call shared links, and the dialog is
 * built from the same pieces (OnCallPolicy/CalendarFeed): the subscribe
 * options - Google Calendar, Apple Calendar / Outlook, or the link to copy -
 * whether an app has read it, and in the header's ⋯ what is done rarely:
 * Regenerate link, Disable link - the on-call links' words, and the ones
 * the Status panel answers with (Disabled, Enable link). A project with no
 * link yet shows what one is, and Publish link to whoever may create
 * maintenance events.
 *
 * Who may see it: whoever reads every maintenance event of the project - the
 * link shows them all. The server refuses anyone else with a sentence saying
 * why (ScheduledMaintenanceCalendarAPI), which the dialog shows as it is.
 */
export const TEAM_FEED_CURRENT_PATH: string =
  "/scheduled-maintenance-calendar/project-feed/current";
export const TEAM_FEED_PUBLISH_PATH: string =
  "/scheduled-maintenance-calendar/project-feed/publish";
export const TEAM_FEED_ROTATE_PATH: string =
  "/scheduled-maintenance-calendar/project-feed/rotate";

export const MAINTENANCE_CALENDAR_DOCS_PATH: string =
  "/scheduled-maintenance/calendar";

export const MAINTENANCE_CALENDAR_REFRESH_CADENCE_COPY: string = translationKey(
  "Google Calendar refreshes subscribed calendars on its own schedule, every few hours (sometimes only once a day), so a change to an event takes a while to show up there.",
);

export const MAINTENANCE_LINK_OWNERSHIP_COPY: string = translationKey(
  "Anyone with this link sees every scheduled maintenance event in this project. It belongs to the project: treat it like a password, and regenerate it if it is shared by mistake.",
);

const ID_PREFIX: string = "maintenance-calendar-feed";

export interface ComponentProps {
  onClose: () => void;
  // Injected by tests; the dialog passes nothing and gets the real clock.
  now?: Date | undefined;
}

interface LoadOptions {
  // Keep what the dialog shows while it reads again after an action.
  keepContent?: boolean | undefined;
}

const MaintenanceCalendarSubscribeModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  /*
   * Why the link is not this reader's to see: the server's sentence, for a
   * reader held to some of the project's events. Not an error to try again,
   * so it is said plainly, without Try again.
   */
  const [restrictedMessage, setRestrictedMessage] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [isUnsupported, setIsUnsupported] = useState<boolean>(false);
  const [status, setStatus] = useState<FeedStatus | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] =
    useState<boolean>(false);

  const model: ScheduledMaintenanceCalendarFeed =
    new ScheduledMaintenanceCalendarFeed();

  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
    { singularName: "maintenance calendar link" },
  );

  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
    { singularName: "maintenance calendar link" },
  );

  const load: (options?: LoadOptions) => Promise<void> = async (
    options?: LoadOptions,
  ): Promise<void> => {
    if (!options?.keepContent) {
      setIsLoading(true);
    }

    setLoadError("");
    setRestrictedMessage("");

    try {
      const result: MaintenanceCalendarFeedRead =
        await MaintenanceCalendarFeedAPI.getStatus(TEAM_FEED_CURRENT_PATH);

      setIsUnsupported(result.isUnsupported);
      setRestrictedMessage(result.refusedReason || "");
      setStatus(result.status);
    } catch (err) {
      setLoadError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {
      // load routes every failure into the error state.
    });
  }, []);

  const postAction: (path: string) => Promise<void> = async (
    path: string,
  ): Promise<void> => {
    setIsBusy(true);
    setActionError("");

    try {
      setStatus(await CalendarFeedAPI.postFeedAction(path));
      setShowRegenerateConfirm(false);
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
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
    setActionError("");

    try {
      await ModelAPI.updateById<ScheduledMaintenanceCalendarFeed>({
        modelType: ScheduledMaintenanceCalendarFeed,
        id: new ObjectID(status.feedId),
        data: {
          isEnabled: isEnabled,
        },
      });
      await load({ keepContent: true });
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsBusy(false);
    }
  };

  /*
   * The ⋯ in the dialog's header: Regenerate link and Disable / Enable
   * link, locked with the permission they need for a reader who may only
   * copy the link.
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
      dataTestId: `${ID_PREFIX}-regenerate`,
      onClick: () => {
        setActionError("");
        setShowRegenerateConfirm(true);
      },
    });

    manageActions.push({
      key: "toggle",
      text: status.isEnabled ? "Disable link" : "Enable link",
      icon: status.isEnabled ? IconProp.BellSlash : IconProp.Bell,
      isDisabled: isBusy,
      disabledReason: lockedReason,
      dataTestId: `${ID_PREFIX}-toggle`,
      onClick: () => {
        setEnabled(!status.isEnabled).catch(() => {
          // setEnabled routes every failure into the error state.
        });
      },
    });
  }

  const manageMenu: Array<ReactElement> = getFeedManageMenuButtons({
    actions: manageActions,
    idPrefix: ID_PREFIX,
  });

  const actionErrorAlert: ReactElement | null =
    actionError && !showRegenerateConfirm ? (
      <Alert
        type={AlertType.DANGER}
        title={actionError}
        dataTestId={`${ID_PREFIX}-error`}
      />
    ) : null;

  let body: ReactElement;

  if (isLoading) {
    body = <ComponentLoader />;
  } else if (restrictedMessage) {
    body = (
      <Alert
        type={AlertType.INFO}
        title={restrictedMessage}
        dataTestId={`${ID_PREFIX}-restricted`}
      />
    );
  } else if (isUnsupported) {
    body = (
      <Alert
        type={AlertType.INFO}
        dataTestId={`${ID_PREFIX}-unsupported`}
        title={
          translator.translateText(
            "This server does not offer calendar links for scheduled maintenance yet. Ask whoever runs it to upgrade OneUptime.",
          ) || ""
        }
      />
    );
  } else if (!status) {
    body = (
      <Alert
        type={AlertType.DANGER}
        strongTitle={
          translator.translateText("Could not load the calendar link.") || ""
        }
        title={loadError}
        textOnRight={translator.translateText("Try again") || ""}
        dataTestId={`${ID_PREFIX}-load-error`}
        onClick={() => {
          load().catch(() => {
            // load routes every failure into the error state.
          });
        }}
      />
    );
  } else if (!status.exists) {
    let publishControl: ReactElement;

    if (createGate.isAllowed) {
      publishControl = (
        <Button
          title="Publish link"
          icon={IconProp.Link}
          buttonStyle={ButtonStyleType.PRIMARY}
          isLoading={isBusy}
          dataTestId={`${ID_PREFIX}-publish`}
          className={FEED_PANEL_BUTTON_CLASS_NAME}
          onClick={() => {
            postAction(TEAM_FEED_PUBLISH_PATH).catch(() => {
              // postAction routes every failure into the error state.
            });
          }}
        />
      );
    } else if (createGate.disabledReason) {
      publishControl = (
        <Button
          title="Publish link"
          icon={IconProp.Link}
          buttonStyle={ButtonStyleType.PRIMARY}
          disabled={true}
          tooltip={createGate.disabledReason}
          dataTestId={`${ID_PREFIX}-publish`}
          className={FEED_PANEL_BUTTON_CLASS_NAME}
          onClick={() => {
            // Locked. The tooltip says which permission is missing.
          }}
        />
      );
    } else {
      publishControl = (
        <p
          className="text-sm text-gray-500"
          data-testid={`${ID_PREFIX}-ask-editor`}
        >
          {translator.translateText(
            "Ask someone who can create maintenance events to publish it.",
          )}
        </p>
      );
    }

    body = (
      <div className="space-y-4" data-testid={`${ID_PREFIX}-empty`}>
        {actionErrorAlert}
        <FeedDeploymentWarnings
          hostWarning={status.hostWarning}
          protocolWarning={status.protocolWarning}
          privateHost={status.privateHost}
          idPrefix={ID_PREFIX}
        />
        <FeedEmptyState
          idPrefix={ID_PREFIX}
          icon={IconProp.Calendar}
          title="No calendar link yet"
          description="Publish one link for your team. Anyone with it sees every scheduled maintenance event in this project, in their own calendar app, kept up to date."
          control={publishControl}
        />
      </div>
    );
  } else {
    const hasLink: boolean = Boolean(status.urls && !status.needsRegeneration);

    body = (
      <div className="space-y-6" data-testid={`${ID_PREFIX}-active`}>
        {actionErrorAlert ||
        status.hostWarning ||
        status.protocolWarning ||
        status.privateHost ? (
          <div className="space-y-4" data-testid={`${ID_PREFIX}-notices`}>
            {actionErrorAlert}
            <FeedDeploymentWarnings
              hostWarning={status.hostWarning}
              protocolWarning={status.protocolWarning}
              privateHost={status.privateHost}
              idPrefix={ID_PREFIX}
            />
          </div>
        ) : (
          <></>
        )}

        {hasLink && status.urls ? (
          <CalendarFeedLinks
            urls={status.urls}
            tokenHint={status.tokenHint}
            idPrefix={ID_PREFIX}
            isAlone={true}
          />
        ) : (
          <></>
        )}

        <FeedStatusPanel
          status={status}
          now={props.now}
          showRotatedAgo={true}
          idPrefix={ID_PREFIX}
          previousLinkCopy={SHARED_PREVIOUS_LINK_COPY}
          needsRegenerationCopy={SHARED_NEEDS_REGENERATION_COPY}
          docsPath={MAINTENANCE_CALENDAR_DOCS_PATH}
          refreshCadenceCopy={MAINTENANCE_CALENDAR_REFRESH_CADENCE_COPY}
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
                  setActionError("");
                  setShowRegenerateConfirm(true);
                }
              : undefined
          }
        />

        <div
          className="flex items-start gap-2 text-xs leading-5 text-gray-500"
          data-testid={`${ID_PREFIX}-ownership`}
        >
          <Icon
            icon={IconProp.Lock}
            className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400"
          />
          <span className="min-w-0 text-pretty">
            {translator.translateText(MAINTENANCE_LINK_OWNERSHIP_COPY)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <Fragment>
      <Modal
        title="Subscribe to scheduled maintenance"
        description="Every scheduled maintenance event in this project, in Google Calendar, Outlook or Apple Calendar. It keeps itself up to date."
        modalWidth={ModalWidth.Medium}
        onClose={props.onClose}
        closeButtonText="Done"
        rightElement={
          manageMenu.length > 0 ? <Fragment>{manageMenu}</Fragment> : undefined
        }
      >
        <div data-testid={`${ID_PREFIX}-dialog`}>{body}</div>
      </Modal>

      {showRegenerateConfirm && (
        <ConfirmModal
          title="Regenerate calendar link?"
          description={translator.translateText(REGENERATE_WARNING_COPY) || ""}
          submitButtonText="Regenerate link"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isBusy}
          error={actionError || undefined}
          onClose={() => {
            setShowRegenerateConfirm(false);
            setActionError("");
          }}
          onSubmit={() => {
            postAction(TEAM_FEED_ROTATE_PATH).catch(() => {
              // postAction routes every failure into the error state.
            });
          }}
        />
      )}
    </Fragment>
  );
};

export default MaintenanceCalendarSubscribeModal;
