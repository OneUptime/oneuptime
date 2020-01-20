import React from 'react';
import PropTypes from 'prop-types'
import { formValueSelector } from 'redux-form';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import { RenderSingleEscalation } from './RenderSingleEscalation';

let RenderEscalation = ({ fields, meta: { error, submitFailed }, subProjectId, form }) => {
 
    return (
        <ul>
            {
                fields.map((policy, i) => {
                    const { email, sms, call, rotationFrequency } = form[i];

                    return (
                        <RenderSingleEscalation
                            call={call}
                            email={email}
                            sms={sms}
                            rotationFrequency={rotationFrequency}
                            policy={policy}
                            policyIndex={i}
                            key={i}
                            subProjectId={subProjectId}
                            fields={fields}
                        />
                    )
                })
            }

            <li>

                <div className="bs-Fieldset-row" style={{ padding: '0px 15px' }}>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center">
                            <div>
                                <ShouldRender if={fields.length < 10}>
                                    <button
                                        type="button"
                                        className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                        onClick={() => fields.push(
                                            { 
                                                callFrequency: '10',
                                                smsFrequency: '10',
                                                emailFrequency: '10',
                                                email: true,
                                                sms: false,
                                                call: false,
                                                rotationFrequency: '',
                                                rotationInterval: '',
                                                team: [
                                                  {
                                                    teamMember: [],
                                                  }
                                                ]
                                            }
                                        )}
                                    >
                                        Add Escalation Policy
                                    </button>
                                    <ShouldRender if={submitFailed && error}>
                                        <span>{error}</span>
                                    </ShouldRender>
                                </ShouldRender>
                            </div>
                        </div>
                    </div>
                </div>
            </li>
        </ul>
    )
}

RenderEscalation.displayName = 'RenderEscalation';

const selector = formValueSelector('OnCallAlertBox');

RenderEscalation = connect(state => {
    const form = selector(state, 'OnCallAlertBox')
    return {
      form
    }
})(RenderEscalation)

RenderEscalation.propTypes = {
    subProjectId: PropTypes.string.isRequired,
    meta: PropTypes.object.isRequired,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired,
    form: PropTypes.array.isRequired,
    // touched:PropTypes.bool,
    // error:PropTypes.string,
}

export { RenderEscalation }