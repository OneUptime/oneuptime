import { Black } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps {
  projectId: ObjectID;
}

const OnCallPolicyLogTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Pill
      color={props.label.color || Black}
      text={props.label.name || ""}
      style={{
        marginRight: "5px",
      }}
    />
  );
};

export default OnCallPolicyLogTable;
