import React from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { Link } from 'react-router-dom';

function IncidentDescription(props) {
    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Incident Description</span>
                            </span>
                            <p>
                                <span>
                                    Here&#39;s a little more information about
                                    the incident.
                                </span>
                            </p>
                        </div>
                    </div>
                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                        <div>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <fieldset className="bs-Fieldset">
                                    <div className="bs-Fieldset-rows">
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                Incident ID
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <span
                                                    className="value"
                                                    style={{ marginTop: '6px' }}
                                                >
                                                    {props.incident._id}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                Monitor
                                            </label>
                                            <div
                                                className="bs-Fieldset-fields"
                                                style={{ marginTop: '6px' }}
                                            >
                                                <span className="value">
                                                    <Link
                                                        to={
                                                            '/project/' +
                                                            props.projectId +
                                                            '/monitors/' +
                                                            props.incident
                                                                .monitorId._id
                                                        }
                                                    >
                                                        {
                                                            props.incident
                                                                .monitorId.name
                                                        }
                                                    </Link>
                                                </span>
                                            </div>
                                        </div>
                                        <ShouldRender
                                            if={
                                                props.incident.incidentType ===
                                                'online'
                                            }
                                        >
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Incident Status
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{ marginTop: '5px' }}
                                                >
                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span>Online</span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                props.incident.incidentType ===
                                                'degraded'
                                            }
                                        >
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Incident Status
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{ marginTop: '5px' }}
                                                >
                                                    <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span>
                                                                Degraded
                                                            </span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                props.incident.incidentType ===
                                                'offline'
                                            }
                                        >
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Incident Status
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{ marginTop: '5px' }}
                                                >
                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span>Offline</span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </fieldset>
                            </div>
                        </div>
                    </div>
                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                        <span className="db-SettingsForm-footerMessage"></span>
                        <div></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

IncidentDescription.displayName = 'IncidentDescription';

IncidentDescription.propTypes = {
    incident: PropTypes.object.isRequired,
    projectId: PropTypes.string.isRequired,
};

export default IncidentDescription;
