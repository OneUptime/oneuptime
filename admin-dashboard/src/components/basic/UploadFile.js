import React from 'react';
import PropTypes from 'prop-types';
const UploadFile = ({
    fileInputKey,
    //eslint-disable-next-line
    input: { value: omitValue, ...inputProps },
    //eslint-disable-next-line
    meta: omitMeta,
    ...props
}) => <input key={fileInputKey} type="file" {...inputProps} {...props} />;

UploadFile.propTypes = {
    input: PropTypes.object.isRequired,
    meta: PropTypes.object.isRequired,
    fileInputKey: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.instanceOf(Date),
    ]),
};

UploadFile.displayName = 'UploadFile';

export { UploadFile };
