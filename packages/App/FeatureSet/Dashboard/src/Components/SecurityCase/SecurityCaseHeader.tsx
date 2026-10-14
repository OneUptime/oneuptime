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
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityCasePriority, {
  SECURITY_CASE_PRIORITIES,
} from "Common/Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus from "Common/Types/SecurityCase/SecurityCaseStatus";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import LabelsElement from "Common/UI/Components/Label/Labels";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
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
      <dd className="mt-1 truncate text-sm text-gray-900">{props.children}</dd>
    </div>
  );
};

/*
 * The top of a case: what it is, how urgent, where it stands, who has it,
 * and the moves an analyst makes on it - take it, move it along, run a
 * playbook, hand it to incident response.
 */
const SecurityCaseHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const securityCase: SecurityCase = props.securityCase;

  const updateGate: PermissionGateResult = PermissionGate.check(
    new SecurityCase(),
    ModelAction.Update,
  );
  const deleteGate: PermissionGateResult = PermissionGate.check(
    new SecurityCase(),
    ModelAction.Delete,
  );

  const isMine: boolean =
    Boolean(securityCase.assignedToUserId) &&
    securityCase.assignedToUserId?.toString() === User.getUserId().toString();
  const isClosed: boolean = securityCase.status === SecurityCaseStatus.Closed;

  const disabledTooltip: string | undefined = updateGate.isAllowed
    ? undefined
    : updateGate.disabledReason;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-700">
              {securityCase.caseNumberWithPrefix || ""}
            </span>
            <SecurityCasePriorityPill value={securityCase.priority} />
            <SecurityCaseStatusPill value={securityCase.status} />
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
                        number: securityCase.incident.incidentNumberWithPrefix,
                      })
                    : translator.translateText("View Incident")}
                </span>
              </AppLink>
            ) : (
              <></>
            )}
          </div>
          <h1 className="mt-2 break-words text-xl font-semibold text-gray-900">
            {securityCase.title || ""}
          </h1>
          {securityCase.description ? (
            <div className="prose prose-sm mt-2 max-w-none text-gray-600">
              <LazyMarkdownViewer text={securityCase.description} />
            </div>
          ) : (
            <></>
          )}
          {securityCase.labels && securityCase.labels.length > 0 ? (
            <div className="mt-3">
              <LabelsElement labels={securityCase.labels} />
            </div>
          ) : (
            <></>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 self-end lg:self-auto">
          {!isMine && !isClosed ? (
            <Button
              title="Assign to Me"
              icon={IconProp.User}
              buttonStyle={ButtonStyleType.NORMAL}
              disabled={!updateGate.isAllowed || props.isWorking}
              tooltip={disabledTooltip}
              dataTestId="security-case-assign-to-me"
              onClick={props.onAssignToMe}
            />
          ) : (
            <></>
          )}
          <Button
            title="Run Playbook"
            icon={IconProp.Play}
            buttonStyle={ButtonStyleType.NORMAL}
            disabled={props.isWorking}
            dataTestId="security-case-run-playbook"
            onClick={props.onRunPlaybook}
          />
          {!securityCase.incidentId ? (
            <Button
              title="Declare Incident"
              icon={IconProp.Alert}
              buttonStyle={ButtonStyleType.NORMAL}
              disabled={!updateGate.isAllowed || props.isWorking}
              tooltip={disabledTooltip}
              dataTestId="security-case-declare-incident"
              onClick={props.onDeclareIncident}
            />
          ) : (
            <></>
          )}
          {!isClosed ? (
            <Button
              title="Close Case"
              icon={IconProp.CheckCircle}
              buttonStyle={ButtonStyleType.PRIMARY}
              disabled={!updateGate.isAllowed || props.isWorking}
              tooltip={disabledTooltip}
              dataTestId="security-case-close"
              onClick={() => {
                props.onChangeStatus(SecurityCaseStatus.Closed);
              }}
            />
          ) : (
            <Button
              title="Reopen"
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.NORMAL}
              disabled={!updateGate.isAllowed || props.isWorking}
              tooltip={disabledTooltip}
              dataTestId="security-case-reopen"
              onClick={() => {
                props.onChangeStatus(SecurityCaseStatus.Investigating);
              }}
            />
          )}
          <MoreMenu
            ariaLabel={translator.translateText("More case actions")}
            dataTestId="security-case-more"
          >
            {[
              ...SECURITY_CASE_PRIORITIES.filter(
                (priority: SecurityCasePriority): boolean => {
                  return priority !== securityCase.priority;
                },
              ).map((priority: SecurityCasePriority): ReactElement => {
                return (
                  <MoreMenuItem
                    key={`priority-${priority}`}
                    icon={IconProp.Signal}
                    text={translator.translateTemplate(
                      "Set Priority: {{priority}}",
                      {
                        priority:
                          translator.translateText(priority) || priority,
                      },
                    )}
                    isDisabled={!updateGate.isAllowed}
                    tooltip={disabledTooltip}
                    onClick={() => {
                      props.onChangePriority(priority);
                    }}
                  />
                );
              }),
              <MoreMenuItem
                key="edit"
                icon={IconProp.Edit}
                text="Edit Case"
                isDisabled={!updateGate.isAllowed}
                tooltip={disabledTooltip}
                onClick={props.onEdit}
              />,
              <MoreMenuItem
                key="delete"
                icon={IconProp.Trash}
                text="Delete Case"
                isDestructive={true}
                isDisabled={!deleteGate.isAllowed}
                tooltip={
                  deleteGate.isAllowed ? undefined : deleteGate.disabledReason
                }
                onClick={props.onDelete}
              />,
            ]}
          </MoreMenu>
        </div>
      </div>

      <div className="border-t border-gray-100 px-5 py-4">
        <SecurityCaseStatusStepper
          status={securityCase.status}
          isDisabled={!updateGate.isAllowed || props.isWorking}
          disabledReason={disabledTooltip}
          onSelect={props.onChangeStatus}
        />
      </div>

      <dl className="grid grid-cols-2 gap-4 border-t border-gray-100 px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetaItem label="Assignee">
          {securityCase.assignedToUser ? (
            <UserElement user={securityCase.assignedToUser} hideEmail={true} />
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
        <div className="border-t border-gray-100 px-5 py-4">
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
    </div>
  );
};

export default SecurityCaseHeader;
