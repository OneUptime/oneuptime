import React, { ReactElement, FunctionComponent } from 'react';
import MenuButton from 'CommonUI/src/Components/Dashboard/TopBar/MenuButton/MenuButton';
import MenuItem from 'CommonUI/src/Components/Basic/Button/MenuButton/MenuItem';
import MenuLegend from 'CommonUI/src/Components/Basic/Button/MenuButton/MenuLegend';

const CreateButton: FunctionComponent = (): ReactElement => {
    return (
        <MenuButton title={'Create'}>
            <MenuLegend title={'Basic'} />
            <MenuItem title="Monitors" />
            <MenuItem title="Incident" />
            <MenuItem title="Status Page" />
            <MenuLegend title={'Advanced'} />
            <MenuItem title="Automated Script" />
            <MenuItem title="Logs" />
        </MenuButton>
    );
};

export default CreateButton;
