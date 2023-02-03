import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import HeaderIconDropdownButton from 'CommonUI/src/Components/Header/HeaderIconDropdownButton';
import IconDropdwonItem from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownItem';
import IconDropdwonMenu from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownMenu';
import IconDropdwonRow from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownRow';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import URL from 'Common/Types/API/URL';

const Help: FunctionComponent = (): ReactElement => {
    return (
        <HeaderIconDropdownButton icon={IconProp.Help} name="Help">
            <IconDropdwonMenu>
                <IconDropdwonRow>
                    <IconDropdwonItem
                        title="Support Email"
                        icon={IconProp.Email}
                        url={URL.fromString('mailto:support@oneuptime.com')}
                    />
                    <IconDropdwonItem
                        title="Chat on Slack"
                        icon={IconProp.Slack}
                        url={URL.fromString(
                            'https://join.slack.com/t/oneuptimesupport/shared_invite/zt-1kavkds2f-gegm_wePorvwvM3M_SaoCQ'
                        )}
                    />
                </IconDropdwonRow>
            </IconDropdwonMenu>
        </HeaderIconDropdownButton>
    );
};

export default Help;
