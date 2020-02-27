import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import IncidentTimelineList from './IncidentTimelineList';
import { getIncidentTimeline } from '../../actions/incident';

export class IncidentTimelineBox extends Component {
    componentDidUpdate(prevProps) {
        if (
            prevProps.incident !== this.props.incident &&
            !this.props.incident.timeline
        ) {
            this.props.getIncidentTimeline(
                this.props.currentProject._id,
                this.props.incident._id,
                parseInt(this.props.incidentTimeline.skip, 10),
                parseInt(this.props.incidentTimeline.limit, 10)
            );
        }
    }

    render() {
        return (
            <div className="Box-root Card-shadow--medium">
                <div className="db-Trends-header Box-background--white Box-divider--surface-bottom-1">
                    <div className="ContentHeader Box-root Box-background--white Flex-flex Flex-direction--column">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span>Incident Timeline</span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Here&#39;s the timeline of users and
                                        probes activities.
                                    </span>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <IncidentTimelineList
                        incident={this.props.incident}
                        prevClicked={this.props.previous}
                        nextClicked={this.props.next}
                    />
                </div>
            </div>
        );
    }
}

IncidentTimelineBox.displayName = 'IncidentTimelineBox';

IncidentTimelineBox.propTypes = {
    currentProject: PropTypes.object,
    getIncidentTimeline: PropTypes.func,
    incident: PropTypes.object,
    incidentTimeline: PropTypes.object,
    next: PropTypes.func,
    previous: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getIncidentTimeline }, dispatch);

function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject,
        incidentTimeline: state.incident.incident,
    };
}

IncidentTimelineBox.contextTypes = {
    mixpanel: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentTimelineBox);
