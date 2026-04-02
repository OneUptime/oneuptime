import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import ProfileTable from "../../Components/Profiles/ProfileTable";

const ProfilesListPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <ProfileTable />;
};

export default ProfilesListPage;
