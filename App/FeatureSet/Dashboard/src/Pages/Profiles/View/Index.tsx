import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ProfileFlamegraph from "../../../Components/Profiles/ProfileFlamegraph";
import ProfileFunctionList from "../../../Components/Profiles/ProfileFunctionList";

const ProfileViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const profileId: string = Navigation.getLastParamAsString(0);

  const tabs: Array<Tab> = [
    {
      name: "Flamegraph",
      children: <ProfileFlamegraph profileId={profileId} />,
    },
    {
      name: "Function List",
      children: <ProfileFunctionList profileId={profileId} />,
    },
  ];

  const handleTabChange: (tab: Tab) => void = (_tab: Tab): void => {
    // Tab content is rendered by the Tabs component via children
  };

  return (
    <div>
      <Tabs tabs={tabs} onTabChange={handleTabChange} />
    </div>
  );
};

export default ProfileViewPage;
