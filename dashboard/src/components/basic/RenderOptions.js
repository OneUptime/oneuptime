import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Component } from 'react';
import { Field, } from 'redux-form';
import PropTypes from 'prop-types';
import { addArrayField, removeArrayField } from '../../actions/monitor';
import { ValidateField } from '../../config';
import { RenderSelect } from './RenderSelect';
import { RenderField } from './RenderField';

const flexStyle = {
    display: 'inline-block',
    padding: '10px 4px'
}
const flexStylehidden = {
    display: 'inline-block',
    padding: '10px 4px',
    visibility: 'hidden',
}

const firstField = ['greaterThan', 'lessThan', 'inBetween', 'equalTo', 'notEqualto', 'gtEqualTo', 'ltEqualTo', 'contains', 'doesNotContain', 'jsExpression', 'executesIn', 'doesNotExecuteIn', 'throwsError', 'doesNotThrowError'];
const placeholderfilter = ['isUp', 'isDown', 'empty', 'notEmpty'];
const mapValue = {
    'greaterThan': 'Greater Than',
    'lessThan': 'Less Than',
    'inBetween': 'Start Value',
    'equalTo': 'Equal To',
    'notEqualTo': 'Not Equal To',
    'gtEqualTo': 'Greater Than Equal To',
    'ltEqualTo': 'Less Than Equal To',
    'contains': 'Contains',
    'doesNotContain': 'Does not Contain',
    'jsExpression': 'Javascript Expression',
    'executesIn': 'Executes in',
    'doesNotExecuteIn': 'Does not execute in',
    'throwsError': 'Throws error',
    'doesNotThrowError': 'Does not throw error'
}

const placeholders = {
    'greaterThan': {
        'responseTime': '2000',
        'statusCode': '200',
    },
    'lessThan': {
        'responseTime': '4000',
        'statusCode': '400',
    },
    'inBetween': {
        'responseTime': '2000',
        'statusCode': '200',
    },
    'equalTo': {
        'responseTime': '2000',
        'statusCode': '200',
    },
    'notEqualTo': {
        'responseTime': '2000',
        'statusCode': '200',
    },
    'gtEqualTo': {
        'responseTime': '2000',
        'statusCode': '200',
    },
    'ltEqualTo': {
        'responseTime': '2000',
        'statusCode': '200',
    },
    'contains': {
        'responseBody': 'Contains'
    },
    'doesNotContain': {
        'responseBody': 'Does not Contain'
    },
    'jsExpression': {
        'responseBody': 'response.data === {}'
    },
    'executesIn': {
        'responseTime': '2000',
        'statusCode': '200'
    },
    'doesNotExecuteIn': {
        'responseTime': '2000'
    },
    'throwsError': {
        'responseBody': 'Contains'
    },
    'doesNotThrowError': {
        'responseBody': 'Does not Contain'
    }
}

export class RenderOption extends Component {
    render() {
        const { addArrayField, removeArrayField, fieldnameprop, bodyfield, addField, removeField, level } = this.props;
        const filterval = bodyfield && bodyfield.filter && bodyfield.filter !== '' ? bodyfield.filter : '';
        return (
            <li>
                <div className="bs-Fieldset-row" style={Object.assign({}, flexStyle, { marginLeft: `${level > 1 ? (level * 10) + 10 : 10}px` })}>
                    <label className="bs-Fieldset-label" style={{ padding: '6px' }}>Type</label>
                    <div className="bs-Fieldset-fields">
                        <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                            component={RenderSelect}
                            name={`${fieldnameprop}.responseType`}
                            id="responseType"
                            placeholder="Response Type"
                            disabled={false}
                            style={{ width: `${level > 1 ? 180 - (level * 10) : 180}px` }}
                            onChange={() => bodyfield.filter = ''}
                            validate={ValidateField.select}
                        >
                            <option value="">None</option>
                            {this.props.type !== 'script' ? <option value="responseTime">Response Time</option> : ''}
                            {this.props.type !== 'script' ? <option value="doesRespond">Does Respond</option> : ''}
                            {this.props.type !== 'script' ? <option value="statusCode">Status Code</option> : ''}
                            {this.props.type !== 'script' ? <option value="responseBody">Response Body</option> : ''}
                            {this.props.type === 'script' ? <option value="executes">Executes</option> : ''}
                            {this.props.type === 'script' ? <option value="error">Error</option> : ''}
                            {this.props.type === 'script' ? <option value="javascriptExpression">JavaScript Expression</option> : ''}
                        </Field>
                    </div>
                </div>
                {bodyfield && bodyfield.responseType === 'javascriptExpression' ?
                    <div className="bs-Fieldset-row" style={bodyfield !== '' && bodyfield.responseType === 'javascriptExpression' ? flexStyle : flexStylehidden}>
                        <label className="bs-Fieldset-label" style={{ padding: '6px' }}>JavaScript Expression</label>
                        <div className="bs-Fieldset-fields">
                            <Field
                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                type="text"
                                name={`${fieldnameprop}.field1`}
                                component={RenderField}
                                validate={filterval !== '' && firstField.indexOf(filterval) > -1 ? filterval === 'jsExpression' ? ValidateField.required : [ValidateField.required, ValidateField.maxValue10000] : undefined}
                                placeholder={bodyfield && filterval && bodyfield.responseType && placeholderfilter.indexOf(filterval) <= -1 && placeholders[filterval][bodyfield.responseType] ? placeholders[filterval][bodyfield.responseType] : ''}
                                style={filterval !== '' && filterval === 'jsExpression' ? { width: '426px' } : bodyfield && filterval !== '' && bodyfield.responseType === 'responseTime' ? { width: '180px' } : { width: '200px' }}
                            />
                        </div>
                    </div> :
                    <div className="bs-Fieldset-row" style={bodyfield && bodyfield.responseType && bodyfield.responseType !== '' && bodyfield.responseType !== 'javascriptExpression' ? flexStyle : flexStylehidden}>
                        <label className="bs-Fieldset-label" style={{ padding: '6px' }}>Filter</label>
                        <div className="bs-Fieldset-fields">
                            <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                component={RenderSelect}
                                name={`${fieldnameprop}.filter`}
                                id="filter"
                                placeholder="Response Method"
                                disabled={false}
                                style={{ width: '180px' }}
                                validate={ValidateField.select}
                            >
                                <option value="">None</option>
                                {bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode') ? <option value="greaterThan">Greater Than</option> : ''}
                                {bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode') ? <option value="lessThan">Less Than</option> : ''}
                                {bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode') ? <option value="inBetween">In Between</option> : ''}
                                {bodyfield && bodyfield.responseType === 'doesRespond' ? <option value="isUp">Is Up</option> : ''}
                                {bodyfield && bodyfield.responseType === 'doesRespond' ? <option value="isDown">Is Down</option> : ''}
                                {bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode') ? <option value="equalTo">Equal To</option> : ''}
                                {bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode') ? <option value="notEqualTo">Not Equal To</option> : ''}
                                {bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode') ? <option value="gtEqualTo">Greater Than Equal To</option> : ''}
                                {bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode') ? <option value="ltEqualTo">Less Than Equal To</option> : ''}
                                {bodyfield && bodyfield.responseType === 'responseBody' ? <option value="contains">Contains</option> : ''}
                                {bodyfield && bodyfield.responseType === 'responseBody' ? <option value="doesNotContain">Does not Contain</option> : ''}
                                {bodyfield && bodyfield.responseType === 'responseBody' ? <option value="jsExpression">Javascript Expression</option> : ''}
                                {bodyfield && bodyfield.responseType === 'responseBody' ? <option value="empty">Is empty</option> : ''}
                                {bodyfield && bodyfield.responseType === 'responseBody' ? <option value="notEmpty">Is not empty</option> : ''}
                                {bodyfield && bodyfield.responseType === 'executes' ? <option value="executesIn">Executes in</option> : ''}
                                {bodyfield && bodyfield.responseType === 'executes' ? <option value="doesNotExecuteIn">Does not execute in</option> : ''}
                                {bodyfield && bodyfield.responseType === 'error' ? <option value="throwsError">Throws error</option> : ''}
                                {bodyfield && bodyfield.responseType === 'error' ? <option value="doesNotThrowError">Does not throw error</option> : ''}
                            </Field>
                        </div>
                    </div>}

                <div className="bs-Fieldset-row" style={filterval !== '' && firstField.indexOf(filterval) > -1 ? filterval === 'jsExpression' ? Object.assign({}, flexStyle, { width: '426px' }) : flexStyle : flexStylehidden}>
                    <label className="bs-Fieldset-label" style={{ padding: '6px' }}>{filterval && mapValue[filterval] ? mapValue[filterval] : ''}</label>
                    <div className="bs-Fieldset-fields">
                        <Field
                            className="db-BusinessSettings-input TextInput bs-TextInput"
                            type="text"
                            name={`${fieldnameprop}.field1`}
                            component={RenderField}
                            validate={filterval !== '' && firstField.indexOf(filterval) > -1 ? filterval === 'jsExpression' ? ValidateField.required : [ValidateField.required, ValidateField.maxValue10000] : undefined}
                            placeholder={bodyfield && filterval && bodyfield.responseType && placeholderfilter.indexOf(filterval) <= -1 && placeholders[filterval][bodyfield.responseType] ? placeholders[filterval][bodyfield.responseType] : ''}
                            style={filterval !== '' && filterval === 'jsExpression' ? { width: '426px' } : bodyfield && filterval !== '' && bodyfield.responseType === 'responseTime' ? { width: '180px' } : { width: '200px' }}
                        />
                    </div>
                </div>
                {bodyfield && filterval !== '' && bodyfield.responseType === 'responseTime' ? <span style={{ display: 'inline-block' }}>ms</span> : ''}
                {filterval !== '' && filterval === 'jsExpression' ? '' :
                    <div className="bs-Fieldset-row" style={filterval !== '' && filterval === 'inBetween' ? flexStyle : flexStylehidden}>
                        <label className="bs-Fieldset-label" style={{ padding: '6px' }}>End Value</label>
                        <div className="bs-Fieldset-fields">
                            <Field
                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                type="text"
                                name={`${fieldnameprop}.field2`}
                                component={RenderField}
                                validate={filterval !== '' && filterval === 'inBetween' ? [ValidateField.required, ValidateField.maxValue10000] : undefined}
                                placeholder={bodyfield && bodyfield.responseType === 'statusCode' ? '400' : '4000'}
                                style={bodyfield && filterval !== '' && bodyfield.responseType === 'responseTime' && filterval === 'inBetween' ? { width: '180px' } : { width: '200px' }}
                            />
                        </div>
                    </div>}
                {bodyfield && filterval !== '' && bodyfield.responseType === 'responseTime' && filterval === 'inBetween' ? <span style={{ display: 'inline-block' }}>ms</span> : ''}
                <div className="bs-Fieldset-row" style={{ display: 'inline-block', padding: '4px' }}>
                    <label className="bs-Fieldset-label" style={{ padding: '6px' }}></label>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center">
                            <button
                                className="bs-Button bs-DeprecatedButton"
                                type="button"
                                onClick={() => addField()}
                                style={{ borderRadius: '50%', padding: '0px 6px' }}
                            >
                                <img src='/assets/img/plus.svg' style={{ height: '10px', width: '10px' }} alt="" />
                            </button>
                        </div>
                    </div>
                </div>
                <div className="bs-Fieldset-row" style={{ display: 'inline-block', padding: '4px' }}>
                    <label className="bs-Fieldset-label" style={{ padding: '6px' }}></label>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center">
                            <button
                                className="bs-Button bs-DeprecatedButton"
                                type="button"
                                onClick={() => removeField(removeArrayField)}
                                style={{ borderRadius: '50%', padding: '0px 6px' }}
                            >
                                <img src='/assets/img/minus.svg' style={{ height: '10px', width: '10px' }} alt="" />
                            </button>
                        </div>
                    </div>
                </div>
                <div className="bs-Fieldset-row" style={{ display: 'inline-block', padding: '4px' }}>
                    <label className="bs-Fieldset-label" style={{ padding: '6px' }}></label>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center">
                            <button
                                className="bs-Button bs-DeprecatedButton"
                                type="button"
                                onClick={() => addArrayField(fieldnameprop)}
                                style={{ borderRadius: '50%', padding: '0px 6px' }}
                            >
                                <img src='/assets/img/more.svg' style={{ height: '10px', width: '10px' }} alt="" />
                            </button>
                        </div>
                    </div>
                </div>
                <Field
                    className="db-BusinessSettings-input TextInput bs-TextInput"
                    type="text"
                    name={`${fieldnameprop}.field3`}
                    component="input"
                    placeholder=''
                    style={{ display: 'none' }}
                />
            </li>
        );
    }
}

RenderOption.displayName = 'RenderOption'

RenderOption.propTypes = {
    bodyfield: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]),
    addArrayField: PropTypes.func,
    removeArrayField: PropTypes.func,
    addField: PropTypes.func,
    removeField: PropTypes.func,
    level: PropTypes.number,
    fieldnameprop: PropTypes.string,
    type: PropTypes.string
}

const mapDispatchToProps = dispatch => bindActionCreators(
    { addArrayField, removeArrayField }, dispatch);

function mapStateToProps() {
    return {
        // bodyfield: newSelector(state, `${ownProps.fieldname}`),
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(RenderOption);