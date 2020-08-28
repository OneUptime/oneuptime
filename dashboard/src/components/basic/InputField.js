import React, { useCallback } from 'react';
import { PropTypes } from 'prop-types';

const InputField = React.forwardRef((props, ref) => {
    const { value, onChange } = props;
    console.log(props, '>>>>>>>>>>>>>>>>>>>>>');
    const handleChange = useCallback(
        event => {
            let inputValue = event.target.value;
            inputValue = inputValue.replace(/\s/g, '');
            onChange(inputValue);
        },
        [onChange]
    );
    return (
        <div>
            <input value={value} onChange={handleChange} ref={ref} />
        </div>
    );
});

InputField.displayName = 'InputField';

InputField.propTypes = {
    value: PropTypes.string,
    onChange: PropTypes.func,
};

export default InputField;
