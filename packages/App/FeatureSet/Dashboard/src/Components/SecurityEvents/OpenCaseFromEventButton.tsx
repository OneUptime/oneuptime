import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SecurityCaseDraft,
  buildCaseFromSecurityEvent,
} from "./SecurityEventCase";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCasePriorities from "Common/Utils/SecurityCase/SecurityCasePriorities";
import {
  SecurityCaseValueLists,
  getSecurityCaseValues,
} from "../SecurityCase/SecurityCaseValues";
import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import { getCaseEventReferences } from "./Hunts/AddToCaseModel";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  securityEvent: SecurityEvent;
  // The hunt the event was found by, when the list is a hunt's.
  huntId?: ObjectID | undefined;
}

/*
 * Opens a security case about one event, for the thing an analyst spots
 * that no rule caught: the case names the event's users, hosts and
 * addresses, opens at the project's priority for its severity - whatever
 * the project calls it - keeps the event itself as its first evidence, and
 * opens on its own page. A case that opened is opened even when the event
 * could not be kept on it (its Evidence page then lacks it).
 */
const OpenCaseFromEventButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpening, setIsOpening] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const gate: PermissionGateResult = PermissionGate.check(
    new SecurityCase(),
    ModelAction.Create,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        title="Open Case"
        icon={IconProp.ShieldExclamation}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        isLoading={isOpening}
        disabled={!gate.isAllowed || isOpening}
        tooltip={
          gate.isAllowed
            ? "Open a security case about this event, with its users, hosts and addresses."
            : gate.disabledReason
        }
        dataTestId="security-event-open-case"
        onClick={async () => {
          setIsOpening(true);
          setError("");

          try {
            const draft: SecurityCaseDraft = buildCaseFromSecurityEvent(
              props.securityEvent,
            );
            const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;
            const values: SecurityCaseValueLists =
              await getSecurityCaseValues(projectId);
            const priority: SecurityCasePriority | null =
              SecurityCasePriorities.getPriorityOfLevel(
                values.priorities,
                draft.priorityLevel,
              );
            const securityCase: SecurityCase = new SecurityCase();
            securityCase.projectId = projectId;
            securityCase.title = draft.title;
            securityCase.description = draft.description;

            if (priority?.id) {
              securityCase.securityCasePriorityId = priority.id;
            }

            securityCase.entities = draft.entities as unknown as JSONArray;
            securityCase.mitreTactics = draft.mitreTactics;
            securityCase.mitreTechniques = draft.mitreTechniques;

            const response: { data: unknown } =
              await ModelAPI.create<SecurityCase>({
                model: securityCase,
                modelType: SecurityCase,
              });

            const created: { _id?: string } = response.data as {
              _id?: string;
            };

            if (created?._id) {
              try {
                await SecurityCaseApi.addEventsToCase({
                  caseId: new ObjectID(created._id),
                  events: getCaseEventReferences([props.securityEvent]),
                  huntId: props.huntId,
                });
              } catch {
                // The case is open; the event not being kept on it must not hide that.
              }

              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SECURITY_CASE_VIEW] as Route,
                  { modelId: new ObjectID(created._id) },
                ),
              );
            }
          } catch (err) {
            setError(API.getFriendlyMessage(err));
          }

          setIsOpening(false);
        }}
      />
      {error ? <p className="text-xs text-red-600">{error}</p> : <></>}
    </div>
  );
};

export default OpenCaseFromEventButton;
