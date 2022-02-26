import React, { Component } from 'react';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import RoutingNumberBox from '../components/callrouting/RoutingNumberBox';
import CallRoutingLog from '../components/callrouting/CallRoutingLog';

// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import {
    getCallRoutingNumbers,
    getTeamAndSchedules,
    getCallRoutingLogs,
} from '../actions/callRouting';

class CallRouting extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps?.currentProject?._id !== this.props?.currentProject?._id
        ) {
            this.ready();
        }
    }

    ready = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { match, currentProject } = this.props;
        const projectId =
            match.params.projectId && match.params.projectId.length
                ? match.params.projectId
                : currentProject && currentProject._id
                ? currentProject._id
                : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getCallRoutingNumbers' does not exist on... Remove this comment to see the full error message
        this.props.getCallRoutingNumbers(projectId);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getTeamAndSchedules' does not exist on t... Remove this comment to see the full error message
        this.props.getTeamAndSchedules(projectId);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getCallRoutingLogs' does not exist on ty... Remove this comment to see the full error message
        this.props.getCallRoutingLogs(projectId, 0, 10);
    };

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
                <BreadCrumbItem route={pathname} name="Call Routing" />
                <div>
                    <Tabs
                        selectedTabClassName={'custom-tab-selected'}
                        onSelect={(tabIndex: $TSFixMe) => this.tabSelected(tabIndex)}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'tabIndex' does not exist on type 'Readon... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
CallRouting.displayName = 'CallRouting';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
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
