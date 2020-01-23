import React from 'react';
import PropTypes from 'prop-types'

let RenderInterval = ({ input: { onChange, value }}) => {

  const handleChange = ({ target: { value }}) => {
    onChange(value)
  }

  return (
    <input
      type="number"
      placeholder="Interval"
      className="db-BusinessSettings-input TextInput bs-TextInput renderFrequencyInput"
      min="0"
      onChange={handleChange}
      value={value}
    />
  )
}

RenderInterval.displayName = 'RenderInterval';

RenderInterval.propTypes = {
  input: PropTypes.shape({
    onChange: PropTypes.func.isRequired,
    value: PropTypes.number,
  })
}

export { RenderInterval }