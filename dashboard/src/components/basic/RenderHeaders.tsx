import React from 'react';
import PropTypes from 'prop-types';
import { Field } from 'redux-form';
import { RenderField } from './RenderField';
import { ValidateField } from '../../config';

const flexStyle = {
    display: 'inline-block',
    padding: '10px 20px',
};

const RenderHeaders = ({ fields }) => {
    if (!fields || !fields.length)
        return (
            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                <div>
                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                        <fieldset className="bs-Fieldset">
                            <div className="bs-Fieldset-rows">
                                <ul></ul>
                            </div>
                        </fieldset>
                    </div>
                </div>
                <div className="bs-Fieldset-row">
                    <div className="Box-root Margin-bottom--12">
                        <div
                            data-test="RetrySettings-failedPaymentsRow"
                            className="Box-root"
                        >
                            <label
                                className="Checkbox"
                                htmlFor="smssmtpswitch"
                                style={{ marginLeft: '150px;' }}
                            >
                                Currently you do not have any header
                                saved.Please click the Add Headers button above
                                to add one.
                            </label>
                            <div className="Box-root Padding-left--24">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                    <div className="Box-root">
                                        <div className="Box-root"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );

    return (
        <ul>
            {fields.map((val, i) => {
                return (
                    <li key={i}>
                        <div className="bs-Fieldset-row" style={flexStyle}>
                            <label
                                className="bs-Fieldset-label"
                                style={{ padding: '6px' }}
                            >
                                Key
                            </label>
                            <div
                                className="bs-Fieldset-fields"
                                style={{ width: '250px' }}
                            >
                                <Field
                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                    type="text"
                                    id={`${val.replace(/\[|\]/gi, '_')}key`}
                                    name={`${val}.key`}
                                    component={RenderField}
                                    placeholder="KEY"
                                    style={{ width: '250px' }}
                                    validate={ValidateField.text}
                                />
                            </div>
                        </div>
                        <div className="bs-Fieldset-row" style={flexStyle}>
                            <label
                                className="bs-Fieldset-label"
                                style={{ padding: '6px' }}
                            >
                                Value
                            </label>
                            <div
                                className="bs-Fieldset-fields"
                                style={{ width: '250px' }}
                            >
                                <Field
                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                    type="text"
                                    id={`${val.replace(/\[|\]/gi, '_')}value`}
                                    name={`${val}.value`}
                                    component={RenderField}
                                    placeholder="VALUE"
                                    style={{ width: '250px' }}
                                    validate={ValidateField.text}
                                />
                            </div>
                        </div>
                        <div className="bs-Fieldset-row" style={flexStyle}>
                            <label className="bs-Fieldset-label"></label>
                            <div className="bs-Fieldset-fields">
                                <div className="Box-root Flex-flex Flex-alignItems--center">
                                    <button
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={() => fields.remove(i)}
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
};

RenderHeaders.displayName = 'RenderHeaders';

RenderHeaders.propTypes = {
    fields: PropTypes.oneOfType([PropTypes.array, PropTypes.object]).isRequired,
};

export { RenderHeaders };
