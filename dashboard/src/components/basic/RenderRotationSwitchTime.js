import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types'
import ShouldRender from '../basic/ShouldRender';
import { Field, FieldArray } from 'redux-form';
import TimeSelector from './TimeSelector';
import { WeekSelector } from './WeekSelector';

const RenderRotationSwitchTime = ({
  policy, rotationFrequency
}) => {

    return (
      <>
        <ShouldRender if={rotationFrequency === 'days' || rotationFrequency === 'months'}>
          <div style={{paddingLeft:'0px', paddingTop:'5px'}}>
            <Field
                className="db-BusinessSettings-input TextInput bs-TextInput"
                type="text"
                name={`${policy}.rotationSwitchTime`}
                component={TimeSelector}
                rotationFrequency={rotationFrequency}
                placeholder="10pm"
                style={{width:'250px'}}
            />
          </div>
        </ShouldRender>

        <ShouldRender if={rotationFrequency === 'weeks'}>
          <div style={{paddingLeft:'0px', paddingTop:'5px'}}>
            <Field
                className="db-BusinessSettings-input TextInput bs-TextInput"
                type="text"
                name={`${policy}.rotationSwitchTime`}
                component={WeekSelector}
                placeholder="10pm"
                style={{width:'250px'}}
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