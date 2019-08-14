import React from 'react';
import PropTypes from 'prop-types'
import { Field } from 'redux-form';
import {RenderField} from './RenderField';
import { ValidateField } from '../../config';

const flexStyle = {
    display: 'inline-block',
    padding: '10px 20px'
}

const RenderHeaders = ({ fields }) => {
    if (!fields || !fields.length) {
        fields.push({ key: '', value: '' })
    }
    return (
        <ul>
            {
                fields.map((val, i) => {
                    return (
                        <li key={i}>
                            <div className="bs-Fieldset-row" style={Object.assign({},flexStyle,{marginLeft:'10px'})}>
                                <label className="bs-Fieldset-label" style={{padding: '6px'}}>Key</label>
                                <div className="bs-Fieldset-fields" style={{width:'340px'}}>
                                    <Field
                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                        type="text"
                                        name={`${val}.key`}
                                        component={RenderField}
                                        placeholder="KEY"
                                        style={{width:'340px'}}
                                        validate={ValidateField.required}
                                    />
                                </div>
                            </div>
                            <div className="bs-Fieldset-row" style={flexStyle}>
                                <label className="bs-Fieldset-label" style={{padding: '6px'}}>Value</label>
                                <div className="bs-Fieldset-fields" style={{width:'350px'}}>
                                    <Field
                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                        type="text"
                                        name={`${val}.value`}
                                        component={RenderField}
                                        placeholder="VALUE"
                                        style={{width:'340px'}}
                                        validate={ValidateField.required}
                                    />
                                </div>
                            </div>
                            <div className="bs-Fieldset-row" style={Object.assign({},flexStyle,{marginLeft:'35px'})}>
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
                    )
                })
            }
        </ul>
    )
}

RenderHeaders.displayName = 'RenderHeaders'

RenderHeaders.propTypes = {
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired
}

export { RenderHeaders }