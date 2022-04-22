import React from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';

import { Fade } from 'react-awesome-reveal';
import { connect } from 'react-redux';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../Utils/getParentRoute';
import { openModal, closeModal } from '../actions/modal';
import MonitorSla from '../components/monitorSla/MonitorSla';

import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import { fetchCustomFields } from '../actions/monitorCustomField';
import MonitorCustomFields from '../components/monitor/MonitorCustomFields';

interface MonitorSettingsProps {
    location: object;
    fetchCustomFields?: Function;
    currentProject?: object;
    switchToProjectViewerNav?: boolean;
}

class MonitorSettings extends React.Component<MonitorSettingsProps> {
    state = {
        tabIndex: 0,
    };

    ready = () => {

        const { fetchCustomFields }: $TSFixMe = this.props;
        fetchCustomFields(

            this.props.currentProject && this.props.currentProject._id,
            0,
            10
        );
    };

    override componentDidMount() {
        this.ready();
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (

            prevProps?.currentProject?._id !== this.props?.currentProject?._id
        ) {
            this.ready();
        }
    }

    componentWillMount() {
        resetIdCounter();
    }

    tabSelected = (index: $TSFixMe) => {
        const tabSlider: $TSFixMe = document.getElementById('tab-slider');

        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };

    override render() {
        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
        const projectName: $TSFixMe = currentProject ? currentProject.name : '';
        const projectId: $TSFixMe = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem

                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <div id="monitorSettingsPage">
                    <BreadCrumbItem route={pathname} name="Monitors" />

                    <div>
                        <Tabs
                            selectedTabClassName={'custom-tab-selected'}
                            onSelect={(tabIndex: $TSFixMe) => this.tabSelected(tabIndex)}
                            selectedIndex={this.state.tabIndex}
                        >
                            <div className="Flex-flex Flex-direction--columnReverse">
                                <TabList
                                    id="customTabList"
                                    className={'custom-tab-list'}
                                >
                                    <Tab
                                        className={
                                            'custom-tab custom-tab-2 monitor-sla'
                                        }
                                    >
                                        Monitor SLA
                                    </Tab>
                                    <Tab
                                        className={
                                            'custom-tab custom-tab-2 monitor-sla-advanced'
                                        }
                                    >
                                        Advanced
                                    </Tab>
                                    <div
                                        id="tab-slider"
                                        className="custom-tab-2"
                                    ></div>
                                </TabList>
                            </div>
                            <TabPanel>
                                <Fade>
                                    <MonitorSla
                                        projectId={

                                            this.props.currentProject &&

                                            this.props.currentProject._id
                                        }
                                    />
                                </Fade>
                            </TabPanel>
                            <TabPanel>
                                <Fade>
                                    <MonitorCustomFields

                                        projectId={

                                            this.props.currentProject &&

                                            this.props.currentProject._id
                                        }
                                    />
                                </Fade>
                            </TabPanel>
                        </Tabs>
                    </div>
                </div>
            </Fade>
        );
    }
}


MonitorSettings.displayName = 'MonitorSettings';

MonitorSettings.propTypes = {
    location: PropTypes.object.isRequired,
    fetchCustomFields: PropTypes.func,
    currentProject: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
};
const mapStateToProps: Function = (state: RootState) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};
const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
        closeModal,
        fetchCustomFields,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(MonitorSettings);
