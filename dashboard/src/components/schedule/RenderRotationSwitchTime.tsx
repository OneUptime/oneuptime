import React from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { Field } from 'redux-form';
import DateTimeSelector from '../basic/DateTimeSelector';
import TimeSelector from '../basic/TimeSelector';

const RenderRotationSwitchTime = ({ policy, rotateBy }) => {
    return (
        <>
            <ShouldRender if={rotateBy === 'weeks' || rotateBy === 'months'}>
                <div>
                    <Field
                        className="db-BusinessSettings-input TextInput bs-TextInput"
                        type="text"
                        name={`${policy}.firstRotationOn`}
                        component={DateTimeSelector}
                        placeholder="10pm"
                        style={{ width: '250px' }}
                    />
                </div>
            </ShouldRender>
            <ShouldRender if={rotateBy === 'days'}>
                <div>
                    <Field
                        className="db-BusinessSettings-input TextInput bs-TextInput"
                        type="text"
                        name={`${policy}.firstRotationOn`}
                        component={TimeSelector}
                        placeholder="10pm"
                        style={{ width: '250px' }}
                    />
                </div>
            </ShouldRender>
        </>
    );
};

RenderRotationSwitchTime.displayName = 'RenderRotationSwitchTime';

RenderRotationSwitchTime.propTypes = {
    policy: PropTypes.string.isRequired,
    rotateBy: PropTypes.string.isRequired,
};

export { RenderRotationSwitchTime };
