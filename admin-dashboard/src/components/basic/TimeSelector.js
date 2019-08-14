import React from 'react';
import PropTypes from 'prop-types'
import {Times} from './TimeArray'

const TimeSelector = ({ input, meta: { touched, error } }) => (
    <span>
        <select {...input} className="bs-Button SearchableSelect-button bs-Button--icon--right bs-Button--icon bs-Button--overflow" style={{width:'280px'}}>
            <option value="">Select Time...</option>
            {
                Times.map(time => (
                    <option value={time} key={time}>
                        {time}
                    </option>
                ))
            }
        </select>
        {
            touched && error && <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{marginTop:'5px'}}>
            <div className="Box-root Margin-right--8" style={{marginTop:'2px'}}>
                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                </div>
            </div>
            <div className="Box-root">
                <span style={{ color: 'red' }}>
                    {error}
                </span>
            </div>
        </div>
        }
    </span>
)

TimeSelector.displayName = 'TimeSelector'

TimeSelector.propTypes = {
    input: PropTypes.object.isRequired,
    meta: PropTypes.object.isRequired
  }

export default TimeSelector