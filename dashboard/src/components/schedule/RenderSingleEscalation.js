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

let RenderSingleEscalation = ({
    policy, email, sms, call,
    rotationFrequency, subProjectId,
    policyIndex, fields, rotationInterval
}) => {
    const [rotationFreqVisible, setRotationFreqVisibility] = useState(false);

    const manageRotationVisibility = (visibilityVal) => {
        setRotationFreqVisibility(visibilityVal);
    }

    return (
        <li key={policyIndex} style={{ margin: '5px 0px' }}>
            <div className="Card-root" style={{ backgroundColor: policyIndex === 0 ? '#f7f7f7' : '#ffffff' }}>
                <div className="Box-root">
                    {fields.length > 1 && <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Escalation Policy {policyIndex + 1}</span>
                            </span>
                            <p>
                                <span>

                                </span>
                            </p>
                        </div>
                    </div>}
                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2" style={{ backgroundColor: '#f7f7f7' }}>
                        <div>
                            <div className="bs-Fieldset-row" style={{ marginBottom: '-20px' }}>
                                <label className="bs-Fieldset-label"><span>Alert Members by</span></label>
                                <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                        <label className="Checkbox">
                                            <Field
                                                component="input"
                                                type="checkbox"
                                                name={`${policy}.email`}
                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                className="Checkbox-source"
                                            />
                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                <div className="Checkbox-target Box-root">
                                                    <div className="Checkbox-color Box-root"></div>
                                                </div>
                                            </div>
                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span>Email</span>
                                                </span>
                                            </div>
                                        </label>
                                    </div>
                                </div>

                                <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                        <label className="Checkbox">
                                            <Field
                                                component="input"
                                                type="checkbox"
                                                name={`${policy}.sms`}
                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                className="Checkbox-source"
                                            />
                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                <div className="Checkbox-target Box-root">
                                                    <div className="Checkbox-color Box-root"></div>
                                                </div>
                                            </div>
                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span>SMS</span>
                                                </span>
                                            </div>
                                        </label>
                                    </div>
                                </div>

                                <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                        <label className="Checkbox">
                                            <Field
                                                component="input"
                                                type="checkbox"
                                                name={`${policy}.call`}
                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                className="Checkbox-source"
                                            />
                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                <div className="Checkbox-target Box-root">
                                                    <div className="Checkbox-color Box-root"></div>
                                                </div>
                                            </div>
                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span>Call</span>
                                                </span>
                                            </div>
                                        </label>
                                    </div>
                                </div>

                            </div>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <fieldset className="bs-Fieldset">
                                    {call && (
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">Number of Call Reminders</label>
                                            <div className="bs-Fieldset-fields">
                                                <span className="flex">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        name={`${policy}.callFrequency`}
                                                        component={RenderField}
                                                        style={{ width: '250px' }}
                                                        defaultValue="3"
                                                        subProjectId={subProjectId}
                                                    />
                                                    <Tooltip title="Call Reminders" >
                                                        <div>
                                                            <p> How many times do you want your team to be alerted by Call if they do not respond. After X reminders Fyipe will escalates this incident to another team. </p>
                                                        </div>
                                                    </Tooltip>
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                    {sms && (
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">Number of SMS Reminders</label>
                                            <div className="bs-Fieldset-fields">
                                                <span className="flex">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        name={`${policy}.smsFrequency`}
                                                        component={RenderField}
                                                        style={{ width: '250px' }}
                                                        defaultValue="3"
                                                        subProjectId={subProjectId}
                                                    />
                                                    <Tooltip title="SMS Reminders" >
                                                        <div>
                                                            <p> How many times do you want your team to be alerted by SMS if they do not respond. After X reminders Fyipe will escalates this incident to another team </p>
                                                        </div>
                                                    </Tooltip>
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                    {email && (
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">Number of Email Reminders</label>
                                            <div className="bs-Fieldset-fields">
                                                <span className="flex">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        name={`${policy}.emailFrequency`}
                                                        component={RenderField}
                                                        style={{ width: '250px' }}
                                                        defaultValue="3"
                                                        subProjectId={subProjectId}
                                                    />
                                                    <Tooltip title="Email Reminders" >
                                                        <div>
                                                            <p> How many times do you want your team to be alerted by Email if they do not respond. After X reminders Fyipe will escalates this incident to another team. </p>
                                                        </div>
                                                    </Tooltip>
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {!rotationFreqVisible && (<div className="bs-Fieldset-row">
                                        <>
                                            <label className="bs-Fieldset-label"></label>
                                            <div className="bs-Fieldset-fields">
                                                <button className="button-as-anchor"
                                                    onClick={(() => manageRotationVisibility(true))}
                                                >Advance: Enable Team Rotation</button>
                                            </div>
                                        </>
                                    </div>)}


                                    {rotationFreqVisible && (<div className="bs-Fieldset-row">
                                        <>
                                            <label className="bs-Fieldset-label">Rotate Teams by</label>
                                            <div className="bs-Fieldset-fields">
                                                <span className="flex">
                                                    <Field
                                                        name={`${policy}.rotationFrequency`}
                                                        className="db-select-nw"
                                                        placeholder="Rotation Frequency"
                                                        type="text"
                                                        id="rotationFrequency"
                                                        options={[
                                                            { value: 'days', label: 'Day' },
                                                            { value: 'weeks', label: 'Week' },
                                                            { value: 'months', label: 'Month' }
                                                        ]}
                                                        component={RenderRotationFrequency}
                                                    />
                                                    <Tooltip title="On-Call Rotations" >
                                                        <div>
                                                            <p> <b>What are on-call rotations?</b></p>
                                                            <p> We&#39;ve written a blog detailing just that and also best-practices <a className="underline" href="https://blog.fyipe.com/how-to-create-an-on-call-schedule-that-doesnt-suck/">here.</a>  </p>
                                                        </div>

                                                        <div style={{ marginTop: '5px' }}>
                                                            <p> <b>What are daily / weekly / monthly rotations?</b></p>
                                                            <p> How often would you like the active team (who is on-call duty) to switch? Do you want the switch to happen every X days, X weeks or X months? </p>
                                                        </div>

                                                        <div style={{ marginTop: '5px' }}>
                                                            <p> <b>What do you recommend?</b></p>
                                                            <p> We usually see 1 week rotations work the best for most organizations. </p>
                                                        </div>



                                                    </Tooltip>
                                                </span>

                                            </div>
                                        </>
                                    </div>)}

                                    {rotationFreqVisible && rotationFrequency && (<div className="bs-Fieldset-row">

                                        <>
                                            <label className="bs-Fieldset-label">Rotation Interval</label>
                                            <div className="bs-Fieldset-fields">
                                                <span className="flex">
                                                    <Field
                                                        name={`${policy}.rotationInterval`}
                                                        component={RenderInterval}
                                                    />
                                                    <Tooltip title="Rotation Interval" >
                                                        <div>
                                                            <p> <b>What are rotation intervals?</b></p>
                                                            <p> How often would you like the active team (who is on-call duty) to switch? Do you want the switch to happen every X days, X weeks or X months? </p>
                                                        </div>

                                                        <div style={{ marginTop: '5px' }}>
                                                            <p> <b>I&#39;m confused. Can I learn more?</b></p>
                                                            <p> We&#39;ve written a blog detailing more info and also best-practices <a className="underline" href="https://blog.fyipe.com/how-to-create-an-on-call-schedule-that-doesnt-suck/">here.</a> If you&#39;re still confused, please email us at support@fyipe.com and we&#39;ll get back to you as soon as possible. </p>
                                                        </div>

                                                    </Tooltip>
                                                </span>
                                            </div>

                                        </>

                                    </div>)}

                                    {rotationFreqVisible && rotationFrequency && (<div className="bs-Fieldset-row">

                                        <>
                                            <label className="bs-Fieldset-label">First rotation happens on</label>
                                            <div className="bs-Fieldset-fields">
                                                <RenderRotationSwitchTime
                                                    policy={policy}
                                                    rotationFrequency={rotationFrequency}
                                                />
                                            </div>

                                        </>

                                    </div>)}

                                    {rotationFreqVisible && rotationFrequency && (<div className="bs-Fieldset-row">

                                        <>
                                            <label className="bs-Fieldset-label">Rotation Timezone</label>
                                            <div className="bs-Fieldset-fields">
                                                <Field
                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                    type="text"
                                                    name={`${policy}.rotationTimezone`}
                                                    component={TimezoneSelector}
                                                    style={{ width: '250px' }}
                                                    placeholder="CXT - Christmas"
                                                />
                                            </div>

                                        </>

                                    </div>)}

                                    {rotationFreqVisible && (<div className="bs-Fieldset-row">
                                        <>
                                            <label className="bs-Fieldset-label"></label>
                                            <div className="bs-Fieldset-fields">
                                                <button className="button-as-anchor"
                                                    onClick={(() => manageRotationVisibility(false))}
                                                >Disable Team Rotation</button>
                                            </div>
                                        </>
                                    </div>)}

                                    <div className="bs-Fieldset-rows">
                                        <FieldArray
                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                            name={`${policy}.team`}
                                            component={RenderTeams}
                                            subProjectId={subProjectId}
                                            policyIndex={policyIndex}
                                            rotationFrequency={rotationFrequency}
                                            rotationInterval={rotationInterval}
                                        />
                                    </div>
                                </fieldset>
                            </div>
                        </div>
                    </div>
                    <ShouldRender if={fields.length > 1}>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12" style={{ backgroundColor: '#f7f7f7' }}>

                            <div>
                                <button
                                    className="bs-Button bs-DeprecatedButton"
                                    onClick={() => fields.remove(policyIndex)}
                                    type="button"
                                >
                                    Remove Policy
                        </button>
                            </div>
                        </div>
                    </ShouldRender>
                </div>
            </div>
        </li>
    )
}

RenderSingleEscalation.displayName = 'RenderSingleEscalation';

RenderSingleEscalation.propTypes = {
    subProjectId: PropTypes.string.isRequired,
    call: PropTypes.bool.isRequired,
    sms: PropTypes.bool.isRequired,
    email: PropTypes.bool.isRequired,
    policy: PropTypes.string.isRequired,
    policyIndex: PropTypes.number.isRequired,
    rotationFrequency: PropTypes.string,
    rotationInterval: PropTypes.number,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired,
}

export { RenderSingleEscalation }
