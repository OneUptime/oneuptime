import React from 'react';

import Select from 'react-select';
import PropTypes from 'prop-types';

const ReactSelectOneUptime: Function = (props: $TSFixMe) => {
    return (
        <Select
            {...props}
            styles={{
                control: (provided: $TSFixMe) => {
                    return {
                        ...provided,
                        border: '1px solid hsl(0,0%,80%) !important',
                        boxShadow: 'unset !important',
                        minHeight: 'unset',

                        height:
                            props.style && props.style.height
                                ? props.style.height
                                : '30px',
                    };
                },

                option: (provided, state) => {
                    return {
                        ...provided,
                        backgroundColor: state.isSelected ? 'black' : 'unset',

                        ':hover': {
                            ...provided[':hover'],
                            backgroundColor: state.isSelected
                                ? 'black'
                                : '#ededed',
                        },
                    };
                },
                menu: (provided: $TSFixMe) => {
                    return {
                        ...provided,
                        zIndex: 5,
                    };
                },
            }}
        />
    );
};

ReactSelectOneUptime.displayName = 'ReactSelectOneUptime';
ReactSelectOneUptime.propTypes = {
    style: PropTypes.object,
};
export default ReactSelectOneUptime;
