import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  showModal: boolean;
  onClose: () => void;
  currentOnCallDutyEscalationPolicyUsers: Array<OnCallDutyPolicyEscalationRuleUser>;
  currentOnCallDutyEscalationPolicyTeams: Array<OnCallDutyPolicyEscalationRuleTeam>;
  currentOnCallDutyEscalationPolicySchedules: Array<OnCallDutyPolicyEscalationRuleSchedule>;
}

const CurrentOnCallPolicyModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  if (!props.showModal) {
    return <></>;
  }

  const calendarFeedRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route,
  );

  return (
    <ConfirmModal
      title="You're on-call on these policies"
      onSubmit={props.onClose}
      submitButtonType={ButtonStyleType.NORMAL}
      submitButtonText="Close"
      description={
        <div>
          {props.currentOnCallDutyEscalationPolicyUsers.map(
            (
              currentOnCallDutyEscalationPolicyUser: OnCallDutyPolicyEscalationRuleUser,
            ) => {
              return (
                <div>
                  <span className="font-semibold">
                    {
                      currentOnCallDutyEscalationPolicyUser.onCallDutyPolicy
                        ?.name
                    }
                  </span>
                  : You are added to escalation rule{" "}
                  <span className="font-semibold">
                    {
                      currentOnCallDutyEscalationPolicyUser
                        .onCallDutyPolicyEscalationRule?.name
                    }
                  </span>{" "}
                  for this policy.
                </div>
              );
            },
          )}

          {props.currentOnCallDutyEscalationPolicyTeams.map(
            (
              currentOnCallDutyEscalationPolicyTeam: OnCallDutyPolicyEscalationRuleTeam,
            ) => {
              return (
                <div>
                  <span className="font-semibold">
                    {
                      currentOnCallDutyEscalationPolicyTeam.onCallDutyPolicy
                        ?.name
                    }
                  </span>
                  : Team{" "}
                  <span className="font-semibold">
                    {currentOnCallDutyEscalationPolicyTeam.team?.name}
                  </span>{" "}
                  is added to escalation rule{" "}
                  <span className="font-semibold">
                    {
                      currentOnCallDutyEscalationPolicyTeam
                        .onCallDutyPolicyEscalationRule?.name
                    }
                  </span>{" "}
                  for this policy and you belong to this team.
                </div>
              );
            },
          )}

          {props.currentOnCallDutyEscalationPolicySchedules.map(
            (
              currentOnCallDutyEscalationPolicySchedule: OnCallDutyPolicyEscalationRuleSchedule,
            ) => {
              return (
                <div>
                  <span className="font-semibold">
                    {
                      currentOnCallDutyEscalationPolicySchedule.onCallDutyPolicy
                        ?.name
                    }
                  </span>
                  : Schedule{" "}
                  <span className="font-semibold">
                    {
                      currentOnCallDutyEscalationPolicySchedule
                        .onCallDutyPolicySchedule?.name
                    }
                  </span>{" "}
                  is added to escalation rule{" "}
                  <span className="font-semibold">
                    {
                      currentOnCallDutyEscalationPolicySchedule
                        .onCallDutyPolicyEscalationRule?.name
                    }
                  </span>{" "}
                  for this policy and you are currently on roster for this
                  schedule.
                </div>
              );
            },
          )}

          <div
            className="mt-3 text-sm"
            data-testid="on-call-modal-calendar-link"
          >
            <Link
              to={calendarFeedRoute}
              onClick={props.onClose}
              className="text-indigo-600 hover:underline"
            >
              {translateString("Add your shifts to your calendar")}
            </Link>
          </div>
        </div>
      }
    />
  );
};

export default CurrentOnCallPolicyModal;
