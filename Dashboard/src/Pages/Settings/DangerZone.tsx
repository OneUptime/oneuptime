import type Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import type PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import Alert, { AlertType } from 'CommonUI/src/Components/Alerts/Alert';
import ModelDelete from 'CommonUI/src/Components/ModelDelete/ModelDelete';
import Project from 'Model/Models/Project';
import ObjectID from 'Common/Types/ObjectID';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import PermissionUtil from 'CommonUI/src/Utils/Permission';
import DashboardNavigation from '../../Utils/Navigation';

export interface ComponentProps extends PageComponentProps {
    onProjectDeleted: () => void;
}

const Settings: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS] as Route
                    ),
                },
                {
                    title: 'Danger Zone',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_DANGERZONE] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <Alert
                type={AlertType.DANGER}
                strongTitle="DANGER ZONE"
                title="Deleting your project will delete it permanently and there is no way to recover. "
            />

            <ModelDelete
                modelType={Project}
                modelId={
                    new ObjectID(
                        DashboardNavigation.getProjectId()?.toString() || ''
                    )
                }
                onDeleteSuccess={() => {
                    ProjectUtil.clearCurrentProject();
                    PermissionUtil.clearProjectPermissions();
                    props.onProjectDeleted();
                }}
            />
        </Page>
    );
};

export default Settings;
