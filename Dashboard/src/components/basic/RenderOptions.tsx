import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { Component } from 'react';

import { Field, change, formValueSelector } from 'redux-form';
import PropTypes from 'prop-types';
import {
    addArrayField,
    removeArrayField,
    updateCriteriaField,
} from '../../actions/monitor';
import { ValidateField } from '../../config';
import { RenderSelect } from './RenderSelect';
import { RenderField } from './RenderField';
import Tooltip from './Tooltip';
import ShouldRender from './ShouldRender';

const flexStyle = {
    display: 'inline-block',
    padding: '10px 4px',
};
const flexStylehidden = {
    display: 'none',
    padding: '10px 4px',
    visibility: 'hidden',
};

const firstField = [
    'greaterThan',
    'lessThan',
    'inBetween',
    'equalTo',
    'notEqualTo',
    'gtEqualTo',
    'ltEqualTo',
    'contains',
    'doesNotContain',
    'jsExpression',
    'evaluateResponse',
    'executesIn',
    'doesNotExecuteIn',
    'throwsError',
    'doesNotThrowError',
];
const placeholderfilter = [
    'greaterThan',
    'lessThan',
    'inBetween',
    'isUp',
    'isDown',
    'empty',
    'notEmpty',
    'isValid',
    'notFound',
    'selfSigned',
    'expiresIn30',
    'expiresIn10',
    'emptyCallback',
    'nonEmptyCallback',
];
const mapValue = {
    greaterThan: 'Greater Than',
    lessThan: 'Less Than',
    inBetween: 'Start Value',
    equalTo: 'Equal To',
    notEqualTo: 'Not Equal To',
    gtEqualTo: 'Greater Than Equal To',
    ltEqualTo: 'Less Than Equal To',
    contains: 'Contains',
    doesNotContain: 'Does not Contain',
    jsExpression: 'Javascript Expression',
    evaluateResponse: 'Evaluate Response',
    executesIn: 'Executes Within',
    doesNotExecuteIn: 'Executes Longer Than',
    throwsError: 'Throws error',
    doesNotThrowError: 'Does not throw error',
};

const placeholders = {
    greaterThan: {
        responseTime: '2000',
        statusCode: '200',
        cpuLoad: '20',
        memoryUsage: '20',
        storageUsage: '20',
        temperature: '20',
    },
    lessThan: {
        responseTime: '4000',
        statusCode: '400',
        cpuLoad: '100',
        memoryUsage: '100',
        storageUsage: '100',
        temperature: '100',
    },
    inBetween: {
        responseTime: '2000',
        statusCode: '200',
        cpuLoad: '20',
        memoryUsage: '20',
        storageUsage: '20',
        temperature: '20',
    },
    equalTo: {
        responseTime: '2000',
        statusCode: '200',
        cpuLoad: '20',
        memoryUsage: '20',
        storageUsage: '20',
        temperature: '20',
        podStatus: 'running',
        jobStatus: 'succeeded',
    },
    notEqualTo: {
        responseTime: '2000',
        statusCode: '200',
        cpuLoad: '20',
        memoryUsage: '20',
        storageUsage: '20',
        temperature: '20',
        podStatus: 'running',
        jobStatus: 'succeeded',
    },
    gtEqualTo: {
        responseTime: '2000',
        statusCode: '200',
        cpuLoad: '20',
        memoryUsage: '20',
        storageUsage: '20',
        temperature: '20',
    },
    ltEqualTo: {
        responseTime: '2000',
        statusCode: '200',
        cpuLoad: '20',
        memoryUsage: '20',
        storageUsage: '20',
        temperature: '20',
    },
    contains: {
        responseBody: 'Contains',
        queryString: 'abc=xyz',
        headers: 'Cache-Control=no-cache',
    },
    doesNotContain: {
        responseBody: 'Does not Contain',
    },
    jsExpression: {
        responseBody: 'request.body === {}',
    },
    evaluateResponse: {
        responseBody: "typeof response === 'object'",
    },
    executesIn: {
        executionTime: '2000',
    },
    doesNotExecuteIn: {
        executionTime: '5000',
    },
    throwsError: {
        error: 'response.error !== {}',
    },
    doesNotThrowError: {
        error: 'response.error === null',
    },
};

interface RenderOptionProps {
    bodyfield?: unknown[] | object;
    addArrayField?: Function;
    removeArrayField?: Function;
    addField?: Function;
    removeField?: Function;
    updateCriteriaField?: Function;
    level?: number;
    fieldnameprop?: string;
    type?: string;
    change: Function;
    criterionType?: string;
    formCriteria?: unknown[];
}

export class RenderOption extends Component<RenderOptionProps>{
    public static displayName = '';
    public static propTypes = {};
    override render() {
        const {

            addArrayField,

            removeArrayField,

            fieldnameprop,

            bodyfield,

            addField,

            removeField,

            level,

            type,

            change,

            criterionType,
        } = this.props;

        const filterval =
            bodyfield && bodyfield.filter && bodyfield.filter !== ''
                ? bodyfield.filter
                : '';
        return (
            <li style={{ display: 'flex', flexFlow: 'row wrap' }}>
                <div
                    className="bs-Fieldset-row"
                    style={Object.assign({}, flexStyle, {
                        marginLeft: `${level > 1 ? level * 10 : 10}px`,
                    })}
                >
                    <label
                        className="bs-Fieldset-label"
                        style={{ padding: '6px' }}
                    >
                        Type
                    </label>
                    <div className="bs-Fieldset-fields">
                        <Field
                            className="db-select-nw db-select-nw-180"
                            component={RenderSelect}
                            name={`${fieldnameprop}.responseType`}
                            id="responseType"
                            placeholder="Response Type"
                            disabled={false}
                            onChange={() => {
                                change(
                                    'NewMonitor',
                                    `${fieldnameprop}.filter`,
                                    ''
                                );
                            }}
                            validate={ValidateField.select}
                            style={{
                                width: `${level > 1 ? 180 - level * 10 : 180
                                    }px`,
                            }}
                            options={[
                                { value: '', label: 'None' },
                                {
                                    value: 'responseTime',
                                    label: 'Response Time',
                                    show:
                                        type !== 'script' &&
                                        type !== 'server-monitor' &&
                                        type !== 'incomingHttpRequest' &&
                                        type !== 'kubernetes' &&
                                        type !== 'ip',
                                },
                                {
                                    value: 'doesRespond',
                                    label: 'Is Online',
                                    show:
                                        type !== 'script' &&
                                        type !== 'incomingHttpRequest' &&
                                        type !== 'kubernetes' &&
                                        type !== 'ip',
                                },
                                {
                                    value: 'statusCode',
                                    label: 'Status Code',
                                    show:
                                        type !== 'script' &&
                                        type !== 'server-monitor' &&
                                        type !== 'incomingHttpRequest' &&
                                        type !== 'kubernetes' &&
                                        type !== 'ip',
                                },
                                {
                                    value: 'responseBody',
                                    label:
                                        type !== 'incomingHttpRequest'
                                            ? 'Response Body'
                                            : 'Request Body',
                                    show:
                                        type !== 'script' &&
                                        type !== 'server-monitor' &&
                                        type !== 'kubernetes' &&
                                        type !== 'ip',
                                },
                                {
                                    value: 'ssl',
                                    label: 'SSL',
                                    show:
                                        type !== 'script' &&
                                        type !== 'server-monitor' &&
                                        type !== 'incomingHttpRequest' &&
                                        type !== 'kubernetes' &&
                                        type !== 'ip',
                                },
                                {
                                    value: 'scriptExecution',
                                    label: 'Script Execution',
                                    show: type === 'script',
                                },
                                {
                                    value: 'executionTime',
                                    label: 'Script Execution Time',
                                    show: type === 'script',
                                },
                                {
                                    value: 'cpuLoad',
                                    label: 'CPU Load',
                                    show: type === 'server-monitor',
                                },
                                {
                                    value: 'memoryUsage',
                                    label: 'Memory Usage',
                                    show: type === 'server-monitor',
                                },
                                {
                                    value: 'storageUsage',
                                    label: 'Free Storage',
                                    show: type === 'server-monitor',
                                },
                                {
                                    value: 'temperature',
                                    label: 'Temperature',
                                    show: type === 'server-monitor',
                                },
                                {
                                    value: 'incomingTime',
                                    label: 'Request Incoming Time',
                                    show: type === 'incomingHttpRequest',
                                },
                                {
                                    value: 'queryString',
                                    label: 'Request Query Param',
                                    show: type === 'incomingHttpRequest',
                                },
                                {
                                    value: 'headers',
                                    label: 'Request Headers',
                                    show: type === 'incomingHttpRequest',
                                },
                                {
                                    value: 'respondsToPing',
                                    label: 'Responds To Ping',
                                    show: type === 'ip',
                                },
                                {
                                    value: 'podStatus',
                                    label: 'Pod Status',
                                    show: type === 'kubernetes',
                                },
                                {
                                    value: 'jobStatus',
                                    label: 'Job Status',
                                    show: type === 'kubernetes',
                                },
                                {
                                    value: 'desiredDeployment',
                                    label: 'Desired Deployments',
                                    show: type === 'kubernetes',
                                },
                                {
                                    value: 'desiredStatefulsets',
                                    label: 'Desired Statefulset',
                                    show: type === 'kubernetes',
                                },
                            ]}
                        />
                    </div>
                </div>

                {bodyfield &&
                    bodyfield.responseType === 'javascriptExpression' ? (
                    <div
                        className="bs-Fieldset-row"
                        style={
                            bodyfield !== '' &&
                                bodyfield.responseType === 'javascriptExpression'
                                ? flexStyle
                                : flexStylehidden
                        }
                    >
                        <label
                            className="bs-Fieldset-label"
                            style={{ padding: '6px' }}
                        >
                            JavaScript Expression
                        </label>
                        <div className="bs-Fieldset-fields">
                            <Field
                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                type="text"
                                name={`${fieldnameprop}.field1`}
                                component={RenderField}
                                validate={
                                    filterval !== '' &&
                                        firstField.indexOf(filterval) > -1
                                        ? filterval === 'jsExpression'
                                            ? ValidateField.required
                                            : [
                                                ValidateField.required,
                                                ValidateField.maxValue10000,
                                            ]
                                        : undefined
                                }
                                placeholder="response.body === {}"
                                style={
                                    filterval !== '' &&
                                        filterval === 'jsExpression'
                                        ? { width: '426px' }
                                        : bodyfield &&
                                            filterval !== '' &&
                                            bodyfield.responseType ===
                                            'responseTime'
                                            ? { width: '180px' }
                                            : { width: '200px' }
                                }
                            />
                        </div>

                        <Tooltip title="Incoming http Request Filter">
                            <p>
                                JavaScript expressions that evaluates to a
                                boolean value is needed here.{' '}
                                <code>request</code> object is also available to
                                be used in the JS expression.
                            </p>
                            <p>Example JavaScript Expression:</p>
                            <p>
                                <ul>
                                    <li>
                                        <code>request.body.id === 1</code>
                                    </li>
                                </ul>
                                If you attach <code>id</code> with a value of{' '}
                                <code>1</code> when sending your request, the JS
                                expression should evaluate to true, else it will
                                evaluate to false
                            </p>
                        </Tooltip>
                    </div>
                ) : (
                    <div
                        className="bs-Fieldset-row"
                        style={
                            bodyfield &&
                                bodyfield.responseType &&
                                bodyfield.responseType !== '' &&
                                bodyfield.responseType !== 'javascriptExpression'
                                ? flexStyle
                                : flexStylehidden
                        }
                    >
                        <label
                            className="bs-Fieldset-label"
                            style={{ padding: '6px' }}
                        >
                            Filter
                        </label>
                        <div className="bs-Fieldset-fields">
                            <Field
                                className="db-select-nw db-select-nw-180"
                                component={RenderSelect}
                                name={`${fieldnameprop}.filter`}
                                id="filter"
                                placeholder="Response Method"
                                disabled={false}
                                validate={ValidateField.select}
                                style={{ width: '180px' }}
                                options={[
                                    { value: '', label: 'None' },
                                    {
                                        value: 'greaterThan',
                                        label: 'Greater Than',
                                        show:
                                            bodyfield &&
                                            (bodyfield.responseType ===
                                                'responseTime' ||
                                                bodyfield.responseType ===
                                                'statusCode' ||
                                                bodyfield.responseType ===
                                                'incomingTime' ||
                                                type === 'server-monitor' ||
                                                bodyfield.responseType ===
                                                'podRestarts'),
                                    },
                                    {
                                        value: 'lessThan',
                                        label: 'Less Than',
                                        show:
                                            bodyfield &&
                                            (bodyfield.responseType ===
                                                'responseTime' ||
                                                bodyfield.responseType ===
                                                'statusCode' ||
                                                bodyfield.responseType ===
                                                'incomingTime' ||
                                                type === 'server-monitor'),
                                    },
                                    {
                                        value: 'inBetween',
                                        label: 'In Between',
                                        show:
                                            bodyfield &&
                                            (bodyfield.responseType ===
                                                'responseTime' ||
                                                bodyfield.responseType ===
                                                'statusCode' ||
                                                bodyfield.responseType ===
                                                'incomingTime' ||
                                                type === 'server-monitor'),
                                    },
                                    {
                                        value: 'isUp',
                                        label: 'True',
                                        show:
                                            bodyfield &&
                                            (bodyfield.responseType ===
                                                'respondsToPing' ||
                                                type === 'ip'),
                                    },
                                    {
                                        value: 'isDown',
                                        label: 'False',
                                        show:
                                            bodyfield &&
                                            (bodyfield.responseType ===
                                                'respondsToPing' ||
                                                type === 'ip'),
                                    },
                                    {
                                        value: 'equalTo',
                                        label: 'Equal To',
                                        show:
                                            bodyfield &&
                                            (bodyfield.responseType ===
                                                'responseTime' ||
                                                bodyfield.responseType ===
                                                'statusCode' ||
                                                bodyfield.responseType ===
                                                'incomingTime' ||
                                                type === 'server-monitor' ||
                                                type === 'kubernetes'),
                                    },
                                    {
                                        value: 'notEqualTo',
                                        label: 'Not Equal To',
                                        show:
                                            bodyfield &&
                                            (bodyfield.responseType ===
                                                'responseTime' ||
                                                bodyfield.responseType ===
                                                'statusCode' ||
                                                bodyfield.responseType ===
                                                'incomingTime' ||
                                                type === 'server-monitor' ||
                                                type === 'kubernetes'),
                                    },
                                    {
                                        value: 'gtEqualTo',
                                        label: 'Greater Than Equal To',
                                        show:
                                            bodyfield &&
                                            (bodyfield.responseType ===
                                                'responseTime' ||
                                                bodyfield.responseType ===
                                                'statusCode' ||
                                                bodyfield.responseType ===
                                                'incomingTime' ||
                                                type === 'server-monitor'),
                                    },
                                    {
                                        value: 'ltEqualTo',
                                        label: 'Less Than Equal To',
                                        show:
                                            bodyfield &&
                                            (bodyfield.responseType ===
                                                'responseTime' ||
                                                bodyfield.responseType ===
                                                'statusCode' ||
                                                bodyfield.responseType ===
                                                'incomingTime' ||
                                                type === 'server-monitor'),
                                    },
                                    {
                                        value: 'contains',
                                        label: 'Contains',
                                        show:
                                            bodyfield &&
                                            (bodyfield.responseType ===
                                                'responseBody' ||
                                                bodyfield.responseType ===
                                                'queryString' ||
                                                bodyfield.responseType ===
                                                'headers'),
                                    },
                                    {
                                        value: 'doesNotContain',
                                        label: 'Does not Contain',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType ===
                                            'responseBody',
                                    },
                                    {
                                        value: 'evaluateResponse',
                                        label: 'Evaluate Response',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType ===
                                            'responseBody' &&
                                            type === 'api',
                                    },
                                    {
                                        value: 'empty',
                                        label: 'Is empty',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType ===
                                            'responseBody',
                                    },
                                    {
                                        value: 'notEmpty',
                                        label: 'Is not empty',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType ===
                                            'responseBody',
                                    },
                                    {
                                        value: 'throwsError',
                                        label: 'Throws error',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType ===
                                            'scriptExecution',
                                    },
                                    {
                                        value: 'doesNotThrowError',
                                        label: 'Does not throw error',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType ===
                                            'scriptExecution',
                                    },
                                    {
                                        value: 'emptyCallback',
                                        label: 'Callback without arguments',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType ===
                                            'scriptExecution',
                                    },
                                    {
                                        value: 'nonEmptyCallback',
                                        label: 'Callback with arguments',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType ===
                                            'scriptExecution',
                                    },
                                    {
                                        value: 'executesIn',
                                        label: 'Script executed within',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType ===
                                            'executionTime',
                                    },
                                    {
                                        value: 'doesNotExecuteIn',
                                        label: 'Script executed longer than',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType ===
                                            'executionTime',
                                    },
                                    {
                                        value: 'isValid',
                                        label: 'Is Valid',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType === 'ssl',
                                    },
                                    {
                                        value: 'notFound',
                                        label: 'Not Found',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType === 'ssl',
                                    },
                                    {
                                        value: 'selfSigned',
                                        label: 'Self Signed',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType === 'ssl',
                                    },
                                    {
                                        value: 'expiresIn30',
                                        label: 'Expires in 30 days',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType === 'ssl',
                                    },
                                    {
                                        value: 'expiresIn10',
                                        label: 'Expires in 10 days',
                                        show:
                                            bodyfield &&
                                            bodyfield.responseType === 'ssl',
                                    },
                                ]}
                            />
                        </div>
                    </div>
                )}

                {bodyfield &&
                    filterval !== '' &&
                    bodyfield.responseType === 'scriptExecution' ? (
                    ''
                ) : (
                    <>
                        <div
                            className="bs-Fieldset-row"
                            style={
                                filterval !== '' &&
                                    firstField.indexOf(filterval) > -1
                                    ? flexStyle
                                    : flexStylehidden
                            }
                        >
                            <label
                                className="bs-Fieldset-label"
                                style={{ padding: '6px' }}
                            >

                                {filterval && mapValue[filterval]

                                    ? mapValue[filterval]
                                    : ''}
                            </label>
                            <div className="bs-Fieldset-fields Flex-direction--row">
                                {type === 'kubernetes' ? (
                                    <Field
                                        className="db-select-nw db-select-nw-180"
                                        component={RenderSelect}
                                        name={`${fieldnameprop}.field1`}
                                        id="value"
                                        validate={ValidateField.select}
                                        style={{
                                            width: `${level > 1
                                                ? 180 - level * 10
                                                : 180
                                                }px`,
                                        }}
                                        options={[
                                            {
                                                value: '',
                                                label: 'Select a value',
                                            },
                                            {
                                                value: 'readyDeployment',
                                                label: 'Ready Deployments',
                                                show:
                                                    bodyfield.responseType ===
                                                    'desiredDeployment',
                                            },
                                            {
                                                value: 'readyStatefulsets',
                                                label: 'Ready Statefulsets',
                                                show:
                                                    bodyfield.responseType ===
                                                    'desiredStatefulsets',
                                            },
                                            {
                                                value: 'pending',
                                                label: 'Pending',
                                                show:
                                                    bodyfield.responseType ===
                                                    'podStatus',
                                            },
                                            {
                                                value: 'running',
                                                label: 'Running',
                                                show:
                                                    bodyfield.responseType ===
                                                    'podStatus' ||
                                                    bodyfield.responseType ===
                                                    'jobStatus',
                                            },
                                            {
                                                value: 'succeeded',
                                                label: 'Succeeded',
                                                show:
                                                    bodyfield.responseType ===
                                                    'jobStatus' ||
                                                    bodyfield.responseType ===
                                                    'podStatus',
                                            },
                                            {
                                                value: 'failed',
                                                label: 'Failed',
                                                show:
                                                    bodyfield.responseType ===
                                                    'jobStatus' ||
                                                    bodyfield.responseType ===
                                                    'podStatus',
                                            },
                                            {
                                                value: 'unknown',
                                                label: 'Unknown',
                                                show:
                                                    bodyfield.responseType ===
                                                    'podStatus',
                                            },
                                        ]}
                                    />
                                ) : (
                                    <Field
                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                        id="value"
                                        type="text"
                                        name={`${fieldnameprop}.field1`}
                                        component={RenderField}
                                        validate={
                                            filterval !== '' &&
                                                firstField.indexOf(filterval) > -1
                                                ? filterval ===
                                                    'jsExpression' ||
                                                    filterval ===
                                                    'evaluateResponse' ||
                                                    filterval === 'contains' ||
                                                    filterval === 'doesNotContain'
                                                    ? ValidateField.required
                                                    : bodyfield.responseType ===
                                                        'podStatus' ||
                                                        bodyfield.responseType ===
                                                        'jobStatus'
                                                        ? ValidateField.required
                                                        : [
                                                            ValidateField.required,
                                                            ValidateField.maxValue20000,
                                                        ]
                                                : undefined
                                        }
                                        placeholder={
                                            bodyfield &&
                                                filterval &&
                                                bodyfield.responseType &&
                                                placeholderfilter.indexOf(
                                                    filterval
                                                ) <= -1 &&

                                                placeholders[filterval][
                                                bodyfield.responseType
                                                ]

                                                ? placeholders[filterval][
                                                bodyfield.responseType
                                                ]
                                                : ''
                                        }
                                        style={{ width: '220px' }}
                                    />
                                )}

                                <ShouldRender
                                    if={
                                        type === 'incomingHttpRequest' &&
                                        bodyfield.filter === 'jsExpression'
                                    }
                                >

                                    <Tooltip title="Incoming HTTP Request JS Expression">
                                        <p>
                                            JavaScript expressions that
                                            evaluates to a boolean value is
                                            needed here. <code>request</code>{' '}
                                            object is also available to be used
                                            in the JS expression.
                                        </p>
                                        <p>Example JavaScript Expression:</p>
                                        <p>
                                            <ul>
                                                <li>
                                                    <code>
                                                        request.body.id === 1
                                                    </code>
                                                </li>
                                            </ul>
                                            If you attach <code>id</code> with a
                                            value of <code>1</code> when sending
                                            your request, the JS expression
                                            should evaluate to true, else it
                                            will evaluate to false
                                        </p>
                                    </Tooltip>
                                </ShouldRender>

                                <ShouldRender
                                    if={
                                        type === 'api' &&
                                        bodyfield.responseType ===
                                        'responseBody'
                                    }
                                >

                                    <Tooltip title="Evaluate Response">
                                        <p>
                                            API Monitor exposes the{' '}
                                            <code>response</code> object of this
                                            API request.
                                        </p>
                                        <p>
                                            Example properties include (but not
                                            limited to) the following:
                                        </p>
                                        <p>
                                            <ul>
                                                <li>
                                                    <code>
                                                        response.headers
                                                    </code>
                                                </li>
                                                <li>
                                                    <code>response.body</code>
                                                </li>
                                            </ul>
                                        </p>
                                        <p>Usage examples include:</p>
                                        <p>
                                            <ul>
                                                <li>
                                                    <code>
                                                        1 |{' '}
                                                        <span
                                                            style={{
                                                                color: 'blue',
                                                            }}
                                                        >
                                                            typeof
                                                        </span>{' '}
                                                        response.body ==={' '}
                                                        <span
                                                            style={{
                                                                color: 'green',
                                                            }}
                                                        >
                                                            &apos;object&apos;
                                                        </span>
                                                    </code>
                                                </li>
                                                <li>
                                                    <code>
                                                        2 |{' '}
                                                        response.body.message
                                                        ==={' '}
                                                        <span
                                                            style={{
                                                                color: 'green',
                                                            }}
                                                        >
                                                            &apos;User
                                                            created&apos;
                                                        </span>
                                                    </code>
                                                </li>
                                                <li>
                                                    <code>
                                                        3 | response.headers[
                                                        <span
                                                            style={{
                                                                color: 'green',
                                                            }}
                                                        >
                                                            &apos;Content-Type&apos;
                                                        </span>
                                                        ] ==={' '}
                                                        <span
                                                            style={{
                                                                color: 'green',
                                                            }}
                                                        >
                                                            &apos;application/json&apos;
                                                        </span>
                                                    </code>
                                                </li>
                                                <li>
                                                    <code>4 |</code>
                                                </li>
                                                <li>
                                                    <code>
                                                        5 |{' '}
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            &#47;&#47; check if
                                                            item is in array of
                                                            data
                                                        </span>
                                                    </code>
                                                </li>
                                                <li>
                                                    <code>
                                                        6 |{' '}
                                                        response.body.data.includes(
                                                        <span
                                                            style={{
                                                                color: 'green',
                                                            }}
                                                        >
                                                            &apos;Banana&apos;
                                                        </span>
                                                        )
                                                    </code>
                                                </li>
                                            </ul>
                                        </p>
                                    </Tooltip>
                                </ShouldRender>
                            </div>
                        </div>

                        {bodyfield &&
                            filterval !== '' &&
                            bodyfield.responseType === 'responseTime' ? (
                            <span
                                style={{
                                    display: 'inline-block',
                                    marginTop: '37px',
                                }}
                            >
                                ms
                            </span>
                        ) : (
                            ''
                        )}
                        {bodyfield &&
                            filterval !== '' &&
                            bodyfield.responseType === 'incomingTime' ? (
                            <span
                                style={{
                                    display: 'inline-block',
                                    marginTop: '37px',
                                }}
                            >
                                min
                            </span>
                        ) : (
                            ''
                        )}
                        {bodyfield &&
                            filterval !== '' &&
                            bodyfield.responseType === 'cpuLoad' ? (
                            <span
                                style={{
                                    display: 'inline-block',
                                    marginTop: '37px',
                                }}
                            >
                                %
                            </span>
                        ) : (
                            ''
                        )}
                        {bodyfield &&
                            filterval !== '' &&
                            (bodyfield.responseType === 'memoryUsage' ||
                                bodyfield.responseType === 'storageUsage') ? (
                            <span
                                style={{
                                    display: 'inline-block',
                                    marginTop: '37px',
                                }}
                            >
                                gb
                            </span>
                        ) : (
                            ''
                        )}
                        {bodyfield &&
                            filterval !== '' &&
                            bodyfield.responseType === 'temperature' ? (
                            <span
                                style={{
                                    display: 'inline-block',
                                    marginTop: '37px',
                                }}
                            >
                                &deg;c
                            </span>
                        ) : (
                            ''
                        )}
                    </>
                )}

                <div
                    className="bs-Fieldset-row"
                    style={
                        filterval !== '' && filterval === 'inBetween'
                            ? flexStyle
                            : flexStylehidden
                    }
                >
                    <label
                        className="bs-Fieldset-label"
                        style={{ padding: '6px' }}
                    >
                        End Value
                    </label>
                    <div className="bs-Fieldset-fields">
                        <Field
                            className="db-BusinessSettings-input TextInput bs-TextInput"
                            type="text"
                            name={`${fieldnameprop}.field2`}
                            component={RenderField}
                            validate={
                                filterval !== '' && filterval === 'inBetween'
                                    ? [
                                        ValidateField.required,
                                        ValidateField.maxValue20000,
                                    ]
                                    : undefined
                            }
                            placeholder={
                                bodyfield &&
                                    filterval &&
                                    bodyfield.responseType &&
                                    placeholderfilter.indexOf(filterval) <= -1 &&

                                    placeholders[filterval][bodyfield.responseType]

                                    ? placeholders['lessThan'][
                                    bodyfield.responseType
                                    ]
                                    : ''
                            }
                            style={{ width: '220px' }}
                        />
                    </div>
                </div>

                {bodyfield &&
                    filterval !== '' &&
                    bodyfield.responseType === 'responseTime' &&
                    filterval === 'inBetween' ? (
                    <span
                        style={{
                            display: 'inline-block',
                            marginTop: '37px',
                        }}
                    >
                        ms
                    </span>
                ) : (
                    ''
                )}

                {bodyfield &&
                    filterval !== '' &&
                    bodyfield.responseType === 'executionTime' ? (
                    <span
                        style={{
                            display: 'inline-block',
                            marginTop: '37px',
                        }}
                    >
                        ms
                    </span>
                ) : null}

                {bodyfield &&
                    filterval !== '' &&
                    bodyfield.responseType === 'incomingTime' &&
                    filterval === 'inBetween' ? (
                    <span
                        style={{
                            display: 'inline-block',
                            marginTop: '37px',
                        }}
                    >
                        min
                    </span>
                ) : (
                    ''
                )}
                {bodyfield &&
                    filterval !== '' &&
                    bodyfield.responseType === 'cpuLoad' &&
                    filterval === 'inBetween' ? (
                    <span
                        style={{
                            display: 'inline-block',
                            marginTop: '37px',
                        }}
                    >
                        %
                    </span>
                ) : (
                    ''
                )}
                {bodyfield &&
                    filterval !== '' &&
                    (bodyfield.responseType === 'memoryUsage' ||
                        bodyfield.responseType === 'storageUsage') &&
                    filterval === 'inBetween' ? (
                    <span
                        style={{
                            display: 'inline-block',
                            marginTop: '37px',
                        }}
                    >
                        gb
                    </span>
                ) : (
                    ''
                )}
                {bodyfield &&
                    filterval !== '' &&
                    bodyfield.responseType === 'temperature' &&
                    filterval === 'inBetween' ? (
                    <span
                        style={{
                            display: 'inline-block',
                            marginTop: '37px',
                        }}
                    >
                        &deg;c
                    </span>
                ) : (
                    ''
                )}
                <div style={{ marginLeft: 'auto', paddingRight: 16 }}>
                    <div
                        className="bs-Fieldset-row"
                        style={{ display: 'inline-block', padding: '4px' }}
                    >
                        <label
                            className="bs-Fieldset-label"
                            style={{ padding: '6px' }}
                        ></label>
                        <div className="bs-Fieldset-fields">
                            <div className="Box-root Flex-flex Flex-alignItems--center">
                                <button
                                    className="bs-Button bs-DeprecatedButton"
                                    type="button"
                                    onClick={() => addField()}
                                    style={{
                                        borderRadius: '50%',
                                        padding: '0px 6px',
                                    }}
                                    data-testId={`add_criterion_${criterionType}`}
                                >
                                    <img
                                        src="/dashboard/assets/img/plus.svg"
                                        style={{
                                            height: '10px',
                                            width: '10px',
                                        }}
                                        alt=""
                                    />
                                </button>
                            </div>
                        </div>
                    </div>
                    <div
                        className="bs-Fieldset-row"
                        style={{ display: 'inline-block', padding: '4px' }}
                    >
                        <label
                            className="bs-Fieldset-label"
                            style={{ padding: '6px' }}
                        ></label>
                        <div className="bs-Fieldset-fields">
                            <div className="Box-root Flex-flex Flex-alignItems--center">
                                <button
                                    className="bs-Button bs-DeprecatedButton"
                                    type="button"
                                    onClick={() =>
                                        removeField(
                                            removeArrayField,

                                            this.props.updateCriteriaField
                                        )
                                    }
                                    style={{
                                        borderRadius: '50%',
                                        padding: '0px 6px',
                                    }}
                                >
                                    <img
                                        src="/dashboard/assets/img/minus.svg"
                                        style={{
                                            height: '10px',
                                            width: '10px',
                                        }}
                                        alt=""
                                    />
                                </button>
                            </div>
                        </div>
                    </div>
                    <div
                        className="bs-Fieldset-row"
                        style={{ display: 'inline-block', padding: '4px' }}
                    >
                        <label
                            className="bs-Fieldset-label"
                            style={{ padding: '6px' }}
                        ></label>
                        <div className="bs-Fieldset-fields">
                            <div className="Box-root Flex-flex Flex-alignItems--center">
                                <button
                                    className="bs-Button bs-DeprecatedButton"
                                    type="button"
                                    onClick={() => {
                                        addArrayField(fieldnameprop, [

                                            ...(this.props.formCriteria || []),
                                            {
                                                match: '',
                                                responseType: '',
                                                filter: '',
                                                field1: '',
                                                field2: '',
                                                field3: false,
                                            },
                                        ]);
                                    }}
                                    style={{
                                        borderRadius: '50%',
                                        padding: '0px 6px',
                                    }}
                                >
                                    <img
                                        src="/dashboard/assets/img/more.svg"
                                        style={{
                                            height: '10px',
                                            width: '10px',
                                        }}
                                        alt=""
                                    />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <Field
                    className="db-BusinessSettings-input TextInput bs-TextInput"
                    type="text"
                    name={`${fieldnameprop}.field3`}
                    component="input"
                    placeholder=""
                    style={{ display: 'none' }}
                />
            </li>
        );
    }
}


RenderOption.displayName = 'RenderOption';


RenderOption.propTypes = {
    bodyfield: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
    addArrayField: PropTypes.func,
    removeArrayField: PropTypes.func,
    addField: PropTypes.func,
    removeField: PropTypes.func,
    updateCriteriaField: PropTypes.func,
    level: PropTypes.number,
    fieldnameprop: PropTypes.string,
    type: PropTypes.string,
    change: PropTypes.func.isRequired,
    criterionType: PropTypes.string,
    formCriteria: PropTypes.array,
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    { addArrayField, removeArrayField, change, updateCriteriaField },
    dispatch
);

function mapStateToProps(state: RootState, ownProps: $TSFixMe) {
    const selector = formValueSelector('NewMonitor');
    const formCriteria = selector(state, `${ownProps.fieldnameprop}.criteria`);
    return {
        // bodyfield: newSelector(state, `${ownProps.fieldname}`),
        formCriteria,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(RenderOption);
