import React, { Component } from 'react';
import PropTypes from 'prop-types'
import moment from 'moment';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { acknowledgeIncident, resolveIncident, closeIncident } from '../../actions/incident';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { User } from '../../config';

export class IncidentStatus extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }
    acknowledge = () => {
        let userId = User.getUserId();
        this.props.acknowledgeIncident(this.props.incident.projectId, this.props.incident._id, userId, this.props.multiple);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Incident Acknowledged', {
                ProjectId: this.props.incident.projectId,
                incidentId: this.props.incident._id,
                userId: userId
            });
        }
    }

    resolve = () => {
        let userId = User.getUserId();
        this.props.resolveIncident(this.props.incident.projectId, this.props.incident._id, userId, this.props.multiple);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Incident Resolved', {
                ProjectId: this.props.incident.projectId,
                incidentId: this.props.incident._id,
                userId: userId
            });
        }
    }

    closeIncident = () => {
        this.props.closeIncident(this.props.incident.projectId, this.props.incident._id);
    }

    render() {
        const subProject = this.props.subProjects && this.props.subProjects.filter(subProject => subProject._id === this.props.incident.projectId)[0];
        const loggedInUser = User.getUserId();
        var isUserInProject = this.props.currentProject && this.props.currentProject.users.some(user => user.userId === loggedInUser);
        var isUserInSubProject = false;
        if (isUserInProject) isUserInSubProject = true;
        else isUserInSubProject = subProject.users.some(user => user.userId === loggedInUser);
        return (
            <div id={`incident_${this.props.count}`} className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span id={`incident_span_${this.props.count}`}>{this.props.multiple && this.props.incident && this.props.incident.monitorId ? this.props.incident.monitorId.name + '\'s Incident Status' : 'Incident Status'}</span>
                                </span>
                                <p><span>Acknowledge and Resolve this incident.</span></p>
                            </div>
                            <ShouldRender if={this.props.multiple && this.props.incident && this.props.incident.resolved}>
                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16" style={{ marginTop: '-20px' }}>
                                    <div className="Box-root">
                                        <span className="incident-close-button" onClick={this.closeIncident}></span>
                                    </div>
                                </div>
                            </ShouldRender>
                        </div>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">

                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Created At:</label>
                                                <div className="bs-Fieldset-fields" style={{ marginTop: '6px' }}>
                                                    <span className="value">{`${moment(this.props.incident.createdAt).fromNow()} (${moment(this.props.incident.createdAt).format('MMMM Do YYYY, h:mm:ss a')})`}</span>
                                                </div>
                                            </div>

                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Incident Status:</label>
                                                <div className="bs-Fieldset-fields" style={{ marginTop: '6px' }}>
                                                    <span className="value">
                                                        {this.props.incident && this.props.incident.incidentType && this.props.incident.incidentType === 'offline' ?
                                                            (<div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                    <span>offline</span>
                                                                </span>
                                                            </div>)
                                                            : this.props.incident && this.props.incident.incidentType && this.props.incident.incidentType === 'online' ?
                                                                (<div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                        <span>online</span>
                                                                    </span>
                                                                </div>)
                                                                : this.props.incident && this.props.incident.incidentType && this.props.incident.incidentType === 'degraded' ?
                                                                    (<div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                        <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                            <span>degraded</span>
                                                                        </span>
                                                                    </div>)
                                                                    :
                                                                    (<div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                            <span>Unknown Status</span>
                                                                        </span>
                                                                    </div>)
                                                        }
                                                    </span>
                                                </div>
                                            </div>

                                            {this.props.incident.acknowledged ? (<div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Acknowledge</label>
                                                <div className="bs-Fieldset-fields" style={{ marginTop: '5px' }}>
                                                    <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span id={`AcknowledgeText_${this.props.count}`}>
                                                                Acknowledged by {this.props.incident.acknowledgedBy === null ? this.props.incident.acknowledgedByZapier ? 'Zapier' : 'Fyipe' : this.props.incident.acknowledgedBy.name} {moment(this.props.incident.acknowledgedAt).fromNow() + '.'}
                                                            </span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>)
                                                : isUserInSubProject ? (<div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">Acknowledge</label>
                                                    <div className="bs-Fieldset-fields" title="Let your team know you're working on this incident.">
                                                        <div className="Box-root Flex-flex Flex-alignItems--center">
                                                            <div>
                                                                <label id={`btnAcknowledge_${this.props.count}`} className="bs-Button bs-DeprecatedButton bs-FileUploadButton bs-Button--icon bs-Button--circle" type="button" onClick={this.acknowledge}>
                                                                    <span>Acknowledge Incident</span>
                                                                </label>
                                                            </div>
                                                        </div>
                                                        <p className="bs-Fieldset-explanation"><span>Let your team know you&#39;re working on this incident.</span></p>
                                                    </div>
                                                </div>) : (<div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">Acknowledge</label>
                                                    <div className="bs-Fieldset-fields" style={{ marginTop: '5px' }}>
                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                <span>
                                                                    Not Acknowledged
                                                            </span>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>)}

                                            {this.props.incident.resolved ? (<div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Resolve</label>
                                                <div className="bs-Fieldset-fields" style={{ marginTop: '5px' }}>
                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span id={`ResolveText_${this.props.count}`}>
                                                                Resolved by {this.props.incident.resolvedBy === null ? this.props.incident.resolvedByZapier ? 'Zapier' : 'Fyipe' : this.props.incident.resolvedBy.name} {moment(this.props.incident.resolvedAt).fromNow() + '.'}
                                                            </span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>)
                                                : isUserInSubProject ? (<div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">Resolve</label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div className="Box-root Flex-flex Flex-alignItems--center" title="Let your team know you've fixed this incident.">
                                                            <div>
                                                                <label id={`btnResolve_${this.props.count}`} className="bs-Button bs-DeprecatedButton bs-FileUploadButton bs-Button--icon bs-Button--check" type="button" onClick={this.resolve}>
                                                                    <span>Resolve Incident</span>
                                                                </label>
                                                            </div>
                                                        </div>
                                                        <p className="bs-Fieldset-explanation"><span>Let your team know you&#39;ve fixed this incident.</span></p>
                                                    </div>
                                                </div>)
                                                    : (<div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">Resolve</label>
                                                        <div className="bs-Fieldset-fields" style={{ marginTop: '5px' }}>
                                                            <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                    <span>
                                                                        Not Resolved
                                                                </span>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>)}
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                        
                            <ShouldRender if={this.props.multiple && this.props.incident && this.props.incident.resolved}>
                                <div>
                                    <button
                                        onClick={this.closeIncident}
                                        className={this.props.closeincident && this.props.closeincident.requesting ? 'bs-Button bs-Button--blue' : 'bs-Button bs-DeprecatedButton db-Trends-editButton'}
                                        disabled={this.props.closeincident && this.props.closeincident.requesting}
                                        type="button">

                                        <ShouldRender if={this.props.closeincident && this.props.closeincident.requesting}>
                                            <FormLoader />
                                        </ShouldRender>
                                        <ShouldRender if={this.props.closeincident && !this.props.closeincident.requesting}>
                                            <span>Close</span>
                                        </ShouldRender>

                                    </button>
                                </div>
                            </ShouldRender>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

IncidentStatus.displayName = 'IncidentStatus'

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
        closeincident: state.incident.closeincident,
        subProjects: state.subProject.subProjects.subProjects
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ resolveIncident, acknowledgeIncident, closeIncident }, dispatch);
}

IncidentStatus.propTypes = {
    resolveIncident: PropTypes.func.isRequired,
    acknowledgeIncident: PropTypes.func.isRequired,
    closeIncident: PropTypes.func,
    closeincident: PropTypes.object,
    requesting: PropTypes.bool,
    incident: PropTypes.object.isRequired,
    currentProject: PropTypes.object.isRequired,
    subProjects: PropTypes.array.isRequired,
    multiple: PropTypes.bool,
    count: PropTypes.number
}

IncidentStatus.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentStatus);