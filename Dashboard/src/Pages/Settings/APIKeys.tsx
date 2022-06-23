import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import TableCard from "CommonUI/src/Components/Table/TableCard";

const APIKeys: FunctionComponent<PageComponentProps> = (
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
                    title: 'API Keys',
                    to: RouteMap[PageMap.HOME] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            
            <TableCard
                title="Manage API Keys"
                description='Create, edit, delete your project API Keys here.'
                headerButtons={[
                    <Button title='Create API Key' buttonStyle={ButtonStyleType.SECONDRY} onClick={() => {
                        
                    }} icon={IconProp.Add} />
                ]}
            />

        </Page>
    );
};

export default APIKeys;
