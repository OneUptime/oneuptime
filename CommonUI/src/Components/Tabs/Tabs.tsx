import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import TabElement, { Tab } from './Tab';

export interface ComponentProps {
    tabs: Array<Tab>;
    onTabChange: (tab: Tab) => void;
}

const Tabs: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [currentTab, setCurrentTab] = useState<Tab | null>(null);

    useEffect(() => {
        setCurrentTab(props.tabs.length > 0 ? (props.tabs[0] as Tab) : null);
    }, [props.tabs]);

    useEffect(() => {
        if (currentTab) {
            props.onTabChange && props.onTabChange(currentTab);
        }
    }, [currentTab]);

    return (
        <div>
            <div className="sm:hidden">
                <label htmlFor="tabs" className="sr-only">
                    Select a tab
                </label>
                {/* Use an "onChange" listener to redirect the user to the selected tab URL. */}
                <select
                    id="tabs"
                    name="tabs"
                    className="block w-full rounded-md border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
                    defaultValue={currentTab?.name || ''}
                    onChange={(event) => {

                        const selectedTab = props.tabs.find(
                            (tab) => tab.name === event.target.value
                        );

                        if (!selectedTab) {
                            return;
                        }

                        setCurrentTab(selectedTab);
                    }}
                >
                    {props.tabs.map((tab) => (
                        <option key={tab.name}>{tab.name}</option>
                    ))}
                </select>
            </div>
            <div className="hidden sm:block">
                <nav className="flex space-x-4" aria-label="Tabs">
                    {props.tabs.map((tab) => (
                        <TabElement key={tab.name} tab={tab} onClick={()=>{
                            setCurrentTab(tab);
                        }} isSelected={tab === currentTab} />
                    ))}
                </nav>
            </div>
        </div>
    );
};

export default Tabs;
