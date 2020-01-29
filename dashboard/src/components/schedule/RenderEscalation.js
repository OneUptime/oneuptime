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
                    const { email, sms, call, rotationFrequency, rotationInterval } = form[i];

                    return (
                        <RenderSingleEscalation
                            call={call}
                            email={email}
                            sms={sms}
                            rotationFrequency={rotationFrequency}
                            rotationInterval={rotationInterval}
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
            
                                    <ShouldRender if={submitFailed && error}>
                                        <span>{error}</span>
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