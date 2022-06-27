import React, { FunctionComponent, ReactElement } from 'react';
import SearchBox from 'CommonUI/src/Components/Header/SearchBox';
import Notifications from './Notifications';
import Help from './Help';
import UserProfile from './UserProfile';
import ProjectPicker from 'CommonUI/src/Components/Header/ProjectPicker/ProjectPicker';
import HeaderAlert from 'CommonUI/src/Components/Header/HeaderAlert';
import { AlertType } from 'CommonUI/src/Components/Alerts/Alert';
// import ObjectID from 'Common/Types/ObjectID';

import Header from 'CommonUI/src/Components/Header/Header';

const DashboardHeader: FunctionComponent = (): ReactElement => {
    return (
        <Header
            leftComponents={
                <>
                    <ProjectPicker
                        key={1}
                        //onChange={(_value: ObjectID) => {}}
                    />
                    <HeaderAlert
                        title="Action required"
                        type={AlertType.DANGER}
                    />
                    <SearchBox key={2} onChange={(_value: string) => {}} />
                </>
            }
            rightComponents={
                <>
                    <Notifications />
                    <Help />
                    <UserProfile />
                </>
            }
        />
    );
};

export default DashboardHeader;
