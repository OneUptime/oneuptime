import React, { Component } from 'react';

import { PropTypes } from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { Fade } from 'react-awesome-reveal';
import RoutingNumberBox from '../components/callrouting/RoutingNumberBox';
import CallRoutingLog from '../components/callrouting/CallRoutingLog';


import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import {
    getCallRoutingNumbers,
    getTeamAndSchedules,
    getCallRoutingLogs,
} from '../actions/callRouting';

interface CallRoutingProps {
    currentProject?: {
        _id?: any,
        name?: any,
        slug?: any
    };
    getCallRoutingLogs?: Function;
    getCallRoutingNumbers?: Function;
    getTeamAndSchedules?: Function;
    location?: {
        pathname?: string
    };
    match?: {
        params?: {
            projectId?: {
                length?: any
            }
        }
    };
    switchToProjectViewerNav?: boolean;
}

class CallRouting extends Component<CallRoutingProps> {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
        this.state = {
            tabIndex: 0,
        };
    }

    componentWillMount() {
        resetIdCounter();
    }

    componentDidMount() {
        this.ready();
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (

            prevProps?.currentProject?._id !== this.props?.currentProject?._id
        ) {
            this.ready();
        }
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
    };

    tabSelected = (index: $TSFixMe) => {
        const tabSlider = document.getElementById('tab-slider');

        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };

    render() {
        const {

            location: { pathname },

            currentProject,

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

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem

                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="Call Routing" />
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
        );
    }
}


CallRouting.propTypes = {
    currentProject: PropTypes.shape({
        _id: PropTypes.any,
        name: PropTypes.any,
        slug: PropTypes.any,
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
    switchToProjectViewerNav: PropTypes.bool,
};


CallRouting.displayName = 'CallRouting';

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    { getCallRoutingNumbers, getTeamAndSchedules, getCallRoutingLogs },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(CallRouting);
