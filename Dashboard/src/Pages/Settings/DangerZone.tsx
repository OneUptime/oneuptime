import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import Card from 'CommonUI/src/Components/Card/Card';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Alert, { AlertType } from 'CommonUI/src/Components/Alerts/Alert';

const Settings: FunctionComponent<PageComponentProps> = (
    __props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project Name',
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
            <Alert type={AlertType.DANGER} strongTitle='DANGER ZONE' title='Please be careful with what you do on this page' />
            <Alert type={AlertType.SUCCESS} strongTitle='DANGER ZONE' title='Please be careful with what you do on this page' />
            <Alert type={AlertType.INFO} strongTitle='DANGER ZONE' title='Please be careful with what you do on this page' />
            <Alert type={AlertType.WARNING} strongTitle='DANGER ZONE' title='Please be careful with what you do on this page' />

            <Card
                title="Delete Project"
                description='Are you sure you want to delete this project?'
                buttons={[
                    <Button title='Delete Project' buttonStyle={ButtonStyleType.DANGER} onClick=(() => {
                        
                    }) />
                ]}
            />

        </Page>
    );
};

export default Settings;
