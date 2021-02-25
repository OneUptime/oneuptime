import React, { Component } from 'react';
import { PropTypes } from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import RoutingNumberBox from '../components/callrouting/RoutingNumberBox';
import CallRoutingLog from '../components/callrouting/CallRoutingLog';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import {
    getCallRoutingNumbers,
    getTeamAndSchedules,
    getCallRoutingLogs,
} from '../actions/callRouting';

class CallRouting extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            tabIndex: 0,
        };
    }

    componentWillMount() {
        resetIdCounter();
    }

    ready = () => {
        const { match, currentProject } = this.props;
        const projectId =
            match.params.projectId && match.params.projectId.length
                ? match.params.projectId
                : currentProject && currentProject._id
                ? currentProject._id
                : null;
        this.props.getCallRoutingNumbers(projectId);
        this.props.getTeamAndSchedules(projectId);
        this.props.getCallRoutingLogs(projectId, 0, 10);
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > SETTINGS > CALLROUTING');
        }
    };

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
        } = this.props;

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <BreadCrumbItem route={pathname} name="Call Routing" />
                    <div>
                        <Tabs
                            selectedTabClassName={'custom-tab-selected'}
                            onSelect={tabIndex => this.tabSelected(tabIndex)}
                            selectedIndex={this.state.tabIndex}
                        >
                            <div className="Flex-flex Flex-direction--columnReverse">
                                <TabList
                                    id="customTabList"
                                    className={'custom-tab-list'}
                                >
                                    <Tab className={'custom-tab custom-tab-2'}>
                                        Call Routing
                                    </Tab>
                                    <Tab className={'custom-tab custom-tab-2'}>
                                        Call Routing Logs
                                    </Tab>
                                    <div
                                        id="tab-slider"
                                        className="custom-tab-2"
                                    ></div>
                                </TabList>
                            </div>
                            <TabPanel>
                                <Fade>
                                    <RoutingNumberBox />
                                </Fade>
                            </TabPanel>
                            <TabPanel>
                                <Fade>
                                    <CallRoutingLog />
                                </Fade>
                            </TabPanel>
                        </Tabs>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

CallRouting.propTypes = {
    currentProject: PropTypes.shape({
        _id: PropTypes.any,
    }),
    getCallRoutingLogs: PropTypes.func,
    getCallRoutingNumbers: PropTypes.func,
    getTeamAndSchedules: PropTypes.func,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    match: PropTypes.shape({
        params: PropTypes.shape({
            projectId: PropTypes.shape({
                length: PropTypes.any,
            }),
        }),
    }),
};

CallRouting.displayName = 'CallRouting';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { getCallRoutingNumbers, getTeamAndSchedules, getCallRoutingLogs },
        dispatch
    );

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(CallRouting);
