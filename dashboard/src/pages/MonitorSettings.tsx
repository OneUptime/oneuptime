import React from 'react';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import { connect } from 'react-redux';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { openModal, closeModal } from '../actions/modal';
import MonitorSla from '../components/monitorSla/MonitorSla';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import { fetchCustomFields } from '../actions/monitorCustomField';
import MonitorCustomFields from '../components/monitor/MonitorCustomFields';

class MonitorSettings extends React.Component {
    state = {
        tabIndex: 0,
    };

    ready = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchCustomFields' does not exist on typ... Remove this comment to see the full error message
        const { fetchCustomFields } = this.props;
        fetchCustomFields(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject && this.props.currentProject._id,
            0,
            10
        );
    };

    componentDidMount() {
        this.ready();
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps?.currentProject?._id !== this.props?.currentProject?._id
        ) {
            this.ready();
        }
    }

    componentWillMount() {
        resetIdCounter();
    }

    tabSelected = (index: $TSFixMe) => {
        const tabSlider = document.getElementById('tab-slider');
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                            this.props.currentProject &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                            this.props.currentProject._id
                                        }
                                    />
                                </Fade>
                            </TabPanel>
                            <TabPanel>
                                <Fade>
                                    <MonitorCustomFields
                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; }' is not assignable to ty... Remove this comment to see the full error message
                                        projectId={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                            this.props.currentProject &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
MonitorSettings.displayName = 'MonitorSettings';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
MonitorSettings.propTypes = {
    location: PropTypes.object.isRequired,
    fetchCustomFields: PropTypes.func,
    currentProject: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
};
const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};
const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        openModal,
        closeModal,
        fetchCustomFields,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(MonitorSettings);
