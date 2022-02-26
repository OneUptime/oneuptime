import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import IncidentTimelineList from './IncidentTimelineList';
import { getIncidentTimeline } from '../../actions/incident';

export class IncidentTimelineBox extends Component {
    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            prevProps.incident !== this.props.incident &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
            !this.props.incident.timeline
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getIncidentTimeline' does not exist on t... Remove this comment to see the full error message
            this.props.getIncidentTimeline(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.incident._id,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentTimeline' does not exist on type... Remove this comment to see the full error message
                parseInt(this.props.incidentTimeline.skip, 10),
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentTimeline' does not exist on type... Remove this comment to see the full error message
                parseInt(this.props.incidentTimeline.limit, 10)
            );
        }
    }

    render() {
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Incident Timeline</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Here&#39;s the timeline of users and probes
                                    activities.
                                </span>
                            </span>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <IncidentTimelineList
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident' does not exist on type 'Readon... Remove this comment to see the full error message
                        incident={this.props.incident}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'previous' does not exist on type 'Readon... Remove this comment to see the full error message
                        prevClicked={this.props.previous}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'next' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        nextClicked={this.props.next}
                    />
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
IncidentTimelineBox.displayName = 'IncidentTimelineBox';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
IncidentTimelineBox.propTypes = {
    currentProject: PropTypes.object,
    getIncidentTimeline: PropTypes.func,
    incident: PropTypes.object,
    incidentTimeline: PropTypes.object,
    next: PropTypes.func,
    previous: PropTypes.func,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ getIncidentTimeline }, dispatch);

function mapStateToProps(state: $TSFixMe) {
    return {
        currentProject: state.project.currentProject,
        incidentTimeline: state.incident.incident,
    };
}

// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
IncidentTimelineBox.contextTypes = {};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentTimelineBox);
