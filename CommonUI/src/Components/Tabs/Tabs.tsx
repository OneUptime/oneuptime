import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';

export interface ComponentProps {
    tabs: Array<string>;
    onTabChange: (tab: string) => void;
}

const Tabs: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    const [currentTab, setCurrentTab] = useState<string | null>(null);

    useEffect(() => {
        setCurrentTab(props.tabs.length > 0 ? props.tabs[0] as string : null);
    }, [props.tabs]);

    useEffect(() => {
        if (currentTab) {
            props.onTabChange && props.onTabChange(currentTab);
        }
    }, [currentTab]);

    return (<ul className="nav nav-tabs">
        {props.tabs && props.tabs.length > 0 && props.tabs.map((tab: string) => {
            return (<li className="nav-item" onClick={() => {
                setCurrentTab(tab);
            }}>
                <a className={`${currentTab === tab ? 'active' : ''} nav-link pointer`}>{tab}</a>
            </li>)
        })}
    </ul>)
};

export default Tabs;
