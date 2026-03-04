import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  schedule?: OnCallDutySchedule | JSONObject | undefined | null;
  prefix?: string | undefined;
  suffix?: string | undefined;
  suffixClassName?: string | undefined;
  scheduleNameClassName?: string | undefined;
  prefixClassName?: string | undefined;
  onNavigateComplete?: (() => void) | undefined;
}

const OnCallDutyScheduleElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let schedule: JSONObject | null | undefined = null;

  if (props.schedule instanceof OnCallDutySchedule) {
    schedule = BaseModel.toJSONObject(props.schedule, OnCallDutySchedule);
  } else {
    schedule = props.schedule;
  }

  if (JSONFunctions.isEmptyObject(schedule)) {
    return <></>;
  }

  if (schedule) {
    const scheduleName: string =
      (schedule["name"]?.toString() as string) || "On-Call Schedule";

    const scheduleId: string | undefined =
      schedule["_id"]?.toString() || schedule["id"]?.toString();

    const projectId: string | undefined =
      schedule["projectId"]?.toString() ||
      (schedule["project"] as JSONObject)?.["_id"]?.toString();

    const content: ReactElement = (
      <div className="flex">
        <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center">
          <Icon icon={IconProp.Calendar} className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="mt-1 mr-1 ml-3">
          <div>
            <span
              className={props.prefixClassName ? props.prefixClassName : ""}
            >
              {props.prefix}
            </span>{" "}
            <span
              className={
                props.scheduleNameClassName ? props.scheduleNameClassName : ""
              }
            >
              {scheduleName}
            </span>{" "}
          </div>
        </div>
        {props.suffix && (
          <div>
            <p className={props.suffixClassName}>{props.suffix}</p>
          </div>
        )}
      </div>
    );

    if (scheduleId && projectId) {
      return (
        <AppLink
          onNavigateComplete={props.onNavigateComplete}
          className="hover:underline"
          to={
            new Route(
              `/dashboard/${projectId}/on-call-duty/schedules/${scheduleId}`,
            )
          }
        >
          {content}
        </AppLink>
      );
    }

    return content;
  }

  return <></>;
};

export default OnCallDutyScheduleElement;
