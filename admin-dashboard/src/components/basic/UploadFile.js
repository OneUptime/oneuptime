import React from 'react';
import PropTypes from 'prop-types'
const UploadFile = ({ input: {value: omitValue, ...inputProps }, meta: omitMeta, ...props }) => (
    <input type='file' {...inputProps} {...props} />
  );

UploadFile.propTypes = {
  input: PropTypes.object.isRequired,
  meta: PropTypes.object.isRequired
}

UploadFile.displayName = 'UploadFile'

export {UploadFile}