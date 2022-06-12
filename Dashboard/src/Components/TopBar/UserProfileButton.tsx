import React, { ReactElement, FunctionComponent } from 'react';
import MenuItem from 'CommonUI/src/Components/Basic/Button/MenuButton/MenuItem';
import UserInfo from 'CommonUI/src/Components/Dashboard/TopBar/UserProfile/UserInfo';
import { IconProp } from 'CommonUI/src/Components/Basic/Icon/Icon';
import IconButton from 'CommonUI/src/Components/Basic/Button/MenuButton/IconButton';

const CreateButton: FunctionComponent = (): ReactElement => {
    return (
        <IconButton icon={IconProp.Help}>
            <UserInfo name="Username" role="Admin" />
            <MenuItem title="Profile" />
            <MenuItem title="Log out" />
        </IconButton>
    );
};

export default CreateButton;
