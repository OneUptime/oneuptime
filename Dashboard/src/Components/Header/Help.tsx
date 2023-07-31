import React, { FunctionComponent, ReactElement, useState } from 'react';
import HeaderIconDropdownButton from 'CommonUI/src/Components/Header/HeaderIconDropdownButton';
import IconDropdownItem from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownItem';
import IconDropdownMenu from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownMenu';
import IconDropdownRow from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownRow';
import IconProp from 'Common/Types/Icon/IconProp';
import URL from 'Common/Types/API/URL';

const Help: FunctionComponent = (): ReactElement => {
    const [isDropdownVisible, setIsDropdownVisible] = useState<boolean>(false);

    return (
        <HeaderIconDropdownButton
            icon={IconProp.Help}
            name="Help"
            showDropdown={isDropdownVisible}
            onClick={() => {
                setIsDropdownVisible(true);
            }}
        >
            <IconDropdownMenu>
                <IconDropdownRow>
                    <IconDropdownItem
                        title="Support Email"
                        icon={IconProp.Email}
                        openInNewTab={true}
                        url={URL.fromString('mailto:support@oneuptime.com')}
                        onClick={() => {
                            setIsDropdownVisible(false);
                        }}
                    />
                    <IconDropdownItem
                        title="Chat on Slack"
                        icon={IconProp.Slack}
                        openInNewTab={true}
                        onClick={() => {
                            setIsDropdownVisible(false);
                        }}
                        url={URL.fromString(
                            'https://join.slack.com/t/oneuptimesupport/shared_invite/zt-1kavkds2f-gegm_wePorvwvM3M_SaoCQ'
                        )}
                    />
                    <IconDropdownItem
                        title="Request Demo"
                        icon={IconProp.Window}
                        onClick={() => {
                            setIsDropdownVisible(false);
                        }}
                        openInNewTab={true}
                        url={URL.fromString(
                            'https://oneuptime.com/enterprise/demo'
                        )}
                    />
                </IconDropdownRow>
            </IconDropdownMenu>
        </HeaderIconDropdownButton>
    );
};

export default Help;
