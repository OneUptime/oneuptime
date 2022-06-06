import React, { ReactElement, FunctionComponent, useState } from 'react';
import OutsideClickHandler from 'react-outside-click-handler';
import { MenuOutlineButton } from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenuButton/MenuButton';
import TopbarMenu from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenu/TopbarMenu';
import MenuItem from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenu/MenuItem';
import {
    faChevronDown,
    faFileInvoice,
    faRecycle,
    faLink,
} from '@fortawesome/free-solid-svg-icons';

const CreateButton: FunctionComponent = (): ReactElement => {
    const [showList, setShowList] = useState(false);
    const toggle: Function = () => {
        return setShowList(!showList);
    };

    return (
        <OutsideClickHandler
            onOutsideClick={() => {
                if (showList) {
                    toggle();
                }
            }}
        >
            <MenuOutlineButton
                text="Create"
                icon={faChevronDown}
                action={toggle}
                showModal={showList}
                modalContent={
                    <TopbarMenu
                        legend="Online Payments"
                        items={[
                            <MenuItem
                                text="Invoice"
                                icon={faFileInvoice}
                                shortcuts={['c', 'i']}
                            />,
                            <MenuItem
                                text="Subscription"
                                icon={faRecycle}
                                shortcuts={['c', 's']}
                            />,
                            <MenuItem
                                text="Payment link"
                                icon={faLink}
                                shortcuts={['c', 'l']}
                            />,
                        ]}
                    />
                }
            />
        </OutsideClickHandler>
    );
};

export default CreateButton;
