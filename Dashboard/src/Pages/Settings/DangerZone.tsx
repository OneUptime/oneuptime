import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import Card from 'CommonUI/src/Components/Card/Card';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Alert, { AlertType } from 'CommonUI/src/Components/Alerts/Alert';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Modal from "CommonUI/src/Components/Modal/Modal";

const Settings: FunctionComponent<PageComponentProps> = (
    __props: PageComponentProps
): ReactElement => {

    const [showModal, setShowModal] = useState<boolean>(false);

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
            <Alert type={AlertType.DANGER} strongTitle='DANGER ZONE' title='Deleting your project will delete it permanently and there is no way to recover. ' />


            <Card
                title="Delete Project"
                description='Are you sure you want to delete this project?'
                buttons={[
                    <Button title='Delete Project' buttonStyle={ButtonStyleType.DANGER} onClick={() => {
                        setShowModal(true);
                    }} icon={IconProp.Trash} />
                ]}
            />

            {showModal ? <Modal title={"Delete Project"} onSubmit={() => {
                setShowModal(false);
            }} onClose={() => {
                setShowModal(false);
            }} submitButtonText="DELETE PROJECT" submitButtonType={ButtonStyleType.DANGER} >
                <p>Are you sure you want to delete this project?</p>
            </Modal>: <></>}

        </Page>
    );
};

export default Settings;
