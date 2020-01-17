import React from 'react';
import PropTypes from 'prop-types'
import { connect } from 'react-redux';
import { formValueSelector } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import { RenderName } from './RenderName';

let RenderNames = ({ fields, meta: { error, submitFailed }, subProjectId, policyIndex, teamIndex, form }) => {
    const policyRotation = form[policyIndex].team[teamIndex];

    return (
        <ul>
            {
                fields.map((inputarray, i) => {
                    const memberValue = policyRotation.teamMember[i];
                    
                    return (
                        <RenderName
                            memberValue={memberValue}
                            subProjectId={subProjectId}
                            policyIndex={policyIndex}
                            teamIndex={teamIndex}
                            inputarray={inputarray}
                            nameIndex={i}
                            fields={fields}
                        />
                    )
                })
            }

            <li>
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label"></label>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center"></div>
                    </div>
                </div>
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label"></label>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center">
                            <div>
                                <ShouldRender if={fields.length < 10}>
                                    <button
                                        type="button"
                                        className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                        onClick={() => fields.push({ member: '', email: true, sms: true, call: true, timezone: '', startTime: '', endTime: '' })}
                                    >
                                        Add Member
                                    </button>
                                    <ShouldRender if={submitFailed && error}>
                                        <span>{error}</span>
                                    </ShouldRender>
                                </ShouldRender>
                            </div>
                        </div>
                        <p className="bs-Fieldset-explanation">
                            <span>
                                Add Names and respective alert medium and time to contact.
                            </span>
                        </p>
                    </div>
                </div>
            </li>
        </ul>
    )
}

RenderNames.displayName = 'RenderNames'

RenderNames.propTypes = {
    subProjectId: PropTypes.string.isRequired,
    meta: PropTypes.object.isRequired,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired,
    policyIndex: PropTypes.number.isRequired,
    teamIndex: PropTypes.number.isRequired,
    form: PropTypes.object.isRequired,
}

function mapStateToProps(state) {
    const selector = formValueSelector('OnCallAlertBox');
    const form = selector(state, 'OnCallAlertBox');

    return {
      form
    }
}

RenderNames = connect(mapStateToProps)(RenderNames);

export { RenderNames }