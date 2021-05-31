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
        pathName.split('automateScript/')[1].split('-')[0] || null;

    const [tabIndex, setTabIndex] = useState(0);
    // useEffect(() => {
    //     console.log(pathName, 'history done come');
    // }, []);
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
                <BreadCrumbItem
                    route={parentRoute}
                    name="Automation Script Details"
                />
                <BreadCrumbItem
                    route={history.location.pathname}
                    name={scriptName}
                    status={''}
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
                                    'custom-tab custom-tab-6 subscribers-tab'
                                }
                            >
                                Subscribers
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 announcements-tab'
                                }
                            >
                                Announcements
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 custom-domains-tab'
                                }
                            >
                                Custom Domains
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 branding-tab'
                                }
                            >
                                Branding
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 embedded-tab'
                                }
                            >
                                Embedded
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
                                                            <div className="Box-root Margin-bottom--12 bs-ContentSection Card-root Card-shadow--medium>">
                                                                <p>two</p>
                                                            </div>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <div>
                                                                <p>three</p>
                                                            </div>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <Fade>
                                                                <div className="Box-root Margin-bottom--12">
                                                                    <p>four</p>
                                                                </div>
                                                            </Fade>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <Fade>
                                                                <p>five</p>
                                                            </Fade>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <Fade>
                                                                <div className="Box-root Margin-bottom--12">
                                                                    <p>six</p>
                                                                </div>
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
