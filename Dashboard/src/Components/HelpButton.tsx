import React, {
    FunctionComponent,
    MouseEventHandler,
    ReactElement,
    useState,
} from 'react';
import OutsideClickHandler from 'react-outside-click-handler';
import MenuButton from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenuButton/MenuButton';
import MenuLinkItem from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenu/MenuLinkItem';
import { faQuestionCircle } from '@fortawesome/free-solid-svg-icons';
import TopbarMenu from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenu/TopbarMenu';

const HelpButton: FunctionComponent = (): ReactElement => {
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
            <MenuButton
                text="Help"
                icon={faQuestionCircle}
                onClick={toggle as MouseEventHandler}
                showModal={showList}
                modalContent={
                    <>
                        <TopbarMenu
                            legend="Resources"
                            items={[
                                <MenuLinkItem
                                    key={1}
                                    text="Support articles"
                                    openInNewTab={true}
                                />,
                                <MenuLinkItem
                                    key={2}
                                    text="Developer docs"
                                    openInNewTab={true}
                                />,
                                <MenuLinkItem
                                    key={1}
                                    text="Keyboard shortcuts"
                                />,
                            ]}
                        />
                        <hr />
                        <TopbarMenu
                            legend="Get in touch"
                            items={[
                                <MenuLinkItem key={1} text="Share feedback" />,
                            ]}
                        />
                    </>
                }
            />
        </OutsideClickHandler>
    );
};

export default HelpButton;
