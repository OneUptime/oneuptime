import React from 'react';
import Select from 'react-select';
import PropTypes from 'prop-types';

const ReactSelectFyipe = props => (
    <Select
        {...props}
        styles={{
            control: provided => ({
                ...provided,
                border: '1px solid hsl(0,0%,80%) !important',
                boxShadow: 'unset !important',
                minHeight: 'unset',
                height:
                    props.style && props.style.height
                        ? props.style.height
                        : '30px',
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
    />
);

ReactSelectFyipe.displayName = 'ReactSelectFyipe';
ReactSelectFyipe.propTypes = {
    style: PropTypes.object,
};
export default ReactSelectFyipe;
