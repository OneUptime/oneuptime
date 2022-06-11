import React, {
    ReactElement,
    FunctionComponent,
    useState,
    MouseEventHandler,
} from 'react';
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
       
            <MenuOutlineButton
                text="Create"
                icon={faChevronDown}
                onClick={toggle as MouseEventHandler}
                showModal={showList}
                modalContent={
                    <TopbarMenu
                        legend="Online Payments"
                        items={[
                            <MenuItem
                                text="Invoice"
                                icon={faFileInvoice}
                                shortcuts={['c', 'i']}
                                key={1}
                            />,
                            <MenuItem
                                text="Subscription"
                                icon={faRecycle}
                                shortcuts={['c', 's']}
                                key={2}
                            />,
                            <MenuItem
                                text="Payment link"
                                icon={faLink}
                                shortcuts={['c', 'l']}
                                key={3}
                            />,
                        ]}
                    />
                }
            />
       
    );
};

export default CreateButton;
