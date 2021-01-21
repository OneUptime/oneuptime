import React from 'react';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import Dashboard from '../components/Dashboard';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { openModal, closeModal } from '../actions/modal';
import MonitorSla from '../components/monitorSla/MonitorSla';
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import { fetchCustomFields } from '../actions/monitorCustomField';
import MonitorCustomFields from '../components/monitor/MonitorCustomFields';

class MonitorSettings extends React.Component {
    state = {
        tabIndex: 0,
    };

    ready = () => {
        const { fetchCustomFields, match } = this.props;
        fetchCustomFields(match.params.projectId, 0, 10);
    };

    componentWillMount() {
        resetIdCounter();
    }

    tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };

    render() {
        const {
            location: { pathname },
            match,
        } = this.props;

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <div id="monitorSettingsPage">
                        <BreadCrumbItem route={pathname} name="Monitors" />

                        <div>
                            <Tabs
                                selectedTabClassName={'custom-tab-selected'}
                                onSelect={tabIndex =>
                                    this.tabSelected(tabIndex)
                                }
                                selectedIndex={this.state.tabIndex}
                            >
                                <div className="Flex-flex Flex-direction--columnReverse">
                                    <TabList
                                        id="customTabList"
                                        className={'custom-tab-list'}
                                    >
                                        <Tab
                                            className={
                                                'custom-tab custom-tab-2'
                                            }
                                        >
                                            Monitor SLA
                                        </Tab>
                                        <Tab
                                            className={
                                                'custom-tab custom-tab-2'
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
                                            projectId={match.params.projectId}
                                        />
                                    </Fade>
                                </TabPanel>
                                <TabPanel>
                                    <Fade>
                                        <MonitorCustomFields
                                            projectId={match.params.projectId}
                                        />
                                    </Fade>
                                </TabPanel>
                            </Tabs>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

MonitorSettings.displayName = 'MonitorSettings';
MonitorSettings.propTypes = {
    location: PropTypes.object.isRequired,
    match: PropTypes.object,
    fetchCustomFields: PropTypes.func,
};
const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};
const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal,
            closeModal,
            fetchCustomFields,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(MonitorSettings);
