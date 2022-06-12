import React, { ReactElement, FunctionComponent } from 'react';
import MenuItem from 'CommonUI/src/Components/Basic/Button/MenuButton/MenuItem';
import UserInfo from 'CommonUI/src/Components/Dashboard/TopBar/UserProfile/UserInfo';
import { IconProp, SizeProp } from 'CommonUI/src/Components/Basic/Icon/Icon';
import IconButton from 'CommonUI/src/Components/Basic/Button/MenuButton/IconButton';

const CreateButton: FunctionComponent = (): ReactElement => {
    return (
        <IconButton icon={IconProp.User} size={SizeProp.Large}>
            <UserInfo name="Username" role="Admin" />
            <MenuItem title="Profile" />
            <MenuItem title="Log out" />
        </IconButton>
    );
};

export default CreateButton;
