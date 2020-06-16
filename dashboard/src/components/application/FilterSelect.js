import React from 'react';

import CreatableSelect from 'react-select/creatable';

const FilterSelect = props => (
    <CreatableSelect
        {...props}
        formatCreateLabel={ (val) => `Filter logs by ${val}`}
        noOptionsMessage={ () => `No filter options yet...`}
        styles={{
            control: provided => ({
                ...provided,
                border: '1px solid hsl(0,0%,80%) !important',
                boxShadow: 'unset !important',
                minHeight: 'unset',
                height: '30px',
            }),
            option: (provided, state) => ({
                ...provided,
                backgroundColor: state.isSelected ? 'black' : 'unset',
                ':hover': {
                    ...provided[':hover'],
                    backgroundColor: state.isSelected ? 'black' : '#ededed',
                },
            }),
            menu: provided => ({
                ...provided,
                zIndex: 5,
            }),
        }}
        isClearable
    />
);

FilterSelect.displayName = 'FilterSelect';

export default FilterSelect;
