import AppLink from "../AppLink/AppLink";
import UserElement from "../User/User";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SecurityCasePriorityPill,
  SecurityCaseStatusPill,
  SecurityCaseVerdictPill,
  getSecurityDetectionSourceIcon,
} from "./SecurityCasePills";
import SecurityCaseStatusStepper from "./SecurityCaseStatusStepper";
import { SecurityCaseValueLists } from "./SecurityCaseValues";
import {
  SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME,
  SECURITY_CASE_HEADER_BUTTON_CLASS_NAME,
  SECURITY_CASE_HEADER_CHIPS_CLASS_NAME,
  SECURITY_CASE_HEADER_CLASS_NAME,
  SECURITY_CASE_HEADER_LOCKED_WRAPPER_CLASS_NAME,
  SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME,
  SECURITY_CASE_HEADER_MORE_TRIGGER_CLASS_NAME,
  SECURITY_CASE_HEADER_NEUTRAL_BUTTON_CLASS_NAME,
  SECURITY_CASE_HEADER_PRIMARY_BUTTON_CLASS_NAME,
  SECURITY_CASE_HEADER_TITLE_BLOCK_CLASS_NAME,
  SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME,
  SECURITY_CASE_HEADER_TEST_IDS,
  SecurityCaseHeaderLayout,
} from "./SecurityCaseHeaderLayout";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import { isArchivedValue } from "Common/Utils/ArchivableValues";
import SecurityCasePriorities from "Common/Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import Icon from "Common/UI/Components/Icon/Icon";
import LabelsElement from "Common/UI/Components/Label/Labels";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuSection from "Common/UI/Components/MoreMenu/MoreMenuSection";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  securityCase: SecurityCase;
  // The project's case priorities and statuses (Security Events > Settings).
  values: SecurityCaseValueLists;
  /*
   * "full" on the case's Overview: everything that says what the case is
   * and where it stands. "compact" on every other page of the case: its
   * number, priority, status and title, and the same actions, so a case is
   * worked from any of its pages without the Overview's whole top above
   * each one.
   */
  layout?: SecurityCaseHeaderLayout | undefined;
  isWorking: boolean;
  onAssignToMe: () => void;
  onChangeStatus: (status: SecurityCaseStatus) => void;
  onChangePriority: (priority: SecurityCasePriority) => void;
  onRunPlaybook: () => void;
  onDeclareIncident: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const MetaItem: FunctionComponent<{
  label: string;
  children: ReactElement | string;
}> = (props: {
  label: string;
  children: ReactElement | string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(props.label)}
      </dt>
      {/* A value wraps rather than being cut short: "Oct 14 2026, 08:48 GMT". */}
      <dd className="mt-1 break-words text-sm text-gray-900">
        {props.children}
      </dd>
    </div>
  );
};

interface HeaderAction {
  title: string;
  icon: IconProp;
  isPrimary?: boolean | undefined;
  isDisabled: boolean;
  // Why it is locked, for who may not press it; undefined when it is not.
  tooltip?: string | undefined;
  dataTestId: string;
  onClick: () => void;
}

/*
 * One of the header's actions, drawn as an incident's header draws its own
 * (EventStatusPanel): the same height, border and weight, the main move in
 * indigo. A locked one says why on hover and on focus, from a wrapper that
 * can take both - a disabled button can take neither.
 */
const HeaderActionButton: FunctionComponent<{
  action: HeaderAction;
}> = (props: { action: HeaderAction }): ReactElement => {
  const translator: Translator = useTranslator();
  const action: HeaderAction = props.action;
  const title: string = translator.translateText(action.title) || action.title;
  const tooltip: string | undefined = action.tooltip
    ? translator.translateText(action.tooltip) || action.tooltip
    : undefined;
  const hasReachableTooltip: boolean = action.isDisabled && Boolean(tooltip);

  const button: ReactElement = (
    <button
      type="button"
      title={hasReachableTooltip ? undefined : title}
      disabled={action.isDisabled}
      aria-disabled={action.isDisabled}
      data-testid={action.dataTestId}
      onClick={() => {
        if (!action.isDisabled) {
          action.onClick();
        }
      }}
      className={`${SECURITY_CASE_HEADER_BUTTON_CLASS_NAME} ${
        action.isPrimary
          ? SECURITY_CASE_HEADER_PRIMARY_BUTTON_CLASS_NAME
          : SECURITY_CASE_HEADER_NEUTRAL_BUTTON_CLASS_NAME
      }${hasReachableTooltip ? " pointer-events-none w-full" : ""}`}
    >
      <Icon icon={action.icon} className="h-4 w-4 shrink-0" />
      <span className="truncate">{title}</span>
    </button>
  );

  if (!hasReachableTooltip) {
    return button;
  }

  return (
    <Tooltip text={tooltip}>
      <span
        className={SECURITY_CASE_HEADER_LOCKED_WRAPPER_CLASS_NAME}
        tabIndex={0}
        data-testid={`${action.dataTestId}-disabled-wrapper`}
      >
        {button}
      </span>
    </Tooltip>
  );
};

/*
 * The top of a case: what it is, how urgent, where it stands, who has it,
 * and the moves an analyst makes on it - take it, move it along, run a
 * playbook, hand it to incident response. Its priority and status are the
 * project's own: Close Case moves it to the project's closed status, Reopen
 * to its acknowledged one, and the ⋯ sets any priority nobody archived.
 *
 * Every page of the case draws it: in full on the Overview, and compact
 * (number, pills, title and the actions) on the others. The actions sit
 * beside the title when both fit, and under it, at the right, when they do
 * not; on a phone they fill two rows, and the ⋯ sits in the header's
 * top-right corner, where it is on a wide header, rather than alone on a
 * row of its own (SecurityCaseHeaderLayout.ts).
 */
const SecurityCaseHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const securityCase: SecurityCase = props.securityCase;
  const isCompact: boolean = props.layout === "compact";

  const updateGate: PermissionGateResult = PermissionGate.check(
    new SecurityCase(),
    ModelAction.Update,
  );
  const deleteGate: PermissionGateResult = PermissionGate.check(
    new SecurityCase(),
    ModelAction.Delete,
  );

  const { priorities, statuses } = props.values;

  const isMine: boolean =
    Boolean(securityCase.assignedToUserId) &&
    securityCase.assignedToUserId?.toString() === User.getUserId().toString();
  // Closed: its status is the project's closed one, or one after it.
  const isClosed: boolean = SecurityCaseStatuses.isClosed(
    statuses,
    securityCase.securityCaseStatusId,
  );
  const closedStatus: SecurityCaseStatus | null =
    SecurityCaseStatuses.getStatusOfStage(statuses, SecurityCaseStage.Closed);
  const reopenStatus: SecurityCaseStatus | null =
    SecurityCaseStatuses.getStatusOfStage(
      statuses,
      SecurityCaseStage.Acknowledged,
    );
  const priority: SecurityCasePriority | null = SecurityCasePriorities.find(
    priorities,
    securityCase.securityCasePriorityId,
  );
  const status: SecurityCaseStatus | null = SecurityCaseStatuses.find(
    statuses,
    securityCase.securityCaseStatusId,
  );
  const currentPriorityId: string =
    securityCase.securityCasePriorityId?.toString() || "";
  // The priorities it can be set to: every one nobody archived, its own ticked.
  const pickablePriorities: Array<SecurityCasePriority> =
    SecurityCasePriorities.sort(priorities).filter(
      (candidate: SecurityCasePriority): boolean => {
        return !isArchivedValue(candidate);
      },
    );

  const disabledTooltip: string | undefined = updateGate.isAllowed
    ? undefined
    : updateGate.disabledReason;
  const isUpdateLocked: boolean = !updateGate.isAllowed || props.isWorking;

  const actions: Array<HeaderAction> = [];

  if (!isMine && !isClosed) {
    actions.push({
      title: "Assign to Me",
      icon: IconProp.User,
      isDisabled: isUpdateLocked,
      tooltip: disabledTooltip,
      dataTestId: SECURITY_CASE_HEADER_TEST_IDS.assignToMe,
      onClick: props.onAssignToMe,
    });
  }

  actions.push({
    title: "Run Playbook",
    icon: IconProp.Play,
    isDisabled: props.isWorking,
    dataTestId: SECURITY_CASE_HEADER_TEST_IDS.runPlaybook,
    onClick: props.onRunPlaybook,
  });

  if (!securityCase.incidentId) {
    actions.push({
      title: "Declare Incident",
      icon: IconProp.Alert,
      isDisabled: isUpdateLocked,
      tooltip: disabledTooltip,
      dataTestId: SECURITY_CASE_HEADER_TEST_IDS.declareIncident,
      onClick: props.onDeclareIncident,
    });
  }

  if (!isClosed && closedStatus) {
    actions.push({
      title: "Close Case",
      icon: IconProp.CheckCircle,
      isPrimary: true,
      isDisabled: isUpdateLocked,
      tooltip: disabledTooltip,
      dataTestId: SECURITY_CASE_HEADER_TEST_IDS.close,
      onClick: () => {
        props.onChangeStatus(closedStatus);
      },
    });
  }

  if (isClosed && reopenStatus) {
    actions.push({
      title: "Reopen",
      icon: IconProp.Refresh,
      isDisabled: isUpdateLocked,
      tooltip: disabledTooltip,
      dataTestId: SECURITY_CASE_HEADER_TEST_IDS.reopen,
      onClick: () => {
        props.onChangeStatus(reopenStatus);
      },
    });
  }

  const moreMenu: ReactElement = (
    <MoreMenu
      ariaLabel={translator.translateText("More case actions")}
      dataTestId={SECURITY_CASE_HEADER_TEST_IDS.more}
      elementToBeShownInsteadOfButton={
        <Icon icon={IconProp.EllipsisHorizontal} className="h-4 w-4" />
      }
      triggerClassName={SECURITY_CASE_HEADER_MORE_TRIGGER_CLASS_NAME}
      /*
       * Drawn over the page, not inside the header: the header is a size
       * container, and a menu inside it would sit under the cards after it.
       */
      isMenuPortaled={true}
    >
      {[
        ...(pickablePriorities.length > 0
          ? [
              <MoreMenuSection key="priority" title="Set priority">
                {pickablePriorities.map(
                  (candidate: SecurityCasePriority): ReactElement => {
                    const name: string = candidate.name || "";
                    const isCurrent: boolean =
                      candidate.id?.toString() === currentPriorityId;

                    return (
                      <MoreMenuItem
                        key={`priority-${candidate.id?.toString() || name}`}
                        text={translator.translateText(name) || name}
                        color={candidate.color}
                        isChecked={isCurrent}
                        rightElement={
                          isCurrent ? (
                            <Icon
                              icon={IconProp.Check}
                              className="h-4 w-4 text-indigo-600"
                            />
                          ) : undefined
                        }
                        isDisabled={!updateGate.isAllowed}
                        tooltip={disabledTooltip}
                        dataTestId={
                          SECURITY_CASE_HEADER_TEST_IDS.priorityOption
                        }
                        onClick={() => {
                          if (!isCurrent) {
                            props.onChangePriority(candidate);
                          }
                        }}
                      />
                    );
                  },
                )}
              </MoreMenuSection>,
            ]
          : []),
        <MoreMenuItem
          key="edit"
          icon={IconProp.Edit}
          text="Edit Case"
          isDisabled={!updateGate.isAllowed}
          tooltip={disabledTooltip}
          dataTestId={SECURITY_CASE_HEADER_TEST_IDS.edit}
          onClick={props.onEdit}
        />,
        <MoreMenuItem
          key="delete"
          icon={IconProp.Trash}
          text="Delete Case"
          isDestructive={true}
          isDisabled={!deleteGate.isAllowed}
          tooltip={deleteGate.isAllowed ? undefined : deleteGate.disabledReason}
          dataTestId={SECURITY_CASE_HEADER_TEST_IDS.delete}
          onClick={props.onDelete}
        />,
      ]}
    </MoreMenu>
  );

  return (
    <section
      className={SECURITY_CASE_HEADER_CLASS_NAME}
      data-testid={SECURITY_CASE_HEADER_TEST_IDS.header}
      data-layout={isCompact ? "compact" : "full"}
    >
      <div className="px-4 py-4 sm:px-5">
        <div className={SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME}>
          <div className={SECURITY_CASE_HEADER_TITLE_BLOCK_CLASS_NAME}>
            <div className={SECURITY_CASE_HEADER_CHIPS_CLASS_NAME}>
              <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-700">
                {securityCase.caseNumberWithPrefix || ""}
              </span>
              <SecurityCasePriorityPill value={priority} />
              <SecurityCaseStatusPill value={status} />
              {isClosed && securityCase.verdict ? (
                <SecurityCaseVerdictPill value={securityCase.verdict} />
              ) : (
                <></>
              )}
              {securityCase.incidentId ? (
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.INCIDENT_VIEW] as Route,
                    {
                      modelId: new ObjectID(securityCase.incidentId.toString()),
                    },
                  )}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                  <Icon icon={IconProp.Alert} className="h-3.5 w-3.5" />
                  <span>
                    {securityCase.incident?.incidentNumberWithPrefix
                      ? translator.translateTemplate("Incident {{number}}", {
                          number:
                            securityCase.incident.incidentNumberWithPrefix,
                        })
                      : translator.translateText("View Incident")}
                  </span>
                </AppLink>
              ) : (
                <></>
              )}
            </div>
            <h1
              className="mt-2 break-words text-xl font-semibold text-gray-900"
              data-testid={SECURITY_CASE_HEADER_TEST_IDS.title}
            >
              {securityCase.title || ""}
            </h1>
          </div>

          <div
            role="group"
            aria-label={translator.translateText("Case actions")}
            className={SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME}
            data-testid={SECURITY_CASE_HEADER_TEST_IDS.actions}
          >
            {actions.map((action: HeaderAction): ReactElement => {
              return (
                <HeaderActionButton key={action.dataTestId} action={action} />
              );
            })}
            <div
              className={SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME}
              data-testid={SECURITY_CASE_HEADER_TEST_IDS.morePlace}
            >
              {moreMenu}
            </div>
          </div>
        </div>

        {!isCompact && securityCase.description ? (
          <div className="prose prose-sm mt-3 max-w-none text-gray-600">
            <LazyMarkdownViewer text={securityCase.description} />
          </div>
        ) : (
          <></>
        )}
        {!isCompact && securityCase.labels && securityCase.labels.length > 0 ? (
          <div className="mt-3">
            <LabelsElement labels={securityCase.labels} />
          </div>
        ) : (
          <></>
        )}
      </div>

      {isCompact ? (
        <></>
      ) : (
        <>
          <div className="border-t border-gray-100 px-4 py-4 sm:px-5">
            <SecurityCaseStatusStepper
              statuses={statuses}
              statusId={securityCase.securityCaseStatusId}
              isDisabled={isUpdateLocked}
              disabledReason={disabledTooltip}
              onSelect={props.onChangeStatus}
            />
          </div>

          <dl className="grid grid-cols-2 gap-4 border-t border-gray-100 px-4 py-4 sm:grid-cols-3 sm:px-5 lg:grid-cols-5">
            <MetaItem label="Assignee">
              {securityCase.assignedToUser ? (
                <UserElement
                  user={securityCase.assignedToUser}
                  hideEmail={true}
                />
              ) : (
                <span className="text-gray-400">
                  {translator.translateText("Unassigned")}
                </span>
              )}
            </MetaItem>
            <MetaItem label="Team">
              {securityCase.assignedToTeam?.name ? (
                <span className="inline-flex items-center gap-1.5">
                  <Icon
                    icon={IconProp.UserGroup}
                    className="h-4 w-4 text-gray-400"
                  />
                  {securityCase.assignedToTeam.name}
                </span>
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </MetaItem>
            <MetaItem label="Opened By">
              <span className="inline-flex items-center gap-1.5">
                <Icon
                  icon={getSecurityDetectionSourceIcon(securityCase.source)}
                  className="h-4 w-4 text-gray-400"
                />
                {securityCase.source
                  ? translator.translateText(securityCase.source)
                  : "-"}
              </span>
            </MetaItem>
            <MetaItem label="Opened">
              {securityCase.createdAt
                ? OneUptimeDate.getDateAsLocalFormattedString(
                    securityCase.createdAt,
                  )
                : "-"}
            </MetaItem>
            <MetaItem label="Last Detection">
              {securityCase.lastDetectedAt
                ? OneUptimeDate.fromNow(securityCase.lastDetectedAt)
                : "-"}
            </MetaItem>
          </dl>

          {isClosed && securityCase.closingNote ? (
            <div className="border-t border-gray-100 px-4 py-4 sm:px-5">
              <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {translator.translateText("Closing Note")}
              </h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                {securityCase.closingNote}
              </p>
            </div>
          ) : (
            <></>
          )}
        </>
      )}
    </section>
  );
};

export default SecurityCaseHeader;
