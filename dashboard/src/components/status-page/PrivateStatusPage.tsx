import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { Field, FieldArray, reduxForm } from 'redux-form';
import {
    updatePrivateStatusPage,
    updatePrivateStatusPageRequest,
    updatePrivateStatusPageSuccess,
    updatePrivateStatusPageError,
    fetchProjectStatusPage,
} from '../../actions/statusPage';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';

import { v4 as uuidv4 } from 'uuid';
import { openModal } from 'common-ui/actions/modal';
import DataPathHoC from '../DataPathHoC';
import SubscriberAdvanceOptions from '../modals/SubscriberAdvanceOptions';

import PricingPlan from '../basic/PricingPlan';
import { RenderField } from '../basic/RenderField';
export class PrivateStatusPage extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
        this.state = {
            subscriberAdvanceOptionModalId: uuidv4(),
            showMoreOptions: false,
        };
    }

    submitForm = (values: $TSFixMe) => {

        const { status } = this.props.statusPage;
        const { projectId } = status;

        if (values.ipWhitelist && values.ipWhitelist.length > 0) {
            const ipWhitelist = values.ipWhitelist.filter(
                (ip: $TSFixMe) => typeof ip === 'string'
            );
            values.ipWhitelist = ipWhitelist;
        }

        this.props

            .updatePrivateStatusPage(projectId._id || projectId, {
                _id: status._id,
                isPrivate: values.isPrivate,
                isSubscriberEnabled: values.isSubscriberEnabled,
                isGroupedByMonitorCategory: values.isGroupedByMonitorCategory,
                showScheduledEvents: values.showScheduledEvents,
                ipWhitelist: values.ipWhitelist,
                enableIpWhitelist: values.enableIpWhitelist,
                hideProbeBar: values.hideProbeBar,
                hideUptime: values.hideUptime,
                hideResolvedIncident: values.hideResolvedIncident,
                scheduleHistoryDays: values.scheduleHistoryDays,
                incidentHistoryDays: values.incidentHistoryDays,
                announcementLogsHistory: values.announcementLogsHistory,
                offlineText: values.offlineText,
                onlineText: values.onlineText,
                degradedText: values.degradedText,
                twitterHandle: values.twitterHandle,
            })
            .then(() => {

                this.props.fetchProjectStatusPage(
                    projectId._id || projectId,
                    true
                );
            });
    };

    showMoreOptionsToggle = () => {
        this.setState(prevState => ({

            showMoreOptions: !prevState.showMoreOptions,
        }));
    };

    renderIpWhitelist = ({
        fields
    }: $TSFixMe) => {

        const { formValues } = this.props;
        return <>
            {formValues && formValues.showIpWhitelistInput && (
                <div
                    style={{
                        width: '100%',
                    }}
                >
                    <button
                        id="addIpList"
                        className="Button bs-ButtonLegacy ActionIconParent"
                        type="button"
                        onClick={() => {
                            fields.push();
                        }}
                    >
                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                            <span>Add IP</span>
                        </span>
                    </button>
                    {fields.map((field: $TSFixMe, index: $TSFixMe) => {
                        return (
                            <div
                                style={{
                                    width: '65%',
                                    marginBottom: 10,
                                    marginTop: 10,
                                }}
                                key={index}
                            >
                                <Field
                                    component={RenderField}
                                    name={field}
                                    id={`ipWhitelist_${index}`}
                                    placeholder="118.127.63.27"
                                    className="bs-TextInput"
                                    style={{
                                        width: '100%',
                                        padding: '3px 5px',
                                    }}
                                />
                                <button
                                    id="removeIp"
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    style={{
                                        marginTop: 10,
                                    }}
                                    type="button"
                                    onClick={() => {
                                        fields.remove(index);
                                    }}
                                >
                                    <span className="bs-Button bs-Button--icon bs-Button--delete">
                                        <span>Remove IP</span>
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </>;
    };

    render() {

        const { handleSubmit, formValues } = this.props;

        const { subscriberAdvanceOptionModalId, showMoreOptions } = this.state;
        const historyLimit = (value: $TSFixMe) => {
            if (value < 1) {
                return 1;
            } else if (value > 30) {
                return 30;
            } else {
                return value;
            }
        };
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Advanced Options</span>
                            </span>
                            <p>
                                <span>
                                    Here are more options for your status page
                                </span>
                            </p>
                        </div>
                        <div
                            className="bs-Fieldset-row"
                            style={{
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                            }}
                        >
                            <label style={{ marginRight: 10 }}>
                                Show more advanced options
                            </label>
                            <div>
                                <label className="Toggler-wrap">
                                    <input
                                        className="btn-toggler"
                                        type="checkbox"
                                        onChange={() =>
                                            this.showMoreOptionsToggle()
                                        }
                                        name="moreAdvancedOptions"
                                        id="moreAdvancedOptions"
                                        checked={showMoreOptions}
                                    />
                                    <span className="TogglerBtn-slider round"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit(this.submitForm)}>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset
                                        data-test="RetrySettings-failedAndExpiring"
                                        className="bs-Fieldset"
                                    >
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{ flex: '25% 0 0' }}
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
                                                                name={
                                                                    'isGroupedByMonitorCategory'
                                                                }
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                                id="statuspage.isGroupedByMonitorCategory"
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    paddingLeft:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <span>
                                                                    Group
                                                                    Monitor by
                                                                    Categories
                                                                </span>
                                                                <label className="bs-Fieldset-explanation">
                                                                    <span>
                                                                        Group
                                                                        monitor
                                                                        on
                                                                        public
                                                                        status
                                                                        page by
                                                                        categories.
                                                                    </span>
                                                                </label>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{ flex: '25% 0 0' }}
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
                                                    <PricingPlan
                                                        plan="Growth"
                                                        hideChildren={false}
                                                    >
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                            <label className="Checkbox">
                                                                <Field
                                                                    component="input"
                                                                    type="checkbox"
                                                                    name={
                                                                        'isPrivate'
                                                                    }
                                                                    data-test="RetrySettings-failedPaymentsCheckbox"
                                                                    className="Checkbox-source"
                                                                    id="statuspage.isPrivate"
                                                                />
                                                                <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                    <div className="Checkbox-target Box-root">
                                                                        <div className="Checkbox-color Box-root"></div>
                                                                    </div>
                                                                </div>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Private
                                                                        Status
                                                                        Page
                                                                    </span>
                                                                    <label className="bs-Fieldset-explanation">
                                                                        <span>
                                                                            Making
                                                                            the
                                                                            status
                                                                            page
                                                                            private
                                                                            will
                                                                            only
                                                                            make
                                                                            it
                                                                            visible
                                                                            to
                                                                            your
                                                                            internal
                                                                            team.
                                                                        </span>
                                                                    </label>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </PricingPlan>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{ flex: '25% 0 0' }}
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
                                                                name={
                                                                    'showScheduledEvents'
                                                                }
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                                id="statuspage.showScheduledEvents"
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    paddingLeft:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <span>
                                                                    Show
                                                                    Scheduled
                                                                    events
                                                                </span>
                                                                <label className="bs-Fieldset-explanation">
                                                                    <span>
                                                                        {' '}
                                                                        Enable
                                                                        this to
                                                                        allow
                                                                        your
                                                                        users to
                                                                        see
                                                                        scheduled
                                                                        events
                                                                        like
                                                                        Database
                                                                        migration,
                                                                        Scheduled
                                                                        downtime,
                                                                        etc.
                                                                    </span>
                                                                </label>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{ flex: '25% 0 0' }}
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
                                                    <PricingPlan
                                                        plan="Growth"
                                                        hideChildren={false}
                                                    >
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                            <label className="Checkbox">
                                                                <Field
                                                                    component="input"
                                                                    type="checkbox"
                                                                    name={
                                                                        'isSubscriberEnabled'
                                                                    }
                                                                    data-test="RetrySettings-failedPaymentsCheckbox"
                                                                    className="Checkbox-source"
                                                                    id="statuspage.isSubscriberEnabled"
                                                                />
                                                                <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                    <div className="Checkbox-target Box-root">
                                                                        <div className="Checkbox-color Box-root"></div>
                                                                    </div>
                                                                </div>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span id="enable-subscribers">
                                                                        Enable
                                                                        Subscribers
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </PricingPlan>
                                                    <p
                                                        className="bs-Fieldset-explanation"
                                                        style={{
                                                            paddingLeft: '21px',
                                                        }}
                                                    >
                                                        <span>
                                                            Enabling this will
                                                            allow your users to
                                                            subscribe and get
                                                            notifications for
                                                            your incidents.{' '}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            className="button-as-anchor"
                                                            style={{
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                            onClick={() => {

                                                                this.props.openModal(
                                                                    {
                                                                        id: subscriberAdvanceOptionModalId,
                                                                        content: DataPathHoC(
                                                                            SubscriberAdvanceOptions,
                                                                            {}
                                                                        ),
                                                                    }
                                                                );
                                                            }}
                                                        >
                                                            Advanced options for
                                                            subscribers
                                                        </button>
                                                    </p>
                                                </div>
                                            </div>

                                            {showMoreOptions && (
                                                <>
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{
                                                            paddingBottom: 0,
                                                        }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '25% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        marginLeft:
                                                                            '20px',
                                                                        fontWeight: 500,
                                                                    }}
                                                                >
                                                                    <span>
                                                                        More
                                                                        Advanced
                                                                        Options
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '25% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <Field
                                                                        component="input"
                                                                        type="checkbox"
                                                                        name={
                                                                            'hideProbeBar'
                                                                        }
                                                                        data-test="RetrySettings-failedPaymentsCheckbox"
                                                                        className="Checkbox-source"
                                                                        id="statuspage.hideProbeBar"
                                                                    />
                                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                        <div className="Checkbox-target Box-root">
                                                                            <div className="Checkbox-color Box-root"></div>
                                                                        </div>
                                                                    </div>
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Hide
                                                                            Probe
                                                                            Bar
                                                                        </span>
                                                                        <label className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                Hide
                                                                                the
                                                                                probe
                                                                                bar
                                                                                on
                                                                                the
                                                                                status
                                                                                page
                                                                            </span>
                                                                        </label>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '25% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <Field
                                                                        component="input"
                                                                        type="checkbox"
                                                                        name={
                                                                            'hideUptime'
                                                                        }
                                                                        data-test="RetrySettings-failedPaymentsCheckbox"
                                                                        className="Checkbox-source"
                                                                        id="statuspage.hideUptime"
                                                                    />
                                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                        <div className="Checkbox-target Box-root">
                                                                            <div className="Checkbox-color Box-root"></div>
                                                                        </div>
                                                                    </div>
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Hide
                                                                            Uptime
                                                                        </span>
                                                                        <label className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                Hide
                                                                                Uptime
                                                                                from
                                                                                status
                                                                                page
                                                                            </span>
                                                                        </label>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '25% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div
                                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                }}
                                                            >
                                                                <div className="Flex-flex">
                                                                    <label
                                                                        style={{
                                                                            height: 15,
                                                                            display:
                                                                                'inline-block',
                                                                        }}
                                                                        className="Checkbox"
                                                                    >
                                                                        <Field
                                                                            component="input"
                                                                            type="checkbox"
                                                                            name="enableIpWhitelist"
                                                                            data-test="RetrySettings-failedPaymentsCheckbox"
                                                                            className="Checkbox-source"
                                                                            id="enableIpWhitelist"
                                                                        />
                                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                            <div className="Checkbox-target Box-root">
                                                                                <div className="Checkbox-color Box-root"></div>
                                                                            </div>
                                                                        </div>
                                                                    </label>
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                            position:
                                                                                'relative',
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <label
                                                                            className="Checkbox"
                                                                            htmlFor="enableIpWhitelist"
                                                                        >
                                                                            Enable
                                                                            IP
                                                                            Whitelist
                                                                        </label>
                                                                        <div>
                                                                            <label
                                                                                className="bs-Fieldset-explanation"
                                                                                style={{
                                                                                    marginBottom: 10,
                                                                                    fontSize: 14,
                                                                                }}
                                                                            >
                                                                                <span>
                                                                                    Enabling
                                                                                    this
                                                                                    will
                                                                                    restrict
                                                                                    access
                                                                                    to
                                                                                    anyone
                                                                                    accessing
                                                                                    the
                                                                                    status
                                                                                    page
                                                                                    from
                                                                                    an
                                                                                    IP
                                                                                    not
                                                                                    specified
                                                                                    in
                                                                                    the
                                                                                    whitelist
                                                                                </span>
                                                                            </label>

                                                                            {formValues.enableIpWhitelist && (
                                                                                <div
                                                                                    className="bs-Fieldset-field"
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                        marginTop: 10,
                                                                                    }}
                                                                                >
                                                                                    <FieldArray
                                                                                        name="ipWhitelist"
                                                                                        component={
                                                                                            this
                                                                                                .renderIpWhitelist
                                                                                        }
                                                                                    />
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{
                                                            paddingTop: '0',
                                                        }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '25% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <Field
                                                                        component="input"
                                                                        type="checkbox"
                                                                        name={
                                                                            'hideResolvedIncident'
                                                                        }
                                                                        data-test="RetrySettings-failedPaymentsCheckbox"
                                                                        className="Checkbox-source"
                                                                        id="statuspage.hideResolvedIncident"
                                                                    />
                                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                        <div className="Checkbox-target Box-root">
                                                                            <div className="Checkbox-color Box-root"></div>
                                                                        </div>
                                                                    </div>
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Hide
                                                                            Resolved
                                                                            Incidents
                                                                            on
                                                                            this
                                                                            Status
                                                                            Page
                                                                        </span>
                                                                        <label className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                If
                                                                                you
                                                                                enable
                                                                                this
                                                                                checkbox,
                                                                                all
                                                                                of
                                                                                your
                                                                                resolved
                                                                                incidents
                                                                                will
                                                                                not
                                                                                be
                                                                                shown
                                                                                on
                                                                                the
                                                                                status
                                                                                page.
                                                                            </span>
                                                                        </label>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{
                                                            paddingTop: '0',
                                                        }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '25% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Show
                                                                            incident
                                                                            history
                                                                            for{' '}
                                                                            <Field
                                                                                component="input"
                                                                                type="number"
                                                                                min="1"
                                                                                placeholder="days"
                                                                                className="db-BusinessSettings-input-60 TextInput bs-TextInput"
                                                                                name={
                                                                                    'incidentHistoryDays'
                                                                                }
                                                                                id="statuspage.incidentHistoryDays"
                                                                                normalize={
                                                                                    historyLimit
                                                                                }
                                                                            />{' '}
                                                                            days
                                                                        </span>
                                                                        <label className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                The
                                                                                amount
                                                                                of
                                                                                days
                                                                                entered
                                                                                in
                                                                                the
                                                                                text
                                                                                box
                                                                                will
                                                                                be
                                                                                the
                                                                                amount
                                                                                of
                                                                                incident
                                                                                history
                                                                                days
                                                                                on
                                                                                the
                                                                                status
                                                                                page
                                                                            </span>
                                                                        </label>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{
                                                            paddingTop: '0',
                                                        }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '25% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Show
                                                                            scheduled
                                                                            maintenance
                                                                            event
                                                                            history
                                                                            for{' '}
                                                                            <Field
                                                                                component="input"
                                                                                type="number"
                                                                                min="1"
                                                                                placeholder="days"
                                                                                className="db-BusinessSettings-input-60 TextInput bs-TextInput"
                                                                                name={
                                                                                    'scheduleHistoryDays'
                                                                                }
                                                                                id="statuspage.scheduleHistoryDays"
                                                                                normalize={
                                                                                    historyLimit
                                                                                }
                                                                            />{' '}
                                                                            days
                                                                        </span>
                                                                        <label className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                The
                                                                                amount
                                                                                of
                                                                                days
                                                                                entered
                                                                                in
                                                                                the
                                                                                text
                                                                                box
                                                                                will
                                                                                be
                                                                                the
                                                                                amount
                                                                                of
                                                                                scheduled
                                                                                maintenance
                                                                                event
                                                                                history
                                                                                days
                                                                                on
                                                                                the
                                                                                status
                                                                                page
                                                                            </span>
                                                                        </label>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{
                                                            paddingTop: '0',
                                                        }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '25% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Show
                                                                            announcement
                                                                            history
                                                                            for{' '}
                                                                            <Field
                                                                                component="input"
                                                                                type="number"
                                                                                min="1"
                                                                                placeholder="days"
                                                                                className="db-BusinessSettings-input-60 TextInput bs-TextInput"
                                                                                name={
                                                                                    'announcementLogsHistory'
                                                                                }
                                                                                id="statuspage.announcementLogsHistory"
                                                                                normalize={
                                                                                    historyLimit
                                                                                }
                                                                            />{' '}
                                                                            days
                                                                        </span>
                                                                        <label className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                The
                                                                                amount
                                                                                of
                                                                                days
                                                                                entered
                                                                                in
                                                                                the
                                                                                text
                                                                                box
                                                                                will
                                                                                be
                                                                                the
                                                                                amount
                                                                                of
                                                                                announcement
                                                                                log
                                                                                history
                                                                                displayed
                                                                                on
                                                                                the
                                                                                status
                                                                                page
                                                                            </span>
                                                                        </label>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{
                                                            paddingTop: '0',
                                                        }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '25% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                }}
                                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart"
                                                            >
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Status
                                                                        Text
                                                                    </span>
                                                                    <label className="bs-Fieldset-explanation">
                                                                        <span
                                                                            style={{
                                                                                display:
                                                                                    'block',
                                                                                marginBottom: 10,
                                                                            }}
                                                                        >
                                                                            Custom
                                                                            text
                                                                            to
                                                                            show
                                                                            the
                                                                            status
                                                                            of
                                                                            resources
                                                                            on
                                                                            the
                                                                            status
                                                                            page
                                                                        </span>
                                                                        <fieldset className="Margin-bottom--16">
                                                                            <div className="bs-Fieldset-rows">
                                                                                <div
                                                                                    className="bs-Fieldset-row"
                                                                                    style={{
                                                                                        padding: 0,
                                                                                    }}
                                                                                >
                                                                                    <label
                                                                                        className="bs-Fieldset-label Text-align--left"
                                                                                        htmlFor="onlineText"
                                                                                        style={{
                                                                                            flexBasis:
                                                                                                '20%',
                                                                                        }}
                                                                                    >
                                                                                        <span>
                                                                                            Online
                                                                                        </span>
                                                                                    </label>
                                                                                    <div
                                                                                        className="bs-Fieldset-fields"
                                                                                        style={{
                                                                                            flexBasis:
                                                                                                '80%',
                                                                                            maxWidth:
                                                                                                '80%',
                                                                                        }}
                                                                                    >
                                                                                        <div
                                                                                            className="bs-Fieldset-field"
                                                                                            style={{
                                                                                                width:
                                                                                                    '100%',
                                                                                            }}
                                                                                        >
                                                                                            <Field
                                                                                                className="db-BusinessSettings-input-300 TextInput bs-TextInput"
                                                                                                component={
                                                                                                    RenderField
                                                                                                }
                                                                                                type="text"
                                                                                                name="onlineText"
                                                                                                id="onlineText"
                                                                                                placeholder="Enter a custom status"
                                                                                                style={{
                                                                                                    width:
                                                                                                        '100%',
                                                                                                }}
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </fieldset>
                                                                        <fieldset className="Margin-bottom--16">
                                                                            <div className="bs-Fieldset-rows">
                                                                                <div
                                                                                    className="bs-Fieldset-row"
                                                                                    style={{
                                                                                        padding: 0,
                                                                                    }}
                                                                                >
                                                                                    <label
                                                                                        className="bs-Fieldset-label Text-align--left"
                                                                                        htmlFor="degradedText"
                                                                                        style={{
                                                                                            flexBasis:
                                                                                                '20%',
                                                                                        }}
                                                                                    >
                                                                                        <span>
                                                                                            Degraded
                                                                                        </span>
                                                                                    </label>
                                                                                    <div
                                                                                        className="bs-Fieldset-fields"
                                                                                        style={{
                                                                                            flexBasis:
                                                                                                '80%',
                                                                                            maxWidth:
                                                                                                '80%',
                                                                                        }}
                                                                                    >
                                                                                        <div
                                                                                            className="bs-Fieldset-field"
                                                                                            style={{
                                                                                                width:
                                                                                                    '100%',
                                                                                            }}
                                                                                        >
                                                                                            <Field
                                                                                                className="db-BusinessSettings-input-300 TextInput bs-TextInput"
                                                                                                component={
                                                                                                    RenderField
                                                                                                }
                                                                                                type="text"
                                                                                                name="degradedText"
                                                                                                id="degradedText"
                                                                                                placeholder="Enter a custom status"
                                                                                                style={{
                                                                                                    width:
                                                                                                        '100%',
                                                                                                }}
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </fieldset>
                                                                        <fieldset className="Margin-bottom--16">
                                                                            <div className="bs-Fieldset-rows">
                                                                                <div
                                                                                    className="bs-Fieldset-row"
                                                                                    style={{
                                                                                        padding: 0,
                                                                                    }}
                                                                                >
                                                                                    <label
                                                                                        className="bs-Fieldset-label Text-align--left"
                                                                                        htmlFor="offlineText"
                                                                                        style={{
                                                                                            flexBasis:
                                                                                                '20%',
                                                                                        }}
                                                                                    >
                                                                                        <span>
                                                                                            Offline
                                                                                        </span>
                                                                                    </label>
                                                                                    <div
                                                                                        className="bs-Fieldset-fields"
                                                                                        style={{
                                                                                            flexBasis:
                                                                                                '80%',
                                                                                            maxWidth:
                                                                                                '80%',
                                                                                        }}
                                                                                    >
                                                                                        <div
                                                                                            className="bs-Fieldset-field"
                                                                                            style={{
                                                                                                width:
                                                                                                    '100%',
                                                                                            }}
                                                                                        >
                                                                                            <Field
                                                                                                className="db-BusinessSettings-input-300 TextInput bs-TextInput"
                                                                                                component={
                                                                                                    RenderField
                                                                                                }
                                                                                                type="text"
                                                                                                name="offlineText"
                                                                                                id="offlineText"
                                                                                                placeholder="Enter a custom status"
                                                                                                style={{
                                                                                                    width:
                                                                                                        '100%',
                                                                                                }}
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </fieldset>
                                                                    </label>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{
                                                            paddingTop: '0',
                                                        }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '25% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Official
                                                                            Twitter
                                                                            Handle{' '}
                                                                            <Field
                                                                                component="input"
                                                                                type="text"
                                                                                placeholder="twitter username"
                                                                                className="db-BusinessSettings-input-200 TextInput bs-TextInput"
                                                                                name={
                                                                                    'twitterHandle'
                                                                                }
                                                                                id="statuspage.twitterHandle"
                                                                            />
                                                                        </span>
                                                                        <label className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                (
                                                                                e.g
                                                                                MuddyTech).
                                                                                This
                                                                                will
                                                                                populate
                                                                                recent
                                                                                tweets
                                                                                from
                                                                                the
                                                                                username
                                                                                entered.
                                                                            </span>
                                                                        </label>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>
                            <div className="bs-Tail-copy">
                                <div
                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                    style={{ marginTop: '10px' }}
                                >
                                    <ShouldRender
                                        if={

                                            this.props.statusPage
                                                .privateStatusPage.error
                                        }
                                    >
                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>
                                                {

                                                    this.props.statusPage
                                                        .privateStatusPage.error
                                                }
                                            </span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                <button
                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                    disabled={

                                        this.props.statusPage.privateStatusPage
                                            .requesting
                                    }
                                    type="submit"
                                    id="saveAdvancedOptions"
                                >

                                    {!this.props.statusPage.privateStatusPage
                                        .requesting && <span>Save </span>}

                                    {this.props.statusPage.privateStatusPage
                                        .requesting && <FormLoader />}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}


PrivateStatusPage.displayName = 'PrivateStatusPage';

const PrivateStatusPageForm = reduxForm({
    form: 'PrivateStatusPages', // a unique identifier for this form
    enableReinitialize: true,
})(PrivateStatusPage);


PrivateStatusPage.propTypes = {
    updatePrivateStatusPage: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    statusPage: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
    formValues: PropTypes.object,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        updatePrivateStatusPage,
        updatePrivateStatusPageRequest,
        updatePrivateStatusPageSuccess,
        updatePrivateStatusPageError,
        fetchProjectStatusPage,
        openModal,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    const initialValues = {};
    const { currentProject } = state.project;
    const {
        statusPage,
        statusPage: { status },
    } = state;

    if (status) {

        initialValues.isPrivate = status.isPrivate;

        initialValues.isSubscriberEnabled = status.isSubscriberEnabled;

        initialValues.isGroupedByMonitorCategory =
            status.isGroupedByMonitorCategory;

        initialValues.showScheduledEvents = status.showScheduledEvents;

        initialValues.enableIpWhitelist = status.enableIpWhitelist;

        initialValues.ipWhitelist = status.ipWhitelist;

        initialValues.hideProbeBar = status.hideProbeBar;

        initialValues.hideUptime = status.hideUptime;

        initialValues.hideResolvedIncident = status.hideResolvedIncident;

        initialValues.incidentHistoryDays = status.incidentHistoryDays;

        initialValues.scheduleHistoryDays = status.scheduleHistoryDays;

        initialValues.announcementLogsHistory = status.announcementLogsHistory;

        initialValues.onlineText = status.onlineText || 'Operational';

        initialValues.offlineText = status.offlineText || 'Offline';

        initialValues.degradedText = status.degradedText || 'Degraded';

        initialValues.twitterHandle = status.twitterHandle;
    }

    initialValues.showIpWhitelistInput = true;

    return {
        initialValues,
        statusPage,
        currentProject,
        formValues:
            state.form.PrivateStatusPages &&
            state.form.PrivateStatusPages.values,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(PrivateStatusPageForm);
