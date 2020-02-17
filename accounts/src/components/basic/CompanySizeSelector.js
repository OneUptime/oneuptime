import React from 'react';
import PropTypes from 'prop-types'
import { companySize } from './CompanySizeList';

const errorStyle = {
  color: 'red',
  topMargin: '5px'
}

const CompanySizeSelector = ({ input, id, meta: { touched, error } }) => (
  <span>
    <select {...input} className="selector" id={id}>
      <option value="">Select Company Size...</option>
      {companySize.map(val => (
        <option value={val.name} key={val.code}>
          {val.name}
        </option>
      ))}
    </select>
    {touched && error && <span style={errorStyle}>{error}</span>}
  </span>
)

CompanySizeSelector.displayName = 'CompanySizeSelector'

CompanySizeSelector.propTypes = {
  meta: PropTypes.object.isRequired,
  input: PropTypes.object.isRequired,
  id: PropTypes.string
}

export default CompanySizeSelector
