import React, { useState } from 'react';
import PropTypes from 'prop-types'
import { Field, FieldArray } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import { RenderRotationFrequency } from './RenderRotationFrequency';
import { RenderInterval } from './RenderInterval';
import { RenderRotationSwitchTime } from './RenderRotationSwitchTime';
import TimezoneSelector from '../basic/TimezoneSelector';
import { RenderTeams } from './RenderTeams';
import { RenderField } from '../basic/RenderField';
import Tooltip from '../basic/Tooltip';

let RenderEscalationSummary = ({
    fields
}) => {

    return (
        <div class="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">

                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">

                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span> Call Schedule and Escalation Policy</span>
                                </span>
                                <p>
                                    Define your call schedule here. Alert your backup on-call team if your primary on-call team does not respond to alerts.
                        </p>
                            </div>
                        </div>
                    </div>
                    <div className="bs-ContentSection-content Box-root">

                        <div className="Card-root" style={{ backgroundColor: '#ffffff' }}>
                            <div className="Box-root">
                                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Escalation Policy 1 </span>
                                        </span>
                                        <p>
                                            <span>

                                            </span>
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2" style={{ backgroundColor: '#f7f7f7' }}>
                            <div>




                                <div className="bs-Fieldset-row">

                                    <div className="bs-Fieldset-fields">
                                        <div className="team-header-label">
                                            <h3>{`On Active Duty: Team 1`}</h3>
                                        </div>
                                    </div>
                                </div>

                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label">Team Members</label>
                                    <div className="bs-Fieldset-fields">
                                        Nawaz Dhandala, Samantha Smith.
                                        </div>
                                </div>

                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label">On-Call Duty End Time</label>
                                    <div className="bs-Fieldset-fields">
                                        Jan 29, 2020. 11:00 AM (Timezone)
                                        </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label">Note: </label>
                                    <div className="bs-Fieldset-fields">
                                        If the current active team does not respond, then the incident will be escalated to Escalation Policy 2 <br />

                                    </div>
                                </div>
                                <div className="bs-Fieldset-row">

                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label"><b>Next Team scheduled to be on duty</b></label>
                                    <div className="bs-Fieldset-fields">
                                        Team 2
                                        </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label">Team Members</label>
                                    <div className="bs-Fieldset-fields">
                                        Nawaz Dhandala, Samantha Smith.
                                        </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label">On-Call Duty Start Time</label>
                                    <div className="bs-Fieldset-fields">
                                        Jan 29, 2020. 11:00 AM (Timezone)
                                        </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label">On-Call Duty End Time</label>
                                    <div className="bs-Fieldset-fields">
                                        Jan 29, 2020. 11:00 AM (Timezone)
                                        </div>
                                </div>


                            </div>
                        </div>

                    </div>
                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                        <div className="bs-Tail-copy">
                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>


                            </div>
                        </div>

                        <div>

                        </div>
                    </div>
                </div>
            </div>
        </div>

    )
}

RenderEscalationSummary.displayName = 'RenderEscalationSummary';

RenderEscalationSummary.propTypes = {
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired,
}

export { RenderEscalationSummary }
