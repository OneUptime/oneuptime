import React, { useState } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { Field, reduxForm, FieldArray } from 'redux-form';
import {
    updateStatusPageLanguage,
    fetchProjectStatusPage,
} from '../../actions/statusPage';
import { RenderSelect } from '../basic/RenderSelect';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { openModal } from 'CommonUI/actions/modal';

interface StatusPageLanguageProps {
    updateStatusPageLanguage: Function;
    multipleLanguages?: unknown[];
    statusPage: object;
    handleSubmit: Function;
    fetchProjectStatusPage: Function;
    formValues?: object;
}

export const StatusPageLanguage = (props: StatusPageLanguageProps) => {
    const [error, setError] = useState('');
    const [language] = useState([
        'English',
        'German',
        'French',
        'Dutch',
        'Spanish',
    ]);
    const { formValues } = props;

    const submitForm = (values: $TSFixMe) => {
        const { status } = props.statusPage;
        const { projectId } = status;
        const { formValues } = props;
        const languages = formValues.multipleLanguages;
        const isDuplicate = languages
            ? languages.length === new Set(languages).size
                ? false
                : true
            : false;

        if (isDuplicate) {
            setError('Duplicate language selection found');
            return;
        }
        props
            .updateStatusPageLanguage(projectId._id || projectId, {
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
                enableMultipleLanguage: formValues.multiLanguage || false,
                multipleLanguages: formValues.multipleLanguages || [],
            })
            .then(() => {
                props.fetchProjectStatusPage(projectId._id || projectId, true);
            });
    };

    const renderLanguage = ({
        fields
    }: $TSFixMe) => {
        return (
            <div
                style={{
                    width: '80%',
                    position: 'relative',
                }}
            >
                <button
                    id="addMoreMonitor"
                    className="Button bs-ButtonLegacy ActionIconParent"
                    style={{
                        position: 'absolute',
                        zIndex: 1,
                        right: 0,
                    }}
                    type="button"
                    onClick={() => {
                        fields.push();
                    }}
                >
                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                        <span>Add Language</span>
                    </span>
                </button>
                {fields.map((field: $TSFixMe, index: $TSFixMe) => {
                    return (
                        <div
                            style={{
                                width: '62%',
                                marginBottom: 10,
                            }}
                            key={index}
                        >
                            <Field
                                className="db-select-nw Table-cell--width--maximized"
                                component={RenderSelect}
                                name={field}
                                id={`language${index}`}
                                placeholder="language"
                                style={{
                                    height: '28px',
                                    width: '50%',
                                }}
                                options={[
                                    {
                                        value: '',
                                        label: 'Select language',
                                    },
                                    ...(language && language.length > 0
                                        ? language.map(lang => ({
                                            value: lang,
                                            label: lang,
                                        }))
                                        : []),
                                ]}
                            />
                            <button
                                id="addMoreMonitor"
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
                                    <span>Remove Language</span>
                                </span>
                            </button>
                        </div>
                    );
                })}
                {error && (
                    <div
                        className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                        style={{
                            marginTop: '5px',
                            alignItems: 'center',
                        }}
                    >
                        <div
                            className="Box-root Margin-right--8"
                            style={{ marginTop: '2px' }}
                        >
                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                        </div>
                        <div className="Box-root">
                            <span id="monitorError" style={{ color: 'red' }}>
                                {error}
                            </span>
                        </div>
                    </div>
                )}
            </div>
        );
    };
    const { handleSubmit } = props;
    return (
        <div className="bs-ContentSection Card-root Card-shadow--medium">
            <div className="Box-root">
                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                            <span>Status Page Languages</span>
                        </span>
                        <p>
                            <span>
                                Enable Multiple Language feature on status page
                            </span>
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit(submitForm)}>
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
                                                                'multiLanguage'
                                                            }
                                                            data-test="RetrySettings-failedPaymentsCheckbox"
                                                            className="Checkbox-source"
                                                            id="statuspage.multiLanguage"
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
                                                                Enable Multiple
                                                                Language
                                                            </span>
                                                            <label className="bs-Fieldset-explanation">
                                                                <span>
                                                                    Enable multi
                                                                    Language
                                                                    feature to
                                                                    translate
                                                                    your status
                                                                    page to
                                                                    other
                                                                    languages
                                                                    (default is
                                                                    English)
                                                                </span>
                                                            </label>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        {formValues &&
                                            formValues.multiLanguage && (
                                                <div
                                                    className="bs-Fieldset-row Margin-bottom--12 Padding-left--0"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label"
                                                        style={{
                                                            flex: '28.5% 0 0',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                        <div
                                                            style={{
                                                                marginBottom: 5,
                                                            }}
                                                        >
                                                            <span>
                                                                Select Languages
                                                            </span>
                                                        </div>
                                                        <FieldArray
                                                            name="multipleLanguages"
                                                            component={
                                                                renderLanguage
                                                            }
                                                        />
                                                    </div>
                                                </div>
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
                                        props.statusPage.updateMultipleLanguage
                                            .error
                                    }
                                >
                                    <div className="Box-root Margin-right--8">
                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                    </div>
                                    <div className="Box-root">
                                        <span style={{ color: 'red' }}>
                                            {
                                                props.statusPage
                                                    .updateMultipleLanguage
                                                    .error
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
                                    props.statusPage.updateMultipleLanguage
                                        .requesting
                                }
                                type="submit"
                                id="saveAdvancedOptions"
                            >
                                {!props.statusPage.updateMultipleLanguage
                                    .requesting && <span>Save </span>}
                                {props.statusPage.updateMultipleLanguage
                                    .requesting && <FormLoader />}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}

StatusPageLanguage.displayName = 'StatusPageLanguage';

const StatusPageLanguageForm = reduxForm({
    form: 'multipleLanguage', // a unique identifier for this form
    enableReinitialize: true,
})(StatusPageLanguage);

StatusPageLanguage.propTypes = {
    updateStatusPageLanguage: PropTypes.func.isRequired,
    multipleLanguages: PropTypes.array,
    statusPage: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
    formValues: PropTypes.object,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        updateStatusPageLanguage,
        fetchProjectStatusPage,
        openModal,
    },
    dispatch
);

const mapStateToProps = (state: RootState) => {
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

        initialValues.multiLanguage = status.enableMultipleLanguage || false;

        initialValues.multipleLanguages = status.multipleLanguages || [];
    }

    return {
        initialValues,
        statusPage,
        currentProject,
        formValues:
            state.form.multipleLanguage && state.form.multipleLanguage.values,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(StatusPageLanguageForm);
