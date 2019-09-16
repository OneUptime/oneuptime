import React from 'react';
import PropTypes from 'prop-types'
import { Zones } from './TimezoneArray';

let errorStyle = {
    color: 'red',
    topMargin: '5px'
}

const TimezoneSelector = ({ input, meta: { touched, error } }) => (
    <span>
        <select {...input} className="bs-Button SearchableSelect-button bs-Button--icon--right bs-Button--icon bs-Button--overflow" >
            <option value="">Select Timezone...</option>
            {
                Zones.map(zone => (
                    <option value={zone.name} key={zone.name}>
                        {zone.name}
                    </option>
                ))
            }
        </select>
        {
            touched && error && (
                <span style={errorStyle}>{error}</span>
            )
        }
    </span>
)

TimezoneSelector.displayName = 'TimezoneSelector'

TimezoneSelector.propTypes = {
    input: PropTypes.object.isRequired,
    meta: PropTypes.object.isRequired
  }

export default TimezoneSelector