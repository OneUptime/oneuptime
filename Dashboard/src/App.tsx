import React, { FunctionComponent } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
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
import Monitors from './Pages/Monitors';

const App: FunctionComponent = () => {
    return (
        <div className="App">
            <TopBar
                leftContents={[<CurrentProject key={1} />]}
                middleContents={[<SearchBar key={1} />]}
                rightContents={[
                    <CreateButton key={1} />,
                    <HelpButton key={2} />,
                    <MenuIconButton key={3} icon={faBell} />,
                    <UserProfileButton key={4} />,
                ]}
                navContents={{
                    leftContents: [
                        <NavContainer
                            key={1}
                            navigations={[
                                <NavLink key={1}>
                                    <p>Home</p>
                                </NavLink>,
                                <NavLink key={2} isActive={true}>
                                    <p>Monitors</p>
                                </NavLink>,
                                <NavLink key={3}>
                                    <p>Incidents</p>
                                </NavLink>,
                                <NavLink key={4}>
                                    <p>Status Pages</p>
                                </NavLink>,
                                <NavLink key={5}>
                                    <p>Logs</p>
                                </NavLink>,
                                <Dropdown key={6} />,
                            ]}
                        />,
                    ],
                    rightContents: [<MenuIconButton key={1} icon={faCog} />],
                }}
            />
            <Router>
                <Routes>
                    <Route path="/" element={<Monitors />} />
                </Routes>
            </Router>
        </div>
    );
};

export default App;
