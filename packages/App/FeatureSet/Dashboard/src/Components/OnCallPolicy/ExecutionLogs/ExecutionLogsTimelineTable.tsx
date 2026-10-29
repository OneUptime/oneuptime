import UserElement from "../../User/User";
import EscalationRule from "../EscalationRule/EscalationRule";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import OnCallDutyExecutionLogTimelineStatus from "Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { isOnCallDirectPage } from "Common/Types/OnCallDutyPolicy/OnCallDirectPage";
import {
  OnCallEmptyLevelLine,
  readOnCallEmptyLevelLine,
} from "Common/Types/OnCallDutyPolicy/OnCallEmptyLevel";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import DirectPageLabel from "Common/UI/Components/OnCallDirectPage/DirectPageLabel";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import { PASS_ON_PAGE_TEXT } from "../PassOn/PassOnPage";
import { withEscalatedStatusLabel } from "../PassOn/PassedOnStatus";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLogTimeline from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement, useState } from "react";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * The card of one run's steps. It is the timeline of an on-call policy's
 * run and of a direct page alike - a direct page has no policy - so neither
 * its title nor its description names a policy.
 */
export const EXECUTION_TIMELINE_TITLE: string =
  translationKey("Execution Timeline");
export const EXECUTION_TIMELINE_DESCRIPTION: string = translationKey(
  "Who was paged, when, and whether they acknowledged. If someone was skipped or a page failed, its status message says why.",
);

/*
 * A direct page names teams, and a team can have nobody in it. Its step
 * names nobody - there was nobody to page - so it says which team that was.
 */
export const TEAM_HAS_NO_MEMBERS_TEMPLATE: string = translationKey(
  "Team {{teamName}} has no members",
);

/*
 * An escalation rule can page the next person in a schedule's rotation - the
 * backup after whoever is on call. Its step's schedule says so, and a step
 * that found nobody next says that, not that nobody was on call.
 */
export const NEXT_IN_ROTATION_LABEL: string =
  translationKey("Next in rotation");
export const NOBODY_NEXT_IN_ROTATION_LABEL: string = translationKey(
  "Nobody was next in the rotation",
);

/*
 * A level that paged nobody writes a line of its own, and the run moves on
 * from it at once rather than waiting out its wait (OnCallEmptyLevel). Its
 * step names nobody: it says why the level paged nobody - it has no
 * responders, or nobody it names could be paged (their own steps above say
 * why) - and that the policy did not wait. A line from before levels were
 * passed at once says only that nobody was paged: that run waited.
 */
export const LEVEL_HAS_NO_RESPONDERS_LABEL: string = translationKey(
  "This level has no responders",
);
export const LEVEL_PAGED_NOBODY_LABEL: string = translationKey(
  "Nobody at this level could be paged",
);
export const MOVED_ON_AT_ONCE_LABEL: string =
  translationKey("Moved on at once");

export interface ComponentProps {
  onCallPolicyExecutionLogId: ObjectID;
}

const ExecutionLogTimelineTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
    useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const getModelTable: GetReactElementFunction = (): ReactElement => {
    return (
      <ModelTable<OnCallDutyPolicyExecutionLogTimeline>
        modelType={OnCallDutyPolicyExecutionLogTimeline}
        userPreferencesKey={"on-call-policy-execution-log-timeline-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          onCallDutyPolicyExecutionLogId:
            props.onCallPolicyExecutionLogId.toString(),
        }}
        id="notification-logs-timeline-table"
        name="On-Call > Execution Logs > Timeline"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        cardProps={{
          title: EXECUTION_TIMELINE_TITLE,
          description: EXECUTION_TIMELINE_DESCRIPTION,
        }}
        selectMoreFields={{
          statusMessage: true,
          // Read with every row: a row with none is a direct page's.
          onCallDutyPolicyId: true,
          /*
           * The schedule this step targeted. Populated by the escalation runner
           * on every schedule step — including the "nobody was on call" skip,
           * which is the one row where it is the whole story. Without it, a
           * coverage-gap skip rendered as `Skipped` / `-` / `-`, indistinguishable
           * from a duplicate-notification skip.
           */
          onCallDutySchedule: {
            _id: true,
            name: true,
          },
          /*
           * Whether the step is about the next person in that schedule's
           * rotation - the backup after whoever is on call - rather than its
           * on-call person.
           */
          isNextInRotation: true,
          /*
           * The team a step is about: the one a direct page named that had
           * no members is the only thing such a step can say.
           */
          userBelongsToTeam: {
            _id: true,
            name: true,
          },
        }}
        noItemsMessage={"No notifications sent out so far."}
        showRefreshButton={true}
        showViewIdButton={true}
        actionButtons={[
          {
            title: "View Status Message",
            icon: IconProp.Error,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: OnCallDutyPolicyExecutionLogTimeline,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setStatusMessage(item["statusMessage"] as string);
                setShowViewStatusMessageModal(true);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        filters={[
          {
            field: {
              onCallDutyPolicyEscalationRule: true,
            },
            type: FieldType.Entity,
            title: "Escalation Rule",
            filterEntityType: OnCallDutyPolicyEscalationRule,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              createdAt: true,
            },
            type: FieldType.Date,
            title: "Started At",
          },
          {
            field: {
              acknowledgedAt: true,
            },
            type: FieldType.Date,
            title: "Acknowledged At",
          },
          {
            field: {
              status: true,
            },
            type: FieldType.Dropdown,
            title: "Status",
            // An escalated line is stored "Passed On" and offered as Escalated.
            filterDropdownOptions: withEscalatedStatusLabel(
              DropdownUtil.getDropdownOptionsFromEnum(
                OnCallDutyExecutionLogTimelineStatus,
              ),
            ),
          },
        ]}
        columns={[
          {
            field: {
              onCallDutyPolicyEscalationRule: {
                name: true,
                onCallDutyPolicyId: true,
              },
            },
            title: "Escalation Rule",
            type: FieldType.Element,
            getElement: (
              item: OnCallDutyPolicyExecutionLogTimeline,
            ): ReactElement => {
              if (item && item["onCallDutyPolicyEscalationRule"]) {
                return (
                  <EscalationRule
                    escalationRule={
                      item[
                        "onCallDutyPolicyEscalationRule"
                      ] as OnCallDutyPolicyEscalationRule
                    }
                  />
                );
              }
              /*
               * A direct page has no escalation rules: everybody it names is
               * paged at once. Its rows say so, rather than that a rule
               * could not be found.
               */
              if (item && isOnCallDirectPage(item)) {
                return <DirectPageLabel />;
              }

              return (
                <p>{translator.translateText("No escalation rule found.")}</p>
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Started At",
            type: FieldType.DateTime,
          },
          {
            field: {
              alertSentToUser: {
                name: true,
                email: true,
              },
            },
            title: "Notification Sent To",
            type: FieldType.Element,
            getElement: (
              item: OnCallDutyPolicyExecutionLogTimeline,
            ): ReactElement => {
              if (item["alertSentToUser"]) {
                return (
                  <UserElement
                    user={
                      BaseModel.fromJSON(item["alertSentToUser"], User) as User
                    }
                  />
                );
              }

              /*
               * A step that paged the next person in a schedule's rotation
               * but has no recipient: somebody was on call, and nobody was
               * next - the rotation has nobody else, or everybody else in it
               * is away.
               */
              if (item["onCallDutyScheduleId"] && item["isNextInRotation"]) {
                return (
                  <div
                    data-testid="on-call-timeline-nobody-next-in-rotation"
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
                  >
                    <Icon
                      icon={IconProp.Alert}
                      className="h-3.5 w-3.5 flex-shrink-0"
                    />
                    <span className="min-w-0 whitespace-normal break-words">
                      {translator.translateText(NOBODY_NEXT_IN_ROTATION_LABEL)}
                    </span>
                  </div>
                );
              }

              /*
               * A step that targeted a schedule but has no recipient means the
               * schedule had nobody on call. Naming that explicitly is the
               * difference between "this row is uninteresting" and "this is why
               * the incident sat unacknowledged".
               */
              if (item["onCallDutyScheduleId"]) {
                return (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                    <Icon icon={IconProp.Alert} className="h-3.5 w-3.5" />
                    {translator.translateText("No one was on call")}
                  </span>
                );
              }

              /*
               * A step about a team with no recipient is a team a direct
               * page named that has no members. It says which team, where
               * "-" left the row saying nothing at all.
               */
              const teamName: string = (item["userBelongsToTeam"]?.name || "")
                .toString()
                .trim();

              if (teamName) {
                return (
                  <div
                    data-testid="on-call-timeline-team-has-no-members"
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
                  >
                    <Icon
                      icon={IconProp.Alert}
                      className="h-3.5 w-3.5 flex-shrink-0"
                    />
                    <span className="min-w-0 whitespace-normal break-words">
                      {translator.translateTemplate(
                        TEAM_HAS_NO_MEMBERS_TEMPLATE,
                        { teamName: teamName },
                      )}
                    </span>
                  </div>
                );
              }

              /*
               * The level's own line: it paged nobody, and - since a level
               * with nobody to page is passed at once - the policy moved
               * on without waiting. "Moved on at once" sits under it, as
               * "Next in rotation" sits under a schedule's name.
               */
              const emptyLevelLine: OnCallEmptyLevelLine | null =
                readOnCallEmptyLevelLine(
                  item["statusMessage"] as string | undefined,
                );

              if (emptyLevelLine) {
                const movedOnAtOnce: boolean =
                  emptyLevelLine !== OnCallEmptyLevelLine.Legacy;

                return (
                  <span
                    data-testid="on-call-timeline-level-paged-nobody"
                    className="flex min-w-0 flex-col items-start gap-1"
                  >
                    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                      <Icon
                        icon={IconProp.Alert}
                        className="h-3.5 w-3.5 flex-shrink-0"
                      />
                      <span className="min-w-0 whitespace-normal break-words">
                        {translator.translateText(
                          emptyLevelLine === OnCallEmptyLevelLine.NoResponders
                            ? LEVEL_HAS_NO_RESPONDERS_LABEL
                            : LEVEL_PAGED_NOBODY_LABEL,
                        )}
                      </span>
                    </span>
                    {movedOnAtOnce ? (
                      <span
                        data-testid="on-call-timeline-moved-on-at-once"
                        className="inline-flex items-center gap-1 text-xs text-gray-500"
                      >
                        <Icon
                          icon={IconProp.Forward}
                          className="h-3 w-3 flex-shrink-0 text-gray-400"
                          isMirroredRightToLeft={true}
                        />
                        {translator.translateText(MOVED_ON_AT_ONCE_LABEL)}
                      </span>
                    ) : (
                      <></>
                    )}
                  </span>
                );
              }

              return <p>-</p>;
            },
          },
          {
            field: {
              onCallDutySchedule: {
                name: true,
              },
            },
            title: "Schedule",
            type: FieldType.Element,
            /*
             * On a phone too: it is the only place a step says it paged the
             * next person in the rotation, and which rotation nobody was next
             * in - without it the backup's page reads like any other.
             */
            getElement: (
              item: OnCallDutyPolicyExecutionLogTimeline,
            ): ReactElement => {
              if (item["onCallDutySchedule"]?.name) {
                /*
                 * The backup after whoever is on call: the schedule, with
                 * "Next in rotation" under it, so the row says why this
                 * person was paged.
                 */
                if (item["isNextInRotation"]) {
                  return (
                    <span
                      data-testid="on-call-timeline-next-in-rotation"
                      className="flex min-w-0 flex-col"
                    >
                      <span className="text-sm text-gray-700">
                        {item["onCallDutySchedule"].name.toString()}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                        <Icon
                          icon={IconProp.Forward}
                          className="h-3 w-3 flex-shrink-0 text-gray-400"
                        />
                        {translator.translateText(NEXT_IN_ROTATION_LABEL)}
                      </span>
                    </span>
                  );
                }

                return (
                  <span className="text-sm text-gray-700">
                    {item["onCallDutySchedule"].name.toString()}
                  </span>
                );
              }

              return <p>-</p>;
            },
          },
          {
            field: {
              acknowledgedAt: true,
            },
            title: "Acknowledged At",
            type: FieldType.DateTime,

            noValueMessage: "-",
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Element,

            getElement: (
              item: OnCallDutyPolicyExecutionLogTimeline,
            ): ReactElement => {
              if (
                item["status"] ===
                OnCallDutyExecutionLogTimelineStatus.NotificationSent
              ) {
                return (
                  <Pill
                    color={Green}
                    text={OnCallDutyExecutionLogTimelineStatus.NotificationSent}
                  />
                );
              } else if (
                item["status"] ===
                OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged
              ) {
                return (
                  <Pill
                    color={Green}
                    text={
                      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged
                    }
                  />
                );
              } else if (
                item["status"] === OnCallDutyExecutionLogTimelineStatus.Error
              ) {
                return (
                  <Pill
                    color={Red}
                    text={OnCallDutyExecutionLogTimelineStatus.Error}
                  />
                );
              } else if (
                item["status"] === OnCallDutyExecutionLogTimelineStatus.Skipped
              ) {
                return (
                  <Pill
                    color={Yellow}
                    text={OnCallDutyExecutionLogTimelineStatus.Skipped}
                  />
                );
              } else if (
                item["status"] ===
                OnCallDutyExecutionLogTimelineStatus.Executing
              ) {
                return (
                  <Pill
                    color={Yellow}
                    text={OnCallDutyExecutionLogTimelineStatus.Executing}
                  />
                );
              } else if (
                item["status"] === OnCallDutyExecutionLogTimelineStatus.Started
              ) {
                return (
                  <Pill
                    color={Yellow}
                    text={OnCallDutyExecutionLogTimelineStatus.Started}
                  />
                );
              } else if (
                // They could not take it, and escalated it (stored "Passed On").
                item["status"] === OnCallDutyExecutionLogTimelineStatus.PassedOn
              ) {
                return (
                  <Pill
                    color={Yellow}
                    text={PASS_ON_PAGE_TEXT.passedOnStatus}
                  />
                );
              }

              return (
                <Pill
                  color={Red}
                  text={OnCallDutyExecutionLogTimelineStatus.Error}
                />
              );
            },
          },
        ]}
      />
    );
  };

  return (
    <>
      {getModelTable()}

      {showViewStatusMessageModal ? (
        <ConfirmModal
          title={"Status Message"}
          description={statusMessage}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setShowViewStatusMessageModal(false);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ExecutionLogTimelineTable;
