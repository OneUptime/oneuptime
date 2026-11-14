import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  ExceptionTriageAction,
  ExceptionTriageState,
  getResolveInNextReleaseAction,
} from "../../Utils/ExceptionDetailPresentation";
import { getEventHeaderMoreTriggerClassName } from "../EventView/EventHeaderLayout";
import {
  EXCEPTION_TRIAGE_ACTION_ICONS,
  ExceptionTriageActionId,
} from "./ExceptionTriageActions";

export const EXCEPTION_MORE_ACTIONS_TEST_IDS: {
  trigger: string;
  resolveInNextRelease: string;
  createMonitor: string;
} = {
  trigger: "exception-more-actions",
  resolveInNextRelease: "exception-triage-resolve-next-release",
  createMonitor: "exception-create-monitor",
};

export interface ComponentProps extends ExceptionTriageState {
  /*
   * The release the exception was last seen in. With one, and while it is
   * unresolved, the menu offers Resolve in next release.
   */
  lastSeenInRelease?: string | undefined;
  // The triage action whose request is in flight, if any.
  pendingActionId?: ExceptionTriageActionId | undefined;
  onAction: (action: ExceptionTriageAction) => void;
  /*
   * Opens a new Exceptions monitor for this exception's type in its
   * service. Left out - a reader who may not create monitors - the menu
   * does not offer it.
   */
  onCreateMonitor?: (() => void) | undefined;
}

/*
 * What the header's ⋯ holds: the moves an exception takes now and then,
 * kept out of the row of buttons so the header shows two of them and not
 * five.
 *
 *   - Resolve in next release, while it is unresolved and its occurrences
 *     name a release: the fix ships in the release after the one it was
 *     last seen in, so the pods still running that one do not reopen it.
 *   - Create monitor: get alerted when it happens again.
 *
 * With nothing to offer it draws nothing at all, never an empty menu.
 */
export function hasExceptionMoreActions(
  props: Pick<
    ComponentProps,
    "isResolved" | "isArchived" | "lastSeenInRelease" | "onCreateMonitor"
  >,
): boolean {
  return (
    Boolean(
      getResolveInNextReleaseAction({
        isResolved: props.isResolved,
        isArchived: props.isArchived,
        lastSeenInRelease: props.lastSeenInRelease,
      }),
    ) || Boolean(props.onCreateMonitor)
  );
}

const ExceptionMoreActions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const updateGate: PermissionGateResult = useMemo(() => {
    return PermissionGate.check(new TelemetryException(), ModelAction.Update);
  }, []);

  const nextReleaseAction: ExceptionTriageAction | null =
    getResolveInNextReleaseAction({
      isResolved: props.isResolved,
      isArchived: props.isArchived,
      lastSeenInRelease: props.lastSeenInRelease,
    });

  const items: Array<ReactElement> = [];

  if (nextReleaseAction) {
    const isLocked: boolean =
      !updateGate.isAllowed || Boolean(props.pendingActionId);

    items.push(
      <MoreMenuItem
        key="resolve-next-release"
        text={nextReleaseAction.label}
        icon={EXCEPTION_TRIAGE_ACTION_ICONS["resolve-next-release"]}
        tooltip={
          updateGate.isAllowed
            ? translator.translateTemplate(
                "Occurrences from {{release}} will not reopen it. One from any other release will.",
                { release: nextReleaseAction.release || "" },
              )
            : updateGate.disabledReason
        }
        isDisabled={isLocked}
        dataTestId={EXCEPTION_MORE_ACTIONS_TEST_IDS.resolveInNextRelease}
        onClick={() => {
          if (!isLocked) {
            props.onAction(nextReleaseAction);
          }
        }}
      />,
    );
  }

  if (props.onCreateMonitor) {
    const onCreateMonitor: () => void = props.onCreateMonitor;

    items.push(
      <MoreMenuItem
        key="create-monitor"
        text="Create monitor"
        icon={IconProp.Bell}
        tooltip="Get alerted when this exception happens again."
        dataTestId={EXCEPTION_MORE_ACTIONS_TEST_IDS.createMonitor}
        onClick={onCreateMonitor}
      />,
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <MoreMenu
      ariaLabel="More actions"
      dataTestId={EXCEPTION_MORE_ACTIONS_TEST_IDS.trigger}
      elementToBeShownInsteadOfButton={
        <Icon icon={IconProp.EllipsisHorizontal} className="h-4 w-4" />
      }
      triggerClassName={getEventHeaderMoreTriggerClassName(false)}
      /*
       * Drawn over the page, not inside the header: the header is a size
       * container, and a menu inside it would sit under the cards after it.
       */
      isMenuPortaled={true}
    >
      {items}
    </MoreMenu>
  );
};

export default ExceptionMoreActions;
