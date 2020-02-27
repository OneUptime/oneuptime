import React, { useState, useRef, useEffect } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import Select from './react-select-fyipe';
import { renderIfSubProjectAdmin } from '../../config';

const errorStyle = {
    color: 'red',
    topMargin: '5px',
};

const SubProjectSelector = ({
    input,
    className,
    disabled,
    meta: { touched, error },
    currentProject,
    subProjects,
    style,
    id,
}) => {
    const options = [{ value: '', label: 'Select Sub-Project' }].concat(
        subProjects.map(subProject => {
            return {
                value: subProject._id,
                label: subProject.name,
                show: renderIfSubProjectAdmin(
                    currentProject,
                    subProjects,
                    subProject._id
                ),
            };
        })
    );

    const filteredOpt = useRef();
    filteredOpt.current = options.filter(opt => opt.value === input.value);

    const [value, setValue] = useState({
        value: input.value,
        label:
            filteredOpt.current.length > 0
                ? filteredOpt.current[0].label
                : 'Select Sub-Project',
    });

    useEffect(() => {
        setValue({
            value: input.value,
            label:
                filteredOpt.current.length > 0
                    ? filteredOpt.current[0].label
                    : 'Select Sub-Project',
        });
    }, [input]);

    const handleChange = option => {
        setValue(option);
        if (input.onChange) {
            input.onChange(option.value);
        }
    };

    return (
        <span>
            <div style={{ ...style, height: '28px' }}>
                <Select
                    name={input.name}
                    value={value}
                    onChange={handleChange}
                    className={className}
                    id={id}
                    isDisabled={disabled || false}
                    options={options.filter(opt =>
                        opt.show !== undefined ? opt.show : true
                    )}
                />
            </div>
            {touched && error && <span style={errorStyle}>{error}</span>}
        </span>
    );
};

SubProjectSelector.displayName = 'SubProjectSelector';

function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject,
    };
}

SubProjectSelector.propTypes = {
    input: PropTypes.object.isRequired,
    className: PropTypes.string,
    meta: PropTypes.object.isRequired,
    disabled: PropTypes.bool,
    style: PropTypes.object,
    id: PropTypes.string,
    subProjects: PropTypes.array.isRequired,
    currentProject: PropTypes.object,
};

export default connect(mapStateToProps)(SubProjectSelector);
