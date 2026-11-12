import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import AppLink from "../AppLink/AppLink";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onCallPolicy: OnCallDutyPolicy;
  onNavigateComplete?: (() => void) | undefined;
}

/*
 * A policy's name is the project's own, read the way it is written
 * (IsolatedText): an English policy named in a line of an Arabic page keeps
 * its brackets where they were typed, and a list of them reads the page's
 * way, one name after another (OnCallPolicies).
 */
const OnCallPolicyView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const name: ReactElement = (
    <IsolatedText
      text={props.onCallPolicy.name || ""}
      dataTestId="on-call-policy-name"
    />
  );

  if (props.onCallPolicy._id) {
    return (
      <AppLink
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
          {
            modelId: new ObjectID(props.onCallPolicy._id as string),
          },
        )}
      >
        {name}
      </AppLink>
    );
  }

  return name;
};

export default OnCallPolicyView;
