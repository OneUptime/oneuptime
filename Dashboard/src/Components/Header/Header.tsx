import React, { ReactElement } from "react";
import SearchBox from "CommonUI/src/Components/Header/SearchBox";
import HeaderIconDropdownButton from "CommonUI/src/Components/Header/HeaderIconDropdownButton";
import Notifications from "CommonUI/src/Components/Header/Notifications/Notifications";
import NotificationItem from "CommonUI/src/Components/Header/Notifications/NotificationItem";
import { IconProp } from "CommonUI/src/Components/Basic/Icon/Icon";
import ProjectPicker from "CommonUI/src/Components/Header/ProjectPicker/ProjectPicker";
import ObjectID from "Common/Types/ObjectID";
import UserProfile from "CommonUI/src/Components/Header/UserProfile/UseerProfile";
import Header from "CommonUI/src/Components/Header/Header";

const DashboardHeader = (): ReactElement => {

    return (
        <Header
            leftComponents={<>
                <ProjectPicker key={1} onChange={(_value: ObjectID) => {

                }} />
                <SearchBox key={2} onChange={(_value: string) => {

                }} />
            </>
            }
            rightComponents={
                <>
                    <HeaderIconDropdownButton icon={IconProp.Help}>

                    </HeaderIconDropdownButton>

                    <HeaderIconDropdownButton icon={IconProp.Notification} badge={4}>
                        <Notifications>
                            <NotificationItem title="Sample Title" description="Sample Description" createdAt={new Date()} icon={IconProp.Home} />
                        </Notifications>
                    </HeaderIconDropdownButton>

                    <UserProfile />
                </>
            }
        />


    );
};

export default DashboardHeader;
