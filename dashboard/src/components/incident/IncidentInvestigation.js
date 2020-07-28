import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    editIncidentMessageSwitch,
    fetchIncidentMessages,
} from '../../actions/incident';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { logEvent } from '../../analytics';
import IncidentMessageThread from './IncidentMessageThread';

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
        const {
            incidentMessages,
            editIncidentMessageSwitch,
            incident,
        } = this.props;
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
                    <IncidentMessageThread
                        title="Investigation"
                        description="Tell us more about what went wrong."
                        incidentMessages={incidentMessages}
                        count={count}
                        canSeeOlder={canSeeOlder}
                        canSeeNewer={canSeeNewer}
                        requesting={requesting}
                        editIncidentMessageSwitch={editIncidentMessageSwitch}
                        incident={incident}
                        type={'investigation'}
                        error={error}
                        newerMessage={this.newerInvestigationMessage}
                        olderMessage={this.olderInvestigationMessage}
                    />
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
