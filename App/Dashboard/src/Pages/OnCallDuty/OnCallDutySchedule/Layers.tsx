import Layers from "../../../Components/OnCallPolicy/OnCallScheduleLayer/Layers";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallScheduleDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <Layers
        onCallDutyPolicyScheduleId={modelId}
        projectId={ProjectUtil.getCurrentProjectId()!}
      />
    </Fragment>
  );
};

export default OnCallScheduleDelete;
