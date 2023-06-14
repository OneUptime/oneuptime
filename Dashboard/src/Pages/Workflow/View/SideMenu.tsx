import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageMap from '../../../Utils/PageMap';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps {
    modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <SideMenu>
            <SideMenuSection title="Basic">
                <SideMenuItem
                    link={{
                        title: 'Overview',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.WORKFLOW_VIEW] as Route,
                             {modelId: props.modelId}
                    ),
                    }}
                    icon={IconProp.Info}
                />
                <SideMenuItem
                    link={{
                        title: 'Builder',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.WORKFLOW_BUILDER] as Route,
                             {modelId: props.modelId}
                    ),
                    }}
                    icon={IconProp.Workflow}
                />
            </SideMenuSection>

            <SideMenuSection title="Advanced">
                <SideMenuItem
                    link={{
                        title: 'Runs & Logs',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.WORKFLOW_LOGS] as Route,
                             {modelId: props.modelId}
                    ),
                    }}
                    icon={IconProp.Logs}
                />

                <SideMenuItem
                    link={{
                        title: 'Workflow Variables',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.WORKFLOW_VARIABLES] as Route,
                             {modelId: props.modelId}
                    ),
                    }}
                    icon={IconProp.Variable}
                />

                <SideMenuItem
                    link={{
                        title: 'Delete Workflow',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.WORKFLOW_DELETE] as Route,
                             {modelId: props.modelId}
                    ),
                    }}
                    icon={IconProp.Trash}
                    className="danger-on-hover"
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
