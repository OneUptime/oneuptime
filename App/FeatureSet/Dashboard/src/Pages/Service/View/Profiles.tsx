import ProfileTable from "../../../Components/Profiles/ProfileTable";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceProfiles: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ProfileTable
        modelId={modelId}
        noItemsMessage="No profiles found for this service."
      />
    </Fragment>
  );
};

export default ServiceProfiles;
