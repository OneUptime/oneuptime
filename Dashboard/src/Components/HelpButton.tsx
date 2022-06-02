import React, { FunctionComponent, ReactElement, useState } from 'react';
import OutsideClickHandler from 'react-outside-click-handler';
import MenuButton from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenuButton/MenuButton';
import MenuLinkItem from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenu/MenuLinkItem';
import { faQuestionCircle } from '@fortawesome/free-solid-svg-icons';
import TopbarMenu from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenu/TopbarMenu';

const HelpButton: FunctionComponent = (): ReactElement => {
    const [showList, setShowList] = useState(false);
    const toggle = () => setShowList(!showList);

    return (
        <OutsideClickHandler
            onOutsideClick={() => {
                if (showList) {
                    toggle();
                }
            }}
        >
            <MenuButton
                icon={faQuestionCircle}
                onClick={toggle}
                showModal={showList}
                modalContent={
                    <>
                        <TopbarMenu
                            legend="Resources"
                            items={[
                                <MenuLinkItem
                                    text="Support articles"
                                    openInNewTab={true}
                                />,
                                <MenuLinkItem
                                    text="Developer docs"
                                    openInNewTab={true}
                                />,
                                <MenuLinkItem text="Keyboard shortcuts" />,
                            ]}
                        />
                        <hr />
                        <TopbarMenu
                            legend="Get in touch"
                            items={[<MenuLinkItem text="Share feedback" />]}
                        />
                    </>
                }
            />
        </OutsideClickHandler>
    );
};

export default HelpButton;
