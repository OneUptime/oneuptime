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
                title="Home"
                icon={IconProp.Home}
                route={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.HOME] as Route
                )}
            ></NavBarItem>
        </NavBar>
    );
};

export default DashboardNavbar;
