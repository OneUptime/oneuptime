import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import { loadPage } from '../actions/page';
import { logEvent } from '../analytics';
import { userScheduleRequest, fetchUserSchedule } from '../actions/schedule';
import { IS_SAAS_SERVICE } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import AlertDisabledWarning from '../components/settings/AlertDisabledWarning';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import _ from 'lodash';
import moment from 'moment-timezone';

class Home extends Component {
    componentDidMount() {
        this.props.loadPage('Home');
        if (IS_SAAS_SERVICE) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > HOME');
        }
        this.props.userScheduleRequest();
        if (this.props.currentProjectId && this.props.user.id) {
            this.props.fetchUserSchedule(
                this.props.currentProjectId,
                this.props.user.id
            );
        }
    }

    componentDidUpdate(prevProps) {
        if (
            !prevProps.user.id &&
            this.props.currentProjectId &&
            this.props.user.id
        ) {
            this.props.fetchUserSchedule(
                this.props.currentProjectId,
                this.props.user.id
            );
        }
    }

    render() {
        const {
            escalations,
            location: { pathname },
        } = this.props;

        const user = _.flattenDeep(
            escalations.map(escalation => {
                return escalation.teams.map(team => {
                    return team.teamMembers.map(teamMember => teamMember);
                });
            })
        )
            .filter(user => user.userId === this.props.user.id)
            .shift();

        let startTime, endTime, isUserActive, timezone;
        if (user) {
            startTime = moment(user.startTime)
                .tz(user.timezone)
                .format('HH:mm');
            endTime = moment(user.endTime)
                .tz(user.timezone)
                .format('HH:mm');
            const now = moment()
                .tz(user.timezone)
                .format('HH:mm');
            isUserActive =
                moment(now, 'HH:mm').isAfter(moment(startTime, 'HH:mm')) &&
                moment(now, 'HH:mm').isBefore(moment(endTime, 'HH:mm'));
            timezone = moment(user.startTime)
                .tz(user.timezone)
                .zoneAbbr();
        }

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem route={pathname} name="Home" />
                    <AlertDisabledWarning page="Home" />
                    <div className="Box-root">
                        <div>
                            <div>
                                <div className="db-BackboneViewContainer">
                                    <div className="dashboard-home-view react-view">
                                        <div>
                                            <div>
                                                <span>
                                                    <ShouldRender
                                                        if={
                                                            !this.props
                                                                .escalation
                                                                .requesting
                                                        }
                                                    >
                                                        <div
                                                            className="Box-root Card-shadow--medium"
                                                            tabIndex="0"
                                                        >
                                                            <div className="db-Trends-header">
                                                                <div className="db-Trends-controls">
                                                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                                                <span className="Box-root Flex-flex Flex-direction--row">
                                                                                    <span
                                                                                        id="component-content-header"
                                                                                        className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                                                    >
                                                                                        <span>
                                                                                            {isUserActive
                                                                                                ? 'Active'
                                                                                                : 'Inactive'}
                                                                                        </span>
                                                                                    </span>
                                                                                </span>
                                                                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                    <span>
                                                                                        You
                                                                                        are
                                                                                        active
                                                                                        from{' '}
                                                                                        <b>
                                                                                            {moment(
                                                                                                startTime,
                                                                                                'HH:mm'
                                                                                            ).format(
                                                                                                'hh:mm A'
                                                                                            )}{' '}
                                                                                            (
                                                                                            {
                                                                                                timezone
                                                                                            }

                                                                                            )
                                                                                        </b>{' '}
                                                                                        to{' '}
                                                                                        <b>
                                                                                            {moment(
                                                                                                endTime,
                                                                                                'HH:mm'
                                                                                            ).format(
                                                                                                'hh:mm A'
                                                                                            )}{' '}
                                                                                            (
                                                                                            {
                                                                                                timezone
                                                                                            }

                                                                                            )
                                                                                        </b>{' '}
                                                                                        everyday.
                                                                                    </span>
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </ShouldRender>

                                                    <ShouldRender
                                                        if={
                                                            this.props
                                                                .escalation
                                                                .requesting
                                                        }
                                                    >
                                                        <LoadingState />
                                                    </ShouldRender>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

Home.displayName = 'Home';

Home.propTypes = {
    currentProjectId: PropTypes.string.isRequired,
    user: PropTypes.string.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    loadPage: PropTypes.func,
    userScheduleRequest: PropTypes.func,
    fetchUserSchedule: PropTypes.func,
    escalation: PropTypes.object,
    escalations: PropTypes.array,
};

const mapStateToProps = (state, props) => {
    const { projectId } = props.match.params;

    return {
        currentProjectId: projectId,
        user: state.profileSettings.profileSetting.data,
        escalation: state.schedule.escalation,
        escalations: state.schedule.escalations,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            loadPage,
            userScheduleRequest,
            fetchUserSchedule,
        },
        dispatch
    );
};

export default connect(mapStateToProps, mapDispatchToProps)(Home);
