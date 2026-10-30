import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import {
  ExceptionTriageAction,
  ExceptionTriageState,
  getExceptionTriageActions,
  getResolveInNextReleaseAction,
} from "../../Utils/ExceptionDetailPresentation";

export type ExceptionTriageActionId = ExceptionTriageAction["id"];

export interface ComponentProps extends ExceptionTriageState {
  // The action whose request is in flight, if any.
  pendingActionId?: ExceptionTriageActionId | undefined;
  /*
   * The release the exception was last seen in. With one, Resolve has a
   * menu beside it with Resolve in next release.
   */
  lastSeenInRelease?: string | undefined;
  onAction: (action: ExceptionTriageAction) => void;
}

const ACTION_ICONS: Record<ExceptionTriageActionId, IconProp> = {
  resolve: IconProp.Check,
  "resolve-next-release": IconProp.CheckCircle,
  unresolve: IconProp.Refresh,
  archive: IconProp.Archive,
  unarchive: IconProp.Unarchive,
};

/*
 * Resolve / reopen and archive / unarchive, one click each — both are
 * reversible from the same buttons. A viewer without update permission
 * still sees them, locked, with the missing permission as the tooltip.
 *
 * Resolve has a small menu beside it, while a release is known, with
 * Resolve in next release: most people resolve, and the rarer choice stays
 * one click away without a third button.
 */
const ExceptionTriageActions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const updateGate: PermissionGateResult = useMemo(() => {
    return PermissionGate.check(new TelemetryException(), ModelAction.Update);
  }, []);

  const actions: Array<ExceptionTriageAction> = getExceptionTriageActions({
    isResolved: props.isResolved,
    isArchived: props.isArchived,
  });

  const nextReleaseAction: ExceptionTriageAction | null =
    getResolveInNextReleaseAction({
      isResolved: props.isResolved,
      isArchived: props.isArchived,
      lastSeenInRelease: props.lastSeenInRelease,
    });

  const isLocked: (action: ExceptionTriageAction) => boolean = (
    action: ExceptionTriageAction,
  ): boolean => {
    return (
      !updateGate.isAllowed ||
      (Boolean(props.pendingActionId) && props.pendingActionId !== action.id)
    );
  };

  return (
    <>
      {actions.map((action: ExceptionTriageAction): ReactElement => {
        const isPrimary: boolean = action.id === "resolve";

        const button: ReactElement = (
          <Button
            key={action.id}
            title={action.label}
            icon={ACTION_ICONS[action.id]}
            buttonSize={ButtonSize.Small}
            buttonStyle={
              isPrimary
                ? ButtonStyleType.SUCCESS_OUTLINE
                : ButtonStyleType.NORMAL
            }
            dataTestId={`exception-triage-${action.id}`}
            isLoading={
              props.pendingActionId === action.id ||
              (isPrimary && props.pendingActionId === "resolve-next-release")
            }
            disabled={isLocked(action)}
            tooltip={
              updateGate.isAllowed ? undefined : updateGate.disabledReason
            }
            onClick={() => {
              props.onAction(action);
            }}
          />
        );

        if (!isPrimary || !nextReleaseAction) {
          return button;
        }

        return (
          <div
            key={action.id}
            className="inline-flex items-center gap-1"
            data-testid="exception-triage-resolve-group"
          >
            {button}
            <MoreMenu
              text=""
              ariaLabel={translator.translateText("More ways to resolve")}
              dataTestId="exception-triage-resolve-menu"
              isDisabled={isLocked(nextReleaseAction)}
              isMenuPortaled={true}
              elementToBeShownInsteadOfButton={
                <Icon icon={IconProp.ChevronDown} className="h-4 w-4" />
              }
              triggerClassName="inline-flex h-[30px] items-center rounded-md border border-gray-300 bg-white px-1.5 text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-700"
            >
              {[
                <MoreMenuItem
                  key="resolve-next-release"
                  text={nextReleaseAction.label}
                  icon={ACTION_ICONS["resolve-next-release"]}
                  tooltip={translator.translateTemplate(
                    "Occurrences from {{release}} will not reopen it. One from any other release will.",
                    { release: nextReleaseAction.release || "" },
                  )}
                  isDisabled={isLocked(nextReleaseAction)}
                  dataTestId="exception-triage-resolve-next-release"
                  onClick={() => {
                    props.onAction(nextReleaseAction);
                  }}
                />,
              ]}
            </MoreMenu>
          </div>
        );
      })}
    </>
  );
};

export default ExceptionTriageActions;
