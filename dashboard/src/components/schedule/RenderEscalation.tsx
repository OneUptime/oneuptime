import React from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { formValueSelector } from 'redux-form';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import { RenderSingleEscalation } from './RenderSingleEscalation';

let RenderEscalation = ({
    fields,
    meta: { error, submitFailed },
    subProjectId,
    form
}: $TSFixMe) => {
    return (
        <ul>
            {fields.map((policy: $TSFixMe, i: $TSFixMe) => {
                const {
                    email,
                    sms,
                    call,
                    push,
                    rotateBy,
                    rotationInterval,
                } = form[i];

                return (
                    <RenderSingleEscalation
                        call={call}
                        email={email}
                        sms={sms}
                        push={push}
                        rotateBy={rotateBy}
                        rotationInterval={rotationInterval}
                        policy={policy}
                        policyIndex={i}
                        key={i}
                        subProjectId={subProjectId}
                        fields={fields}
                    />
                );
            })}

            <li>
                <div
                    className="bs-Fieldset-row"
                    style={{ padding: '0px 15px' }}
                >
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
    );
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type '({ ... Remove this comment to see the full error message
RenderEscalation.displayName = 'RenderEscalation';

const selector = formValueSelector('OnCallAlertBox');

// @ts-expect-error ts-migrate(2322) FIXME: Type 'ConnectedComponent<({ fields, meta: { error,... Remove this comment to see the full error message
RenderEscalation = connect(state => {
    const form = selector(state, 'OnCallAlertBox');
    return {
        form,
    };
})(RenderEscalation);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type '({ fi... Remove this comment to see the full error message
RenderEscalation.propTypes = {
    subProjectId: PropTypes.string.isRequired,
    meta: PropTypes.object.isRequired,
    fields: PropTypes.oneOfType([PropTypes.array, PropTypes.object]).isRequired,
    form: PropTypes.array.isRequired,
    // touched:PropTypes.bool,
    // error:PropTypes.string,
};

export { RenderEscalation };
