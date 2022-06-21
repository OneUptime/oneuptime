import React, { FunctionComponent, ReactElement } from 'react';
import HeaderIconDropdownButton from 'CommonUI/src/Components/Header/HeaderIconDropdownButton';
import IconDropdwonItem from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownItem';
import IconDropdwonMenu from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownMenu';
import IconDropdwonRow from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownRow';
import { IconProp } from 'CommonUI/src/Components/Basic/Icon/Icon';
import URL from 'Common/Types/API/URL';

const Help: FunctionComponent = (): ReactElement => {
    return (
        <HeaderIconDropdownButton icon={IconProp.Help}>
        <IconDropdwonMenu>
            <IconDropdwonRow>
                <IconDropdwonItem
                    title="Support Email"
                    icon={IconProp.Email}
                    url={URL.fromString('https://google.com')}
                />
                <IconDropdwonItem
                    title="Chat on Slack"
                    icon={IconProp.Slack}
                    url={URL.fromString('https://google.com')}
                />
            </IconDropdwonRow>
        </IconDropdwonMenu>
    </HeaderIconDropdownButton>
       
    );
};

export default Help;
