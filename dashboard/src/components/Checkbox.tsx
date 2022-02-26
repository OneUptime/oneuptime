import PropTypes from 'prop-types';
import React from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field } from 'redux-form';

const Checkbox = ({
    name,
    text
}: $TSFixMe) => {
    return (
        <div className="bs-Fieldset-row">
            <label
                className="bs-Fieldset-label"
                style={{
                    flex: '30% 0 0',
                }}
            >
                <span></span>
            </label>
            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                <div
                    className="Box-root"
                    style={{
                        height: '5px',
                    }}
                ></div>
                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                    <label className="Checkbox">
                        <Field
                            component="input"
                            type="checkbox"
                            name={name}
                            className="Checkbox-source"
                            id={name}
                        />
                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                            <div className="Checkbox-target Box-root">
                                <div className="Checkbox-color Box-root"></div>
                            </div>
                        </div>
                        <div
                            className="Box-root"
                            style={{
                                paddingLeft: '5px',
                            }}
                        >
                            <span>{text}</span>
                        </div>
                    </label>
                </div>
            </div>
        </div>
    );
};
Checkbox.displayName = 'Checkbox';
Checkbox.propTypes = {
    name: PropTypes.string.isRequired,
    text: PropTypes.string.isRequired,
};

export default Checkbox;
