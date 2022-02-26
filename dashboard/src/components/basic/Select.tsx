import React from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'provided' implicitly has an 'any' type.
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
