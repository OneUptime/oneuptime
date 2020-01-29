import React from 'react';
import PropTypes from 'prop-types'
import ShouldRender from '../basic/ShouldRender';
import { Field } from 'redux-form';
import DateTimeSelector from '../basic/DateTimeSelector';
import TimeSelector from '../basic/TimeSelector';

const RenderRotationSwitchTime = ({
  policy, rotationFrequency
}) => {

  return (
    <>
      <ShouldRender if={rotationFrequency === 'weeks' || rotationFrequency === 'months'}>
        <div style={{ paddingLeft: '0px', paddingTop: '5px', paddingBottom: 20, marginBottom: 10 }}>
          <Field
            className="db-BusinessSettings-input TextInput bs-TextInput"
            type="text"
            name={`${policy}.rotationSwitchTime`}
            component={DateTimeSelector}
            placeholder="10pm"
            style={{ width: '250px' }}
          />
        </div>
      </ShouldRender>
      <ShouldRender if={rotationFrequency === 'days'}>
        <div style={{ paddingLeft: '0px', paddingTop: '5px', paddingBottom: 20, marginBottom: 10 }}>
          <Field
            className="db-BusinessSettings-input TextInput bs-TextInput"
            type="text"
            name={`${policy}.rotationSwitchTime`}
            component={TimeSelector}
            placeholder="10pm"
            style={{ width: '250px' }}
          />
        </div>
      </ShouldRender>
    </>
  );
};

RenderRotationSwitchTime.displayName = 'RenderRotationSwitchTime'

RenderRotationSwitchTime.propTypes = {
  policy: PropTypes.string.isRequired,
  rotationFrequency: PropTypes.string.isRequired
}

export { RenderRotationSwitchTime }