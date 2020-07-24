import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import moment from 'moment';
import momentTz from 'moment-timezone';
import { currentTimeZone } from '../basic/TimezoneArray';
import NewIncidentMessage from './NewIncidentMessage';
import {
    editIncidentMessageSwitch,
    fetchIncidentMessages,
} from '../../actions/incident';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { logEvent } from '../../analytics';
import { User } from '../../config';
import { ListLoader } from '../basic/Loader';

export class IncidentInvestigation extends Component {
    olderInvestigationMessage = () => {
        this.props.fetchIncidentMessages(
            this.props.currentProject._id,
            this.props.incident._id,
            parseInt(this.props.incidentMessages.skip, 10) +
                parseInt(this.props.incidentMessages.limit, 10),
            parseInt(this.props.incidentMessages.limit, 10)
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > OLDER INVESTIGATION MESSAGES CLICKED',
                {
                    projectId: this.props.currentProject._id,
                    incidentId: this.props.incident._id,
                }
            );
        }
    };

    newerInvestigationMessage = () => {
        this.props.fetchIncidentMessages(
            this.props.currentProject._id,
            this.props.incident._id,
            parseInt(this.props.incidentMessages.skip, 10) -
                parseInt(this.props.incidentMessages.limit, 10),
            parseInt(this.props.incidentMessages.limit, 10)
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > NEWER INVESTIGATION MESSAGES CLICKED',
                {
                    projectId: this.props.currentProject._id,
                    incidentId: this.props.incident._id,
                }
            );
        }
    };
    render() {
        let count = 0;
        let skip = 0;
        let limit = 0;
        let requesting = false;
        let canSeeOlder = false;
        let canSeeNewer = false;
        let error;
        const { incidentMessages, editIncidentMessageSwitch } = this.props;
        if (incidentMessages) {
            count = incidentMessages.count;
            skip = incidentMessages.skip;
            limit = incidentMessages.limit;
            requesting = incidentMessages.requesting;
            error = incidentMessages.error;

            if (count && typeof count === 'string') {
                count = parseInt(count, 10);
            }
            if (skip && typeof skip === 'string') {
                skip = parseInt(skip, 10);
            }
            if (limit && typeof limit === 'string') {
                limit = parseInt(limit, 10);
            }

            if (!skip) skip = 0;
            if (!limit) limit = 10;

            canSeeOlder = count > skip + limit ? true : false;
            canSeeNewer = skip <= 0 ? false : true;

            if (requesting || count < 1) {
                canSeeOlder = false;
                canSeeNewer = false;
            }
        }

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Investigation</span>
                                </span>
                                <p>
                                    <span>
                                        Tell us more about what went wrong.
                                    </span>
                                </p>
                            </div>
                        </div>

                        <div className="bs-ContentSection-content">
                            {incidentMessages &&
                                incidentMessages.incidentMessages.map(
                                    (incidentMessage, index) => {
                                        return (
                                            <div
                                                id={`investigation_message_${index}`}
                                                key={index}
                                                className={`${
                                                    !incidentMessage.editMode &&
                                                    index % 2 === 0
                                                        ? 'Box-background--offset '
                                                        : 'Box-background--white'
                                                }Box-root Box-divider--surface-bottom-1 Padding-horizontal--20 Padding-vertical--8`}
                                            >
                                                <ShouldRender
                                                    if={
                                                        !incidentMessage.editMode
                                                    }
                                                >
                                                    <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                                        <div className="Box-root Margin-right--16">
                                                            <img
                                                                src="/dashboard/assets/img/profile-user.svg"
                                                                className="userIcon"
                                                                alt="user_image"
                                                                style={{
                                                                    marginBottom:
                                                                        '-5px',
                                                                }}
                                                            />
                                                            <span>
                                                                {incidentMessage
                                                                    .createdById
                                                                    .name
                                                                    ? incidentMessage
                                                                          .createdById
                                                                          .name
                                                                    : 'Unknown User'}
                                                            </span>
                                                        </div>
                                                        <div className="Box-root Margin-right--16">
                                                            <span>
                                                                <strong>
                                                                    {currentTimeZone
                                                                        ? momentTz(
                                                                              incidentMessage.createdAt
                                                                          )
                                                                              .tz(
                                                                                  currentTimeZone
                                                                              )
                                                                              .format(
                                                                                  'lll'
                                                                              )
                                                                        : moment(
                                                                              incidentMessage.createdAt
                                                                          ).format(
                                                                              'lll'
                                                                          )}
                                                                </strong>{' '}
                                                                (
                                                                {moment(
                                                                    incidentMessage.createdAt
                                                                ).fromNow()}
                                                                )
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                                        <div
                                                            style={{
                                                                padding:
                                                                    '0px 30px',
                                                            }}
                                                        >
                                                            <p>
                                                                {' '}
                                                                {
                                                                    incidentMessage.content
                                                                }
                                                                <ShouldRender
                                                                    if={
                                                                        incidentMessage.updated
                                                                    }
                                                                >
                                                                    <span className="Margin-horizontal--4 Text-color--dark">
                                                                        (edited)
                                                                    </span>
                                                                </ShouldRender>
                                                            </p>
                                                            <ShouldRender
                                                                if={
                                                                    User.getUserId() ===
                                                                    incidentMessage
                                                                        .createdById
                                                                        ._id
                                                                }
                                                            >
                                                                <p
                                                                    style={{
                                                                        cursor:
                                                                            'pointer',
                                                                    }}
                                                                    onClick={() =>
                                                                        editIncidentMessageSwitch(
                                                                            incidentMessage
                                                                        )
                                                                    }
                                                                >
                                                                    <img
                                                                        src="/dashboard/assets/img/edit.svg"
                                                                        className="Margin-right--8"
                                                                        style={{
                                                                            height:
                                                                                '10px',
                                                                            width:
                                                                                '10px',
                                                                        }}
                                                                    />
                                                                    Edit
                                                                    Response
                                                                </p>
                                                            </ShouldRender>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        incidentMessage.editMode
                                                    }
                                                >
                                                    <NewIncidentMessage
                                                        incident={
                                                            this.props.incident
                                                        }
                                                        type={'investigation'}
                                                        edit={true}
                                                        incidentMessage={
                                                            incidentMessage
                                                        }
                                                        formId={
                                                            incidentMessage._id
                                                        }
                                                    />
                                                </ShouldRender>
                                            </div>
                                        );
                                    }
                                )}
                        </div>
                        {requesting ? <ListLoader /> : null}

                        <div
                            style={{
                                textAlign: 'center',
                                padding: '0 10px',
                                margin: '10px 0',
                            }}
                        >
                            {incidentMessages &&
                            incidentMessages.incidentMessages &&
                            incidentMessages.incidentMessages.length < 1
                                ? "You don't have any messages yet, start up a conversation."
                                : null}
                            {error}
                        </div>
                        <ShouldRender if={count > 0}>
                            <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span></span>
                                    </span>
                                </div>
                                <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                        <div className="Box-root Margin-right--8">
                                            <button
                                                id="btnTimelinePrev"
                                                onClick={() => {
                                                    this.olderInvestigationMessage();
                                                }}
                                                className={
                                                    'Button bs-ButtonLegacy' +
                                                    (canSeeOlder
                                                        ? ''
                                                        : 'Is--disabled')
                                                }
                                                disabled={!canSeeOlder}
                                                data-db-analytics-name="list_view.pagination.previous"
                                                type="button"
                                            >
                                                <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                    <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                        <span>
                                                            Older Messages
                                                        </span>
                                                    </span>
                                                </div>
                                            </button>
                                        </div>
                                        <div className="Box-root">
                                            <button
                                                id="btnTimelineNext"
                                                onClick={() => {
                                                    this.newerInvestigationMessage();
                                                }}
                                                className={
                                                    'Button bs-ButtonLegacy' +
                                                    (canSeeNewer
                                                        ? ''
                                                        : 'Is--disabled')
                                                }
                                                disabled={!canSeeNewer}
                                                data-db-analytics-name="list_view.pagination.next"
                                                type="button"
                                            >
                                                <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                    <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                        <span>
                                                            Newer Messages
                                                        </span>
                                                    </span>
                                                </div>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </ShouldRender>
                        <NewIncidentMessage
                            incident={this.props.incident}
                            type={'investigation'}
                            formId="NewInvestigationForm"
                        />
                    </div>
                </div>
            </div>
        );
    }
}

IncidentInvestigation.displayName = 'IncidentInvestigation';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            editIncidentMessageSwitch,
            fetchIncidentMessages,
        },
        dispatch
    );

function mapStateToProps(state, ownProps) {
    const incidentMessages = state.incident.incidentMessages
        ? state.incident.incidentMessages[ownProps.incident._id]
            ? state.incident.incidentMessages[ownProps.incident._id][
                  'investigation'
              ]
            : {}
        : {};
    const currentProject = state.project.currentProject;
    return {
        incidentMessages,
        currentProject,
    };
}

IncidentInvestigation.propTypes = {
    incident: PropTypes.object.isRequired,
    incidentMessages: PropTypes.object,
    currentProject: PropTypes.object,
    editIncidentMessageSwitch: PropTypes.func,
    fetchIncidentMessages: PropTypes.func,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentInvestigation);
