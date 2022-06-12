import TopBar from 'CommonUI/src/Components/Dashboard/TopBar/TopBar';
import CurrentProject from '../../Components/ProjectPicker/CurrentProject';
import SearchBar from 'CommonUI/src/Components/Dashboard/TopBar/SearchBar/SearchBar';
import CreateButton from './CreateButton';
import HelpButton from './HelpButton';
import UserProfileButton from './UserProfileButton';
import React, { FunctionComponent } from 'react';
import NotificationButton from './NotificationButton';

const TopBarComponent: FunctionComponent = () => {
    return (
        <TopBar
            leftContent={[<CurrentProject key={1} />]}
            middleContent={[<SearchBar key={1} />]}
            rightContent={[
                <CreateButton key={1} />,
                <HelpButton key={2} />,
                <NotificationButton key={3} />,
                <UserProfileButton key={4} />,
            ]}
        />
    );
};

export default TopBarComponent;
