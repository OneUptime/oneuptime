import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    fetchIncidentMessages,
    deleteIncidentMessage,
} from '../../actions/incident';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { logEvent } from '../../analytics';
import IncidentMessageThread from './IncidentMessageThread';
import { openModal } from '../../actions/modal';
import { v4 as uuidv4 } from 'uuid';

export class IncidentInternal extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            createMessageModalId: uuidv4(),
            editMessageModalId: uuidv4(),
            deleteMessageModalId: uuidv4(),
        };
    }
    olderInternalMessage = () => {
        this.props.fetchIncidentMessages(
            this.props.currentProject._id,
            this.props.incident._id,
            parseInt(this.props.incidentMessages.skip, 10) -
                parseInt(this.props.incidentMessages.limit, 10),
            parseInt(this.props.incidentMessages.limit, 10),
            'internal'
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > OLDER INTERNAL MESSAGES CLICKED',
                {
                    projectId: this.props.currentProject._id,
                    incidentId: this.props.incident._id,
                }
            );
        }
    };

    newerInternalMessage = () => {
        this.props.fetchIncidentMessages(
            this.props.currentProject._id,
            this.props.incident._id,
            parseInt(this.props.incidentMessages.skip, 10) +
                parseInt(this.props.incidentMessages.limit, 10),
            parseInt(this.props.incidentMessages.limit, 10),
            'internal'
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > NEWER INTERNAL MESSAGES CLICKED',
                {
                    projectId: this.props.currentProject._id,
                    incidentId: this.props.incident._id,
                }
            );
        }
    };
    deleteInvestigationMessage = incidentMessageId => {
        const promise = this.props.deleteIncidentMessage(
            this.props.currentProject._id,
            this.props.incident._id,
            incidentMessageId
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > INTERNAL MESSAGE DELETED',
                {
                    ProjectId: this.props.currentProject._id,
                    incidentMessageId: incidentMessageId,
                }
            );
        }
        return promise;
    };
    render() {
        let count = 0;
        let skip = 0;
        let limit = 0;
        let requesting = false;
        let canPrev = false;
        let canNext = false;
        let error;
        const { incidentMessages, incident, openModal } = this.props;
        const {
            createMessageModalId,
            editMessageModalId,
            deleteMessageModalId,
        } = this.state;
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
            canNext = count > skip + limit ? true : false;
            canPrev = skip <= 0 ? false : true;

            if (requesting || count < 1) {
                canNext = false;
                canPrev = false;
            }
        }

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <IncidentMessageThread
                        title="Investigation and Postmortem"
                        description="Add notes and collaborate with members who are working on this incident."
                        incidentMessages={incidentMessages}
                        count={count}
                        canPrev={canPrev}
                        canNext={canNext}
                        requesting={requesting}
                        incident={incident}
                        type={'internal'}
                        error={error}
                        newerMessage={this.newerInternalMessage}
                        olderMessage={this.olderInternalMessage}
                        createMessageModalId={createMessageModalId}
                        openModal={openModal}
                        editMessageModalId={editMessageModalId}
                        deleteMessageModalId={deleteMessageModalId}
                        deleteIncidentMessage={this.deleteInvestigationMessage}
                    />
                </div>
            </div>
        );
    }
}

IncidentInternal.displayName = 'IncidentInternal';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchIncidentMessages,
            openModal,
            deleteIncidentMessage,
        },
        dispatch
    );

function mapStateToProps(state, ownProps) {
    const incidentMessages = state.incident.incidentMessages
        ? state.incident.incidentMessages[ownProps.incident._id]
            ? state.incident.incidentMessages[ownProps.incident._id]['internal']
            : {}
        : {};
    const currentProject = state.project.currentProject;
    return {
        incidentMessages,
        currentProject,
    };
}

IncidentInternal.propTypes = {
    incident: PropTypes.object.isRequired,
    incidentMessages: PropTypes.object,
    currentProject: PropTypes.object,
    fetchIncidentMessages: PropTypes.func,
    openModal: PropTypes.func,
    deleteIncidentMessage: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentInternal);
