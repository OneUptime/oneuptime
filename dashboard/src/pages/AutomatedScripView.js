import React, { useState } from 'react';
import Dashboard from '../components/Dashboard';
import Fade from 'react-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import PropTypes from 'prop-types';
import getParentRoute from '../utils/getParentRoute';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import DeleteScriptBox from '../components/automationScript/DeleteScriptBox';

const AutomatedScripView = props => {
    const { history } = props;
    const pathName = history.location.pathname;
    const parentRoute = getParentRoute(history.location.pathname);
    const scriptName =
        pathName.split('automation-scripts/')[1].split('-')[0] || null;

    const [tabIndex, setTabIndex] = useState(0);
    const tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');

        setTimeout(() => {
            tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        });
        setTabIndex(index);
    };
    return (
        <Dashboard>
            <Fade>
                <BreadCrumbItem route={parentRoute} name="Automation Scripts" />
                <BreadCrumbItem
                    route={history.location.pathname}
                    name={scriptName}
                    pageTitle="Automation Scripts"
                />
                <Tabs
                    selectedTabClassName={'custom-tab-selected'}
                    onSelect={tab => tabSelected(tab)}
                    selectedIndex={tabIndex}
                >
                    <div className="Flex-flex Flex-direction--columnReverse">
                        <TabList
                            id="customTabList"
                            className={'custom-tab-list'}
                        >
                            <Tab
                                className={'custom-tab custom-tab-6 basic-tab'}
                            >
                                Basic
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 advanced-options-tab'
                                }
                            >
                                Advanced Options
                            </Tab>
                            <div
                                id="tab-slider"
                                className="custom-tab-6 status-tab"
                            ></div>
                        </TabList>
                    </div>

                    <div className="Box-root">
                        <div>
                            <div>
                                <div className="db-BackboneViewContainer">
                                    <div className="react-settings-view react-view">
                                        <span data-reactroot="">
                                            <div>
                                                <div>
                                                    <ShouldRender if={true}>
                                                        <TabPanel>
                                                            <Fade>
                                                                <p>one</p>
                                                            </Fade>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <Fade>
                                                                <DeleteScriptBox
                                                                    {...props}
                                                                    name={
                                                                        scriptName
                                                                    }
                                                                    parentRoute={
                                                                        parentRoute
                                                                    }
                                                                />
                                                            </Fade>
                                                        </TabPanel>
                                                    </ShouldRender>
                                                    <ShouldRender if={false}>
                                                        <LoadingState />
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Tabs>
            </Fade>
        </Dashboard>
    );
};

AutomatedScripView.propTypes = {
    // scripts: PropTypes.array.isRequired,
    history: PropTypes.object.isRequired,
    // deleteAutomatedScript: PropTypes.func.isRequired,
};

export default AutomatedScripView;
