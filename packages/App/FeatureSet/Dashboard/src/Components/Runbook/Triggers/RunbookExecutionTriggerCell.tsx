import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import User from "Common/Models/DatabaseModels/User";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import AlertElement from "../../Alert/Alert";
import AppLink from "../../AppLink/AppLink";
import IncidentElement from "../../Incident/Incident";
import UserElement from "../../User/User";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  RUNBOOK_EXECUTION_TRIGGER_SELECT,
  UnattendedTriggerText,
  getUnattendedTriggerText,
} from "./RunbookExecutionTrigger";

/*
 * The "Triggered by" column of both Executions lists - a runbook's and the
 * project's: a small label over what started the run. Its schedule (when it
 * was due) or its webhook (the address that called it), the incident, alert
 * or maintenance event a rule or auto-remediation ran it for, or the person
 * who pressed Run Now.
 */

export interface ComponentProps {
  execution: RunbookExecution;
}

/*
 * Where the project's Executions list wraps the column: an incident's title
 * or a catch-up run's second line wraps at about 18rem, and nothing is
 * squeezed below 12rem, so a person's name or a due time stays on one line.
 */
export const TRIGGERED_BY_MAX_WIDTH_CLASS_NAME: string = "max-w-[18rem]";
export const TRIGGERED_BY_MIN_WIDTH_CLASS_NAME: string = "min-w-[12rem]";

// What the column reads of each run.
export const RUNBOOK_EXECUTION_TRIGGER_CELL_SELECT: {
  incident: { _id: true; title: true };
  alert: { _id: true; title: true };
  scheduledMaintenance: { _id: true; title: true };
  triggeredByUser: {
    _id: true;
    name: true;
    email: true;
    profilePictureId: true;
  };
  triggerType: true;
  triggerDetails: true;
} = {
  incident: { _id: true, title: true },
  alert: { _id: true, title: true },
  scheduledMaintenance: { _id: true, title: true },
  triggeredByUser: {
    _id: true,
    name: true,
    email: true,
    profilePictureId: true,
  },
  ...RUNBOOK_EXECUTION_TRIGGER_SELECT,
};

const RunbookExecutionTriggerCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const item: RunbookExecution = props.execution;

  const unattended: UnattendedTriggerText | null = getUnattendedTriggerText(
    translator,
    item,
  );

  if (unattended) {
    // "Schedule" over when it was due; "Trigger" over "Schedule" otherwise.
    const [first, ...rest]: Array<string> = unattended.details;

    return (
      <div className="flex flex-col" data-trigger={item.triggerType}>
        <span className="text-xs text-gray-500">
          {first ? unattended.label : translator.translateText("Trigger")}
        </span>
        <span className="text-sm text-gray-900">
          {first || unattended.label}
        </span>
        {rest.map((line: string, index: number) => {
          return (
            <span key={index} className="text-xs text-gray-500">
              {line}
            </span>
          );
        })}
      </div>
    );
  }

  if (item.incident) {
    return (
      <div className="flex flex-col">
        <span className="text-xs text-gray-500">
          {translator.translateText("Incident")}
        </span>
        <IncidentElement incident={item.incident as Incident} />
      </div>
    );
  }

  if (item.alert) {
    return (
      <div className="flex flex-col">
        <span className="text-xs text-gray-500">
          {translator.translateText("Alert")}
        </span>
        <AlertElement alert={item.alert as Alert} />
      </div>
    );
  }

  if (item.scheduledMaintenance) {
    const sm: ScheduledMaintenance =
      item.scheduledMaintenance as ScheduledMaintenance;

    return (
      <div className="flex flex-col">
        <span className="text-xs text-gray-500">
          {translator.translateText("Maintenance")}
        </span>
        {sm._id ? (
          <AppLink
            className="hover:underline"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
              { modelId: new ObjectID(sm._id as string) },
            )}
          >
            <span>{sm.title || translator.translateText("View")}</span>
          </AppLink>
        ) : (
          <span>{sm.title || "—"}</span>
        )}
      </div>
    );
  }

  if (item.triggeredByUser) {
    return (
      <div className="flex flex-col">
        <span className="text-xs text-gray-500">
          {translator.translateText("Manual run by")}
        </span>
        <UserElement user={item.triggeredByUser as User} />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500">
        {translator.translateText("Trigger")}
      </span>
      <span className="text-sm text-gray-500">
        {translator.translateText("Manual / unknown")}
      </span>
    </div>
  );
};

export default RunbookExecutionTriggerCell;
