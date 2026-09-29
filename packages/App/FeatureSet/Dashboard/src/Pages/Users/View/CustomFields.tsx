import UserCustomFields from "../../../Components/CustomFields/UserCustomFields";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const UserViewCustomFields: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const userId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <UserCustomFields userId={userId} />;
};

export default UserViewCustomFields;
