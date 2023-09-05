import React, { FunctionComponent, ReactElement } from 'react';
import NavBar from 'CommonUI/src/Components/Navbar/NavBar';
import NavBarItem from 'CommonUI/src/Components/Navbar/NavBarItem';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';

const DashboardNavbar: FunctionComponent = (): ReactElement => {
    return (
        <NavBar>
            <NavBarItem
                title="Users"
                icon={IconProp.User}
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.USERS] as Route
                )}
            ></NavBarItem>

            <NavBarItem
                title="Projects"
                icon={IconProp.Folder}
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.PROJECTS] as Route
                )}
            ></NavBarItem>

            <NavBarItem
                title="Settings"
                icon={IconProp.Settings}
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SETTINGS] as Route
                )}
            ></NavBarItem>
        </NavBar>
    );
};

export default DashboardNavbar;
