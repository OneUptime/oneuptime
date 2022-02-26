import React, { useState, useRef, useEffect } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import Select from './Select';
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
    id
}: $TSFixMe) => {
    const options = [{ value: '', label: 'Select Sub-Project' }].concat(
        subProjects.map((subProject: $TSFixMe) => {
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
    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ value: string; label: string; }[]' is not ... Remove this comment to see the full error message
    filteredOpt.current = options.filter(opt => opt.value === input.value);

    const [value, setValue] = useState({
        value: input.value,
        label:
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            filteredOpt.current.length > 0
                // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                ? filteredOpt.current[0].label
                : 'Select Sub-Project',
    });

    useEffect(() => {
        setValue({
            value: input.value,
            label:
                // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                filteredOpt.current.length > 0
                    // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                    ? filteredOpt.current[0].label
                    : 'Select Sub-Project',
        });
    }, [input]);

    const handleChange = (option: $TSFixMe) => {
        setValue(option);
        if (input.onChange) {
            input.onChange(option.value);
        }
    };

    return (
        <span>
            <div style={{ ...style, height: '28px' }}>
                <Select
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: any; value: { value: any; label: any... Remove this comment to see the full error message
                    name={input.name}
                    value={value}
                    onChange={handleChange}
                    className={className}
                    id={id}
                    isDisabled={disabled || false}
                    options={options.filter(opt =>
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'show' does not exist on type '{ value: s... Remove this comment to see the full error message
                        opt.show !== undefined ? opt.show : true
                    )}
                />
            </div>
            {touched && error && <span style={errorStyle}>{error}</span>}
        </span>
    );
};

SubProjectSelector.displayName = 'SubProjectSelector';

function mapStateToProps(state: $TSFixMe) {
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
