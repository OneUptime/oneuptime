import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import Alert, { AlertType } from 'CommonUI/src/Components/Alerts/Alert';
import ModelDelete from 'CommonUI/src/Components/ModelDelete/ModelDelete';
import Project from 'Common/Models/Project';
import ObjectID from 'Common/Types/ObjectID';

const Settings: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Settings',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Danger Zone',
                    to: RouteMap[PageMap.HOME] as Route,
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
                type={Project}
                modelId={new ObjectID(props.currentProject?._id || '')}
            />
        </Page>
    );
};

export default Settings;
