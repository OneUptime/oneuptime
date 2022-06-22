import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Basic/Icon/Icon';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
    return (
        <SideMenu>
            <SideMenuSection title="Sample">
                <SideMenuItem
                    link={{
                        title: 'Home',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Home}
                    badge={14}
                />
                <SideMenuItem
                    link={{
                        title: 'Home',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Home}
                    showAlert={true}
                />

                <SideMenuItem
                    link={{
                        title: 'Home',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Home}
                    showWarning={true}
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
