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
const placeholderfilter = ['greaterThan', 'lessThan', 'inBetween', 'isUp', 'isDown', 'empty', 'notEmpty'];
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
        'cpuLoad': '20',
        'memoryUsage': '20',
        'storageUsage': '20',
        'temperature': '20'
    },
    'lessThan': {
        'responseTime': '4000',
        'statusCode': '400',
        'cpuLoad': '100',
        'memoryUsage': '100',
        'storageUsage': '100',
        'temperature': '100'
    },
    'inBetween': {
        'responseTime': '2000',
        'statusCode': '200',
        'cpuLoad': '20',
        'memoryUsage': '20',
        'storageUsage': '20',
        'temperature': '20'
    },
    'equalTo': {
        'responseTime': '2000',
        'statusCode': '200',
        'cpuLoad': '20',
        'memoryUsage': '20',
        'storageUsage': '20',
        'temperature': '20'
    },
    'notEqualTo': {
        'responseTime': '2000',
        'statusCode': '200',
        'cpuLoad': '20',
        'memoryUsage': '20',
        'storageUsage': '20',
        'temperature': '20'
    },
    'gtEqualTo': {
        'responseTime': '2000',
        'statusCode': '200',
        'cpuLoad': '20',
        'memoryUsage': '20',
        'storageUsage': '20',
        'temperature': '20'
    },
    'ltEqualTo': {
        'responseTime': '2000',
        'statusCode': '200',
        'cpuLoad': '20',
        'memoryUsage': '20',
        'storageUsage': '20',
        'temperature': '20'
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
        'executes': '2000'
    },
    'doesNotExecuteIn': {
        'executes': '5000'
    },
    'throwsError': {
        'error': 'response.error !== {}'
    },
    'doesNotThrowError': {
        'error': 'response.error === null'
    }
}

export class RenderOption extends Component {
    render() {
        const { addArrayField, removeArrayField, fieldnameprop, bodyfield, addField, removeField, level, type } = this.props;
        const filterval = bodyfield && bodyfield.filter && bodyfield.filter !== '' ? bodyfield.filter : '';
        return (
            <li style={{ display: 'flex', flexFlow: 'row wrap' }}>
                <div className="bs-Fieldset-row" style={Object.assign({}, flexStyle, { marginLeft: `${level > 1 ? (level * 10) + 10 : 10}px` })}>
                    <label className="bs-Fieldset-label" style={{ padding: '6px' }}>Type</label>
                    <div className="bs-Fieldset-fields">
                        <Field className="db-select-nw db-select-nw-180"
                            component={RenderSelect}
                            name={`${fieldnameprop}.responseType`}
                            id="responseType"
                            placeholder="Response Type"
                            disabled={false}
                            onChange={() => bodyfield.filter = ''}
                            validate={ValidateField.select}
                            style={{ width: `${level > 1 ? 180 - (level * 10) : 180}px` }}
                            options={[
                                { value: '', label: 'None' },
                                { value: 'responseTime', label: 'Response Time', show: type !== 'script' && type !== 'server-monitor' },
                                { value: 'doesRespond', label: 'Is Online', show: type !== 'script' && type !== 'server-monitor' },
                                { value: 'statusCode', label: 'Status Code', show: type !== 'script' && type !== 'server-monitor' },
                                { value: 'responseBody', label: 'Response Body', show: type !== 'script' && type !== 'server-monitor' },
                                { value: 'executes', label: 'Executes', show: type === 'script' },
                                { value: 'error', label: 'Error', show: type === 'script' },
                                { value: 'javascriptExpression', label: 'JavaScript Expression', show: type === 'script' },
                                { value: 'cpuLoad', label: 'CPU Load', show: type === 'server-monitor' },
                                { value: 'memoryUsage', label: 'Memory Usage', show: type === 'server-monitor' },
                                { value: 'storageUsage', label: 'Storage Usage', show: type === 'server-monitor' },
                                { value: 'temperature', label: 'Temperature', show: type === 'server-monitor' }
                            ]}
                        />
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
                                placeholder="response.data === {}"
                                style={filterval !== '' && filterval === 'jsExpression' ? { width: '426px' } : bodyfield && filterval !== '' && bodyfield.responseType === 'responseTime' ? { width: '180px' } : { width: '200px' }}
                            />
                        </div>
                    </div> :
                    <div className="bs-Fieldset-row" style={bodyfield && bodyfield.responseType && bodyfield.responseType !== '' && bodyfield.responseType !== 'javascriptExpression' ? flexStyle : flexStylehidden}>
                        <label className="bs-Fieldset-label" style={{ padding: '6px' }}>Filter</label>
                        <div className="bs-Fieldset-fields">
                            <Field className="db-select-nw db-select-nw-180"
                                component={RenderSelect}
                                name={`${fieldnameprop}.filter`}
                                id="filter"
                                placeholder="Response Method"
                                disabled={false}
                                validate={ValidateField.select}
                                style={{ width: '180px' }}
                                options={[
                                    { value: '', label: 'None' },
                                    { value: 'greaterThan', label: 'Greater Than', show: bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode' || type === 'server-monitor') },
                                    { value: 'lessThan', label: 'Less Than', show: bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode' || type === 'server-monitor') },
                                    { value: 'inBetween', label: 'In Between', show: bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode' || type === 'server-monitor') },
                                    { value: 'isUp', label: 'True', show: bodyfield && bodyfield.responseType === 'doesRespond' },
                                    { value: 'isDown', label: 'False', show: bodyfield && bodyfield.responseType === 'doesRespond' },
                                    { value: 'equalTo', label: 'Equal To', show: bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode' || type === 'server-monitor') },
                                    { value: 'notEqualTo', label: 'Not Equal To', show: bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode' || type === 'server-monitor') },
                                    { value: 'gtEqualTo', label: 'Greater Than Equal To', show: bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode' || type === 'server-monitor') },
                                    { value: 'ltEqualTo', label: 'Less Than Equal To', show: bodyfield && (bodyfield.responseType === 'responseTime' || bodyfield.responseType === 'statusCode' || type === 'server-monitor') },
                                    { value: 'contains', label: 'Contains', show: bodyfield && bodyfield.responseType === 'responseBody' },
                                    { value: 'doesNotContain', label: 'Does not Contain', show: bodyfield && bodyfield.responseType === 'responseBody' },
                                    { value: 'jsExpression', label: 'Javascript Expression', show: bodyfield && bodyfield.responseType === 'responseBody' },
                                    { value: 'empty', label: 'Is empty', show: bodyfield && bodyfield.responseType === 'responseBody' },
                                    { value: 'notEmpty', label: 'Is not empty', show: bodyfield && bodyfield.responseType === 'responseBody' },
                                    { value: 'executesIn', label: 'Executes in', show: bodyfield && bodyfield.responseType === 'executes' },
                                    { value: 'doesNotExecuteIn', label: 'Does not execute in', show: bodyfield && bodyfield.responseType === 'executes' },
                                    { value: 'throwsError', label: 'Throws error', show: bodyfield && bodyfield.responseType === 'error' },
                                    { value: 'doesNotThrowError', label: 'Does not throw error', show: bodyfield && bodyfield.responseType === 'error' },
                                ]}
                            />
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
                            validate={filterval !== '' && firstField.indexOf(filterval) > -1 ? filterval === 'jsExpression' || bodyfield.responseType === 'error' ? ValidateField.required : [ValidateField.required, ValidateField.maxValue10000] : undefined}
                            placeholder={bodyfield && filterval && bodyfield.responseType && placeholderfilter.indexOf(filterval) <= -1 && placeholders[filterval][bodyfield.responseType] ? placeholders[filterval][bodyfield.responseType] : ''}
                            style={filterval !== '' && filterval === 'jsExpression' ? { width: '426px' } : bodyfield && filterval !== '' && bodyfield.responseType === 'responseTime' ? { width: '180px' } : { width: '200px' }}
                        />
                    </div>
                </div>
                {bodyfield && filterval !== '' && bodyfield.responseType === 'responseTime' ? <span style={{ display: 'inline-block', marginTop: '37px' }}>ms</span> : ''}
                {bodyfield && filterval !== '' && (bodyfield.responseType === 'cpuLoad' || bodyfield.responseType === 'memoryUsage' || bodyfield.responseType === 'storageUsage') ? <span style={{ display: 'inline-block', marginTop: '37px' }}>%</span> : ''}
                {bodyfield && filterval !== '' && bodyfield.responseType === 'temperature' ? <span style={{ display: 'inline-block', marginTop: '37px' }}>&deg;c</span> : ''}
                {filterval !== '' && filterval === 'jsExpression' ? '' :
                    <React.Fragment>
                        <div className="bs-Fieldset-row" style={filterval !== '' && filterval === 'inBetween' ? flexStyle : flexStylehidden}>
                            <label className="bs-Fieldset-label" style={{ padding: '6px' }}>End Value</label>
                            <div className="bs-Fieldset-fields">
                                <Field
                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                    type="text"
                                    name={`${fieldnameprop}.field2`}
                                    component={RenderField}
                                    validate={filterval !== '' && filterval === 'inBetween' ? [ValidateField.required, ValidateField.maxValue10000] : undefined}
                                    placeholder={bodyfield && filterval && bodyfield.responseType && placeholderfilter.indexOf(filterval) <= -1 && placeholders[filterval][bodyfield.responseType] ? placeholders['lessThan'][bodyfield.responseType] : ''}
                                    style={bodyfield && filterval !== '' && bodyfield.responseType === 'responseTime' && filterval === 'inBetween' ? { width: '180px' } : { width: '200px' }}
                                />
                            </div>
                        </div>
                        {bodyfield && filterval !== '' && bodyfield.responseType === 'responseTime' && filterval === 'inBetween' ? <span style={{ display: 'inline-block', marginTop: '37px' }}>ms</span> : ''}
                        {bodyfield && filterval !== '' && (bodyfield.responseType === 'cpuLoad' || bodyfield.responseType === 'memoryUsage' || bodyfield.responseType === 'storageUsage') && filterval === 'inBetween' ? <span style={{ display: 'inline-block', marginTop: '37px' }}>%</span> : ''}
                        {bodyfield && filterval !== '' && bodyfield.responseType === 'temperature' && filterval === 'inBetween' ? <span style={{ display: 'inline-block', marginTop: '37px' }}>&deg;c</span> : ''}
                    </React.Fragment>
                }
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

RenderOption.displayName = 'RenderOption';

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
};

const mapDispatchToProps = dispatch => bindActionCreators(
    { addArrayField, removeArrayField }, dispatch);

function mapStateToProps() {
    return {
        // bodyfield: newSelector(state, `${ownProps.fieldname}`),
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(RenderOption);