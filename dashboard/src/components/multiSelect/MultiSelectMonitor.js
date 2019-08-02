import React from 'react';
import PropTypes from 'prop-types';
import Multiselect from 'react-widgets/lib/Multiselect';

let errorStyle = {
    color: 'red',
    topMargin: '5px'
}

const MultiSelectMonitor = ({ input, data, meta,valueField, textField ,placeholder}) => {

    return <span style={{width:'100%'}}>
    <span>
        <Multiselect {...input}
        onBlur={() => input.onBlur()}
        value={input.value || []} // requires value to be an array
        data={data}
        valueField={valueField}
        textField={textField}
        caseSensitive={false}
        filter='contains'
        placeholder={placeholder}
        style={{width:'100%'}}
    />
    </span>
        {meta.error &&
            meta.touched &&
            <span style={errorStyle}>
                {meta.error}
        </span>}
    </span>
}
MultiSelectMonitor.displayName = 'MultiSelectMonitor';

MultiSelectMonitor.propTypes = {
    meta: PropTypes.object.isRequired,
    input: PropTypes.object.isRequired,
    data: PropTypes.any,
    valueField: PropTypes.string,
    textField: PropTypes.string,
    placeholder: PropTypes.string,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]),
};

export default MultiSelectMonitor;