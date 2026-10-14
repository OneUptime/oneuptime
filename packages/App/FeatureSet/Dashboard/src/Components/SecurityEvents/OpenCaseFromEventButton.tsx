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
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  securityEvent: SecurityEvent;
}

/*
 * Opens a security case about one event, for the thing an analyst spots
 * that no rule caught: the case names the event's users, hosts and
 * addresses, takes its severity as its priority, and opens on its own page.
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
            const securityCase: SecurityCase = new SecurityCase();
            securityCase.projectId = ProjectUtil.getCurrentProjectId()!;
            securityCase.title = draft.title;
            securityCase.description = draft.description;
            securityCase.priority = draft.priority;
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
