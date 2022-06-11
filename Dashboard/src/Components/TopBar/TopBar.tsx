import TopBar from 'CommonUI/src/Components/Dashboard/TopBar/TopBar';
import CurrentProject from '../../Components/ProjectPicker/CurrentProject';
import SearchBar from 'CommonUI/src/Components/Dashboard/TopBar/SearchBar/SearchBar';
import { MenuIconButton } from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenuButton/MenuButton';
import { faBell } from '@fortawesome/free-solid-svg-icons';
import CreateButton from '../../Components/CreateButton';
import HelpButton from '../../Components/HelpButton';
import UserProfileButton from '../../Components/UserProfile/UserProfileButton';
import React, { FunctionComponent } from 'react';

const TopBarComponent: FunctionComponent = () => {
    return (
        <TopBar
            leftContent={[<CurrentProject key={1} />]}
            middleContent={[<SearchBar key={1} />]}
            rightContent={[
                <CreateButton key={1} />,
                <HelpButton key={2} />,
                <MenuIconButton key={3} icon={faBell} />,
                <UserProfileButton key={4} />,
            ]}
        />
    );
};

export default TopBarComponent;
