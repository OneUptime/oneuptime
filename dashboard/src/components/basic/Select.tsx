import React from 'react';

import ReactSelect from 'react-select';
import PropTypes from 'prop-types';

const Select = (props: $TSFixMe) => <ReactSelect
    {...props}
    styles={{
        control: (provided: $TSFixMe) => ({
            ...provided,
            border: '1px solid hsl(0,0%,80%) !important',
            boxShadow: 'unset !important',
            minHeight: 'unset',

            height:
                props.style && props.style.height
                    ? props.style.height
                    : '30px'
        }),

        option: (provided, state) => ({
            ...provided,
            backgroundColor: state.isSelected ? 'black' : 'unset',

            ':hover': {
                ...provided[':hover'],
                backgroundColor: state.isSelected ? 'black' : '#ededed',
            }
        }),
        menu: (provided: $TSFixMe) => ({
            ...provided,
            zIndex: 5
        }),
    }}
/>;

Select.displayName = 'Select';
Select.propTypes = {
    style: PropTypes.object,
};
export default Select;
