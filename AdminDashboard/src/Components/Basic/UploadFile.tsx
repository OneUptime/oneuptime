import React from 'react';
import PropTypes from 'prop-types';
const UploadFile: Function = ({
    fileInputKey,

    input: { value: omitValue, ...inputProps },

    meta: omitMeta,

    ...props
}: $TSFixMe) => <input key={fileInputKey} type="file" {...inputProps} {...props} />;

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
