import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    fetchIncidentMessages,
    deleteIncidentMessage,
} from '../../actions/incident';

import IncidentMessageThread from './IncidentMessageThread';
import { openModal } from '../../actions/modal';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { fetchIncidentNoteTemplates } from '../../actions/incidentNoteTemplate';

export class IncidentInternal extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            createMessageModalId: uuidv4(),
            editMessageModalId: uuidv4(),
            deleteMessageModalId: uuidv4(),
        };
    }
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, fetchIncidentNoteTemplates } = this.props;
        if (currentProject) {
            fetchIncidentNoteTemplates({
                projectId: currentProject._id,
                skip: 0,
                limit: 0,
            });
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            JSON.stringify(prevProps.currentProject) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            JSON.stringify(this.props.currentProject)
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            if (this.props.currentProject) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentNoteTemplates' does not exi... Remove this comment to see the full error message
                this.props.fetchIncidentNoteTemplates({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    projectId: this.props.currentProject._id,
                    skip: 0,
                    limit: 0,
                });
            }
        }
    }
    olderInternalMessage = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentMessages' does not exist on... Remove this comment to see the full error message
        this.props.fetchIncidentMessages(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject._id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident.slug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessages' does not exist on type... Remove this comment to see the full error message
            parseInt(this.props.incidentMessages.skip, 10) -
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessages' does not exist on type... Remove this comment to see the full error message
                parseInt(this.props.incidentMessages.limit, 10),
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessages' does not exist on type... Remove this comment to see the full error message
            parseInt(this.props.incidentMessages.limit, 10),
            'internal'
        );
    };

    newerInternalMessage = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentMessages' does not exist on... Remove this comment to see the full error message
        this.props.fetchIncidentMessages(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject._id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident.slug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessages' does not exist on type... Remove this comment to see the full error message
            parseInt(this.props.incidentMessages.skip, 10) +
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessages' does not exist on type... Remove this comment to see the full error message
                parseInt(this.props.incidentMessages.limit, 10),
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessages' does not exist on type... Remove this comment to see the full error message
            parseInt(this.props.incidentMessages.limit, 10),
            'internal'
        );
    };
    deleteInvestigationMessage = (incidentMessageId: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteIncidentMessage' does not exist on... Remove this comment to see the full error message
        const promise = this.props.deleteIncidentMessage(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject._id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.incident._id,
            incidentMessageId
        );

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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessages' does not exist on type... Remove this comment to see the full error message
        const { incidentMessages, incident, openModal } = this.props;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createMessageModalId' does not exist on ... Remove this comment to see the full error message
            createMessageModalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMessageModalId' does not exist on ty... Remove this comment to see the full error message
            editMessageModalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteMessageModalId' does not exist on ... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
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
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                        slug={this.props.currentProject.slug}
                    />
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
IncidentInternal.displayName = 'IncidentInternal';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        fetchIncidentMessages,
        openModal,
        deleteIncidentMessage,
        fetchIncidentNoteTemplates,
    },
    dispatch
);

function mapStateToProps(state: $TSFixMe, ownProps: $TSFixMe) {
    const incidentMessages = state.incident.incidentMessages
        ? state.incident.incidentMessages[ownProps.incident.slug]
            ? state.incident.incidentMessages[ownProps.incident.slug][
                  'internal'
              ]
            : {}
        : {};
    const currentProject = state.project.currentProject;
    return {
        incidentMessages,
        currentProject,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
IncidentInternal.propTypes = {
    incident: PropTypes.object.isRequired,
    incidentMessages: PropTypes.object,
    currentProject: PropTypes.object,
    fetchIncidentMessages: PropTypes.func,
    openModal: PropTypes.func,
    deleteIncidentMessage: PropTypes.func,
    fetchIncidentNoteTemplates: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentInternal);
