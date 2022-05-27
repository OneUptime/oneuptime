import React, { FunctionComponent } from 'react';
import TopBar from 'CommonUI/src/Components/Dashboard/TopBar/TopBar';
import NavLink from 'CommonUI/src/Components/Dashboard/TopBar/NavLink/NavLink';
import NavContainer from 'CommonUI/src/Components/Dashboard/TopBar/NavLink/NavContainer';
import CurrentProject from './Components/ProjectPicker/CurrentProject';
import SearchBar from 'CommonUI/src/Components/Dashboard/TopBar/SearchBar/SearchBar';
import { MenuIconButton } from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenuButton/MenuButton';
import { faCog, faBell } from '@fortawesome/free-solid-svg-icons';
import './App.scss';
import CreateButton from './Components/CreateButton';
import HelpButton from './Components/HelpButton';
import UserProfileButton from './Components/UserProfile/UserProfileButton';
import Dropdown from './Components/Navigations/Dropdown';

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
                navContents={{
                    leftContents: [
                        <NavContainer
                            navigations={[
                                <NavLink isActive={true}>
                                    <p>Home</p>
                                </NavLink>,
                                <NavLink>
                                    <p>Monitors</p>
                                </NavLink>,
                                <NavLink>
                                    <p>Incidents</p>
                                </NavLink>,
                                <NavLink>
                                    <p>Status Pages</p>
                                </NavLink>,
                                <NavLink>
                                    <p>Logs</p>
                                </NavLink>,
                                <Dropdown />,
                            ]}
                        />,
                    ],
                    rightContents: [
                        <NavLink>
                            <p>Automation Scripts</p>
                        </NavLink>,
                        <NavLink>
                            <p>Reports</p>
                        </NavLink>,
                    ],
                }}
            />
        </div>
    );
};

export default App;
