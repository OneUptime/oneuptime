import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  ExceptionTriageAction,
  describeExceptionStatusChange,
} from "../../Utils/ExceptionDetailPresentation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { ExceptionTriageActionId } from "./ExceptionTriageActions";

export interface ComponentProps {
  exception: TelemetryException;
  telemetryExceptionId: ObjectID;
  pendingActionId?: ExceptionTriageActionId | undefined;
  actionError?: string | undefined;
  onDismissActionError: () => void;
  onAction: (action: ExceptionTriageAction) => void;
}

interface StatusRow {
  id: "resolution" | "archive";
  icon: IconProp;
  iconClassName: string;
  title: string;
  stateLabel: string;
  stateClassName: string;
  history: string;
  historyTitle?: string | undefined;
  explanation: string;
  action: ExceptionTriageAction;
  buttonLabel: string;
  buttonIcon: IconProp;
  buttonStyle: ButtonStyleType;
}

function getUserName(
  user: TelemetryException["markedAsResolvedByUser"],
): string | undefined {
  return user?.name?.toString() || user?.email?.toString() || undefined;
}

const ExceptionSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isResolved: boolean = Boolean(props.exception.isResolved);
  const isArchived: boolean = Boolean(props.exception.isArchived);

  const updateGate: PermissionGateResult = useMemo(() => {
    return PermissionGate.check(new TelemetryException(), ModelAction.Update);
  }, []);

  const rows: Array<StatusRow> = [
    {
      id: "resolution",
      icon: isResolved ? IconProp.CheckCircle : IconProp.Error,
      iconClassName: isResolved
        ? "bg-emerald-50 text-emerald-600"
        : "bg-red-50 text-red-600",
      title: "Resolution",
      stateLabel: isResolved ? "Resolved" : "Unresolved",
      stateClassName: isResolved
        ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
        : "bg-red-50 text-red-700 ring-red-600/20",
      history: describeExceptionStatusChange({
        isActive: isResolved,
        at: props.exception.markedAsResolvedAt,
        byName: getUserName(props.exception.markedAsResolvedByUser),
        activeVerb: "Resolved",
        inactiveText: "Open and waiting for a fix.",
      }),
      historyTitle: props.exception.markedAsResolvedAt
        ? OneUptimeDate.getDateAsLocalFormattedString(
            props.exception.markedAsResolvedAt,
          )
        : undefined,
      explanation:
        "Resolve an exception once its fix is deployed. If it happens again it is reopened automatically.",
      action: isResolved
        ? {
            id: "unresolve",
            label: "Reopen",
            nextState: { isResolved: false, isArchived },
          }
        : {
            id: "resolve",
            label: "Resolve",
            nextState: { isResolved: true, isArchived },
          },
      buttonLabel: isResolved ? "Mark as Unresolved" : "Mark as Resolved",
      buttonIcon: isResolved ? IconProp.Refresh : IconProp.Check,
      buttonStyle: isResolved
        ? ButtonStyleType.NORMAL
        : ButtonStyleType.SUCCESS_OUTLINE,
    },
    {
      id: "archive",
      icon: IconProp.Archive,
      iconClassName: isArchived
        ? "bg-amber-50 text-amber-600"
        : "bg-gray-100 text-gray-500",
      title: "Archive",
      stateLabel: isArchived ? "Archived" : "Not archived",
      stateClassName: isArchived
        ? "bg-amber-50 text-amber-700 ring-amber-600/20"
        : "bg-gray-50 text-gray-600 ring-gray-500/20",
      history: describeExceptionStatusChange({
        isActive: isArchived,
        at: props.exception.markedAsArchivedAt,
        byName: getUserName(props.exception.markedAsArchivedByUser),
        activeVerb: "Archived",
        inactiveText: "Shown in the exception lists and notifications.",
      }),
      historyTitle: props.exception.markedAsArchivedAt
        ? OneUptimeDate.getDateAsLocalFormattedString(
            props.exception.markedAsArchivedAt,
          )
        : undefined,
      explanation:
        "Archive noise you do not plan to fix. Future occurrences stop notifying and historical data is kept.",
      action: isArchived
        ? {
            id: "unarchive",
            label: "Unarchive",
            nextState: { isResolved, isArchived: false },
          }
        : {
            id: "archive",
            label: "Archive",
            nextState: { isResolved, isArchived: true },
          },
      buttonLabel: isArchived ? "Unarchive" : "Archive",
      buttonIcon: isArchived ? IconProp.Unarchive : IconProp.Archive,
      buttonStyle: ButtonStyleType.NORMAL,
    },
  ];

  return (
    <>
      {props.actionError && (
        <Alert
          type={AlertType.DANGER}
          strongTitle="Action failed"
          title={props.actionError}
          onClose={props.onDismissActionError}
        />
      )}

      <Card
        title="Status"
        description="Where this exception stands in triage, and who last changed it."
      >
        <ul
          className="-mx-5 divide-y divide-gray-100 border-t border-gray-100 md:-mx-6"
          data-testid="exception-settings-status"
        >
          {rows.map((row: StatusRow): ReactElement => {
            return (
              <li
                key={row.id}
                className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center md:px-6"
                data-testid={`exception-settings-row-${row.id}`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <div
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${row.iconClassName}`}
                  >
                    <Icon icon={row.icon} className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">
                        {row.title}
                      </h3>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${row.stateClassName}`}
                        data-testid={`exception-settings-${row.id}-state`}
                      >
                        {row.stateLabel}
                      </span>
                    </div>
                    <p
                      className="mt-1 text-sm text-gray-700"
                      title={row.historyTitle}
                      data-testid={`exception-settings-${row.id}-history`}
                    >
                      {row.history}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {row.explanation}
                    </p>
                  </div>
                </div>
                <div className="flex-shrink-0 sm:pl-4">
                  <Button
                    title={row.buttonLabel}
                    icon={row.buttonIcon}
                    buttonStyle={row.buttonStyle}
                    buttonSize={ButtonSize.Small}
                    dataTestId={`exception-settings-${row.action.id}`}
                    isLoading={props.pendingActionId === row.action.id}
                    disabled={
                      !updateGate.isAllowed ||
                      (Boolean(props.pendingActionId) &&
                        props.pendingActionId !== row.action.id)
                    }
                    tooltip={
                      updateGate.isAllowed ? undefined : updateGate.disabledReason
                    }
                    onClick={() => {
                      props.onAction(row.action);
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <div data-testid="exception-settings-danger-zone">
        <ModelDelete
          modelType={TelemetryException}
          modelId={props.telemetryExceptionId}
          onDeleteSuccess={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(RouteMap[PageMap.EXCEPTIONS] as Route),
            );
          }}
        />
      </div>
    </>
  );
};

export default ExceptionSettings;
