import type { FunctionComponent, ReactElement } from 'react';
import React, { useEffect, useState } from 'react';

export interface ComponentProps {
    tabs: Array<string>;
    onTabChange: (tab: string) => void;
}

const Tabs: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [currentTab, setCurrentTab] = useState<string | null>(null);

    useEffect(() => {
        setCurrentTab(props.tabs.length > 0 ? (props.tabs[0] as string) : null);
    }, [props.tabs]);

    useEffect(() => {
        if (currentTab) {
            props.onTabChange && props.onTabChange(currentTab);
        }
    }, [currentTab]);

    return (
        <ul className="nav nav-tabs">
            {props.tabs &&
                props.tabs.length > 0 &&
                props.tabs.map((tab: string, i: number) => {
                    return (
                        <li
                            key={i}
                            className="nav-item"
                            onClick={() => {
                                setCurrentTab(tab);
                            }}
                        >
                            <div
                                className={`${
                                    currentTab === tab ? 'active' : ''
                                } nav-link pointer`}
                            >
                                {tab}
                            </div>
                        </li>
                    );
                })}
        </ul>
    );
};

export default Tabs;
