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
    fields,
    onEditClicked
}) => {

    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">

                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">

                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span> Call Schedule and Escalation Policy Summary</span>
                                </span>
                                <p>
                                    Define your call schedule here. Alert your backup on-call team if your primary on-call team does not respond to alerts.
                        </p>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div className="Box-root">

                                    <button
                                        type="button"
                                        className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--edit"
                                        onClick={() => { return onEditClicked ? onEditClicked() : null }}
                                    >
                                        Edit Call Schedule

                                    </button>

                                </div>
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
                                            <h3 style={{
                                                width: '250px',
                                                marginLeft: '140px',
                                                marginTop: '20px'
                                            }}> <span className="greendot"></span> {'On Active Duty: Team 1'}</h3>
                                        </div>
                                    </div>
                                </div>


                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label"><b>Team Members</b></label>
                                    <div className="bs-Fieldset-fields labelfield" style={{marginTop:'-1px'}}>
                                        <div className="Box-root Margin-right--16 pointer">
                                            <img src='/assets/img/profile-user.svg' className="userIcon" alt="" />
                                            <span>Samantha Smith</span>
                                        </div>
                                        <div className="Box-root Margin-right--16 pointer">
                                            <img src='/assets/img/profile-user.svg' className="userIcon" alt="" />
                                            <span>Samantha Smith</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label"><b>On-Call Duty End Time</b></label>
                                    <div className="bs-Fieldset-fields labelfield">
                                        Jan 29, 2020. 11:00 AM (Timezone)
                                        </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label"><b>Note:</b> </label>
                                    <div className="bs-Fieldset-fields labelfield">
                                        If the current active team does not respond, then the incident will be escalated to Escalation Policy 2 <br />

                                    </div>
                                </div>
                                <div className="bs-Fieldset-row">

                                </div>
                                <div className="bs-Fieldset-row">
                                    
                                    <div className="bs-Fieldset-fields">
                                        <div className="team-header-label">
                                            <h3 style={{
                                                width: '250px',
                                                marginLeft: '140px',
                                                marginTop: '20px'
                                            }}> <span className="yellowdot"></span> {'Next Team Scheduled: Team 2'}</h3>
                                        </div>
                                    </div>
                                </div>

                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label"><b>Team Members</b></label>
                                    <div className="bs-Fieldset-fields labelfield" style={{marginTop:'-1px'}} >
                                        <div className="Box-root Margin-right--16 pointer">
                                            <img src='/assets/img/profile-user.svg' className="userIcon" alt="" />
                                            <span>Samantha Smith</span>
                                        </div>
                                        <div className="Box-root Margin-right--16 pointer" >
                                            <img src='/assets/img/profile-user.svg' className="userIcon" alt="" />
                                            <span>Samantha Smith</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label"><b>On-Call Duty Start Time</b></label>
                                    <div className="bs-Fieldset-fields labelfield">
                                        Jan 29, 2020. 11:00 AM (Timezone)
                                        </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label"><b>On-Call Duty End Time</b></label>
                                    <div className="bs-Fieldset-fields labelfield">
                                        Jan 29, 2020. 11:00 AM (Timezone)
                                        </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label"><b>Note:</b> </label>
                                    <div className="bs-Fieldset-fields labelfield">
                                        If the current active team does not respond, then the incident will be escalated to Escalation Policy 2 <br />

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
        </div >

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
