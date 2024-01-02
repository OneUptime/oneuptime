import UserEmail from '../../Components/NotificationMethods/Email';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import UserSMS from '../../Components/NotificationMethods/SMS';
import PageComponentProps from '../PageComponentProps';
import UserCall from '../../Components/NotificationMethods/Call';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Fragment>
            <UserEmail />
            <UserSMS />
            <UserCall />
        </Fragment>
    );
};

export default Settings;
