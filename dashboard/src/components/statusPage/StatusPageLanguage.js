import React, { useState, useEffect } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Field, reduxForm } from 'redux-form';
import {
    updateStatusPageLanguage,
    fetchProjectStatusPage,
} from '../../actions/statusPage';
import { RenderSelect } from '../basic/RenderSelect';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { openModal } from '../../actions/modal';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

export function StatusPageLanguage(props) {
    const [language, setLang] = useState([
        'English',
        'German',
        'French',
        'Dutch',
    ]);
    const [langResult, setLangResult] = useState([]);
    const [lang, setLangText] = useState('');

    const { multipleLanguages, formValues } = props;
    useEffect(() => {
        const languages = multipleLanguages || [];
        const filteredResult = [...language].filter(
            lang => !languages.includes(lang)
        );
        setLangResult(languages);
        setLang(filteredResult);
    }, []);

    const submitForm = values => {
        const { status } = props.statusPage;
        const { projectId } = status;
        const { formValues } = props;
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
                multipleLanguages: langResult,
            })
            .then(() => {
                props.fetchProjectStatusPage(projectId._id || projectId, true);
            });
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > STATUS PAGES > STATUS PAGE > PRIVATE STATUS PAGE UPDATED'
            );
        }
    };
    const handleLanguageChange = () => {
        const newArr = [...langResult];
        if (!newArr.includes(lang)) {
            newArr.push(lang);
        }
        const filteredLangs = language.filter(l => l !== lang);
        setLangResult(newArr);
        setLang(filteredLangs);
    };
    const handleRemoveTeamMember = lang => {
        const newArr = [...language, lang];
        const filteredLangs = langResult.filter(l => l !== lang);
        setLangResult(filteredLangs);
        setLang(newArr);
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
                                        formValues.multiLanguage &&
                                        langResult.length > 0 ? (
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
                                                        <div
                                                            className="bs-Fieldset-row Margin-bottom--12 Flex-flex Flex-alignItems--stretch Flex-direction--column"
                                                            style={{
                                                                marginBottom:
                                                                    '0',
                                                                padding:
                                                                    '25px 20px 38px 20px',
                                                                paddingTop: 0,
                                                                paddingBottom: 0,
                                                            }}
                                                        >
                                                            <label
                                                                className=".bs-Fieldset-label"
                                                                style={{
                                                                    fontWeight:
                                                                        '500',
                                                                    marginBottom: 10,
                                                                }}
                                                            >
                                                                Languages
                                                            </label>
                                                            {langResult.map(
                                                                lang => (
                                                                    <div
                                                                        key={
                                                                            lang
                                                                        }
                                                                        style={{
                                                                            display:
                                                                                'flex',
                                                                            alignItems:
                                                                                'flex-end',
                                                                            justifyContent:
                                                                                'space-between',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            <span>
                                                                                {
                                                                                    lang
                                                                                }
                                                                            </span>
                                                                        </span>
                                                                        <div
                                                                            className="clear_times"
                                                                            style={{
                                                                                marginRight:
                                                                                    '0',
                                                                                cursor:
                                                                                    'pointer',
                                                                            }}
                                                                            onClick={() =>
                                                                                handleRemoveTeamMember(
                                                                                    lang
                                                                                )
                                                                            }
                                                                        ></div>
                                                                    </div>
                                                                )
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}

                                        {formValues &&
                                        formValues.multiLanguage ? (
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
                                                        <div
                                                            className="bs-Fieldset-row Margin-bottom--12"
                                                            style={{
                                                                marginBottom:
                                                                    '0',
                                                                padding:
                                                                    '25px 20px 38px 20px',
                                                                paddingTop: 0,
                                                            }}
                                                        >
                                                            <Field
                                                                id="componentList"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                className="db-select-nw"
                                                                placeholder="Add Language"
                                                                options={[
                                                                    ...language.map(
                                                                        lang => ({
                                                                            value: lang,
                                                                            label: lang,
                                                                        })
                                                                    ),
                                                                ]}
                                                                onChange={(
                                                                    event,
                                                                    value
                                                                ) => {
                                                                    setLangText(
                                                                        value
                                                                    );
                                                                }}
                                                            />
                                                            <button
                                                                title="add-team-member"
                                                                id={`group_member-add`}
                                                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                                type="button"
                                                                onClick={
                                                                    handleLanguageChange
                                                                }
                                                            >
                                                                <span>Add</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}
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

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            updateStatusPageLanguage,
            fetchProjectStatusPage,
            openModal,
        },
        dispatch
    );

const mapStateToProps = state => {
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
