import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useState } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ProfileFlamegraph from "../../../Components/Profiles/ProfileFlamegraph";
import ProfileFunctionList from "../../../Components/Profiles/ProfileFunctionList";
import ProfileTypeSelector from "../../../Components/Profiles/ProfileTypeSelector";
import DiffFlamegraph from "../../../Components/Profiles/DiffFlamegraph";
import OneUptimeDate from "Common/Types/Date";

const ProfileViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const profileId: string = Navigation.getLastParamAsString(0);
  const [selectedProfileType, setSelectedProfileType] = useState<
    string | undefined
  >(undefined);

  const now: Date = OneUptimeDate.getCurrentDate();
  const oneHourAgo: Date = OneUptimeDate.addRemoveHours(now, -1);
  const twoHoursAgo: Date = OneUptimeDate.addRemoveHours(now, -2);

  const tabs: Array<Tab> = [
    {
      name: "Flamegraph",
      children: (
        <ProfileFlamegraph
          profileId={profileId}
          profileType={selectedProfileType}
        />
      ),
    },
    {
      name: "Function List",
      children: (
        <ProfileFunctionList
          profileId={profileId}
          profileType={selectedProfileType}
        />
      ),
    },
    {
      name: "Diff",
      children: (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            Compare profile data between two time ranges. Baseline is the
            earlier period, comparison is the more recent period.
          </p>
          <DiffFlamegraph
            baselineStartTime={twoHoursAgo}
            baselineEndTime={oneHourAgo}
            comparisonStartTime={oneHourAgo}
            comparisonEndTime={now}
            profileType={selectedProfileType}
          />
        </div>
      ),
    },
  ];

  const handleTabChange: (tab: Tab) => void = (_tab: Tab): void => {
    // Tab content is rendered by the Tabs component via children
  };

  return (
    <div>
      <div className="mb-4">
        <ProfileTypeSelector
          selectedProfileType={selectedProfileType}
          onChange={setSelectedProfileType}
        />
      </div>
      <Tabs tabs={tabs} onTabChange={handleTabChange} />
    </div>
  );
};

export default ProfileViewPage;
