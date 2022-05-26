import React, { FunctionComponent } from 'react';
import TopBar from 'CommonUI/src/Components/Dashboard/TopBar/TopBar';
import CurrentProject from './Components/ProjectPicker/CurrentProject';
import SearchBar from 'CommonUI/src/Components/Dashboard/TopBar/SearchBar/SearchBar';
import { MenuIconButton } from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenuButton/MenuButton';
import { faCog, faBell } from '@fortawesome/free-solid-svg-icons';
import './App.scss';
import CreateButton from './Components/CreateButton';
import HelpButton from './Components/HelpButton';
import UserProfileButton from './Components/UserProfile/UserProfileButton';

const App: FunctionComponent = () => {
    return (
        <div className="App">
            <TopBar
                leftContents={[<CurrentProject />]}
                middleContents={[<SearchBar />]}
                rightContents={[
                    <CreateButton />,
                    <HelpButton />,
                    <MenuIconButton icon={faBell} />,
                    <MenuIconButton icon={faCog} />,
                    <UserProfileButton />,
                ]}
            />
        </div>
    );
};

export default App;
