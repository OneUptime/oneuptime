import React from 'react';


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
