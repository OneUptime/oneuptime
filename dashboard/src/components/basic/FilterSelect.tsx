import React from 'react';

// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import CreatableSelect from 'react-select/creatable';

const FilterSelect = (props: $TSFixMe) => <CreatableSelect
    {...props}
    formatCreateLabel={(val: $TSFixMe) => `Create ${val}`}
    noOptionsMessage={() => `No options yet...`}
    styles={{
        control: (provided: $TSFixMe) => ({
            ...provided,
            border: '1px solid hsl(0,0%,80%) !important',
            boxShadow: 'unset !important',
            minHeight: 'unset',
            height: '30px'
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
    isClearable
/>;

FilterSelect.displayName = 'FilterSelect';

export default FilterSelect;
