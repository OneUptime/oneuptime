import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { closeModal } from '../../actions/modal';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, FieldArray, reduxForm } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import {
    createAnnouncement,
    fetchAnnouncements,
} from '../../actions/statusPage';
import RenderCodeEditor from '../basic/RenderCodeEditor';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!values.name) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Announcement name is required';
    }
    if (!values.description) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'description' does not exist on type '{}'... Remove this comment to see the full error message
        errors.description = 'Announcement description is required';
    }
    return errors;
}

class CreateAnnouncement extends Component {
    state = {
        monitorError: null,
    };
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (event: $TSFixMe) => {
        if (event.target.localName !== 'textarea' && event.key) {
            switch (event.key) {
                case 'Escape':
                    return this.handleCloseModal();
                case 'Enter':
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    return document
                        .getElementById('createAnnouncementBtn')
                        .click();
                default:
                    return false;
            }
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createScheduledEventModalId' does not ex... Remove this comment to see the full error message
            id: this.props.createScheduledEventModalId,
        });
    };

    submitForm = (values: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createAnnouncement' does not exist on ty... Remove this comment to see the full error message
            createAnnouncement,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data: { projectId, statusPage },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAnnouncements' does not exist on ty... Remove this comment to see the full error message
            fetchAnnouncements,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
            formValues,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'mergeMonitors' does not exist on type 'R... Remove this comment to see the full error message
            mergeMonitors,
        } = this.props;
        const postObj = {};
        if (values.monitors && values.monitors.length > 0) {
            const monitors = values.monitors.filter(
                (monitorId: $TSFixMe) => typeof monitorId === 'string'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            postObj.monitors = monitors;
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            postObj.monitors = [];
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        postObj.name = values.name;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'description' does not exist on type '{}'... Remove this comment to see the full error message
        postObj.description = values[`description`];
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideAnnouncement' does not exist on type... Remove this comment to see the full error message
        postObj.hideAnnouncement = values.hideAnnouncement ? true : false;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
        const isDuplicate = postObj.monitors
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            ? postObj.monitors.length === new Set(postObj.monitors).size
                ? false
                : true
            : false;

        if (isDuplicate) {
            this.setState({
                monitorError: 'Duplicate monitor selection found',
            });
            return;
        }

        if (formValues && formValues.selectAllMonitors) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            postObj.monitors = mergeMonitors.map((monitor: $TSFixMe) => monitor._id);
        }

        createAnnouncement(projectId, statusPage._id, { data: postObj })
            .then((res: $TSFixMe) => {
                if (res) {
                    this.handleCloseModal();
                    fetchAnnouncements(projectId, statusPage._id, 0, 10);
                }
            })
            .catch((err: $TSFixMe) => {
                if (!err) {
                    this.handleCloseModal();
                }
            });
    };

    onContentChange = (val: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
        this.props.change('description', val);
    };

    renderMonitors = ({
        fields
    }: $TSFixMe) => {
        const { monitorError } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
        const { formValues, mergeMonitors } = this.props;

        return <>
            {formValues && formValues.selectAllMonitors && (
                <div
                    className="bs-Fieldset-row"
                    style={{ padding: 0, width: '100%' }}
                >
                    <div
                        className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                        style={{ padding: 0 }}
                    >
                        <div
                            className="Box-root"
                            style={{
                                height: '5px',
                            }}
                        ></div>
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                            <label
                                className="Checkbox"
                                htmlFor="selectAllMonitorsBox"
                            >
                                <Field
                                    component="input"
                                    type="checkbox"
                                    name="selectAllMonitors"
                                    className="Checkbox-source"
                                    id="selectAllMonitorsBox"
                                />
                                <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                    <div className="Checkbox-target Box-root">
                                        <div className="Checkbox-color Box-root"></div>
                                    </div>
                                </div>
                                <div className="Checkbox-label Box-root Margin-left--8">
                                    <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span>All Monitors Selected</span>
                                    </span>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>
            )}
            {formValues && !formValues.selectAllMonitors && (
                <div
                    style={{
                        width: '100%',
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
                            <span>Add Monitor</span>
                        </span>
                    </button>
                    {fields.length === 0 && !formValues.selectAllMonitors && (
                        <div
                            className="bs-Fieldset-row"
                            style={{ padding: 0, width: '100%' }}
                        >
                            <div
                                className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                                style={{ padding: 0 }}
                            >
                                <div
                                    className="Box-root"
                                    style={{
                                        height: '5px',
                                    }}
                                ></div>
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                    <label
                                        className="Checkbox"
                                        htmlFor="selectAllMonitorsBox"
                                    >
                                        <Field
                                            component="input"
                                            type="checkbox"
                                            name="selectAllMonitors"
                                            className="Checkbox-source"
                                            id="selectAllMonitorsBox"
                                        />
                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                            <div className="Checkbox-target Box-root">
                                                <div className="Checkbox-color Box-root"></div>
                                            </div>
                                        </div>
                                        <div className="Checkbox-label Box-root Margin-left--8">
                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    Select All Monitors
                                                </span>
                                            </span>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}
                    {fields.map((field: $TSFixMe, index: $TSFixMe) => {
                        return (
                            <div
                                style={{
                                    width: '65%',
                                    marginBottom: 10,
                                }}
                                key={index}
                            >
                                <Field
                                    className="db-select-nw Table-cell--width--maximized"
                                    component={RenderSelect}
                                    name={field}
                                    id={`monitorfield_${index}`}
                                    placeholder="Monitor"
                                    style={{
                                        height: '28px',
                                        width: '100%',
                                    }}
                                    options={[
                                        {
                                            value: '',
                                            label:
                                                mergeMonitors.length > 0
                                                    ? 'Select a Monitor'
                                                    : 'No Monitor available',
                                        },
                                        ...(mergeMonitors &&
                                        mergeMonitors.length > 0
                                            ? mergeMonitors.map(
                                                  (monitor: $TSFixMe) => ({
                                                      value: monitor._id,
                                                      label: `${monitor.componentId.name} / ${monitor.name}`
                                                  })
                                              )
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
                                        this.setState({
                                            monitorError: null,
                                        });
                                    }}
                                >
                                    <span className="bs-Button bs-Button--icon bs-Button--delete">
                                        <span>Remove Monitor</span>
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                    {monitorError && (
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
                                <span
                                    id="monitorError"
                                    style={{ color: 'red' }}
                                >
                                    {monitorError}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>;
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createError' does not exist on type 'Rea... Remove this comment to see the full error message
            createError,
        } = this.props;
        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 600 }}>
                        <ClickOutside
                            onClickOutside={() => this.handleCloseModal()}
                        >
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Create Announcement Template
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <form
                                id="scheduledEventForm"
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div className="bs-Modal-content">
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="endpoint"
                                                    >
                                                        <span>Title</span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <Field
                                                                component={
                                                                    RenderField
                                                                }
                                                                name="name"
                                                                placeholder="Title"
                                                                id="name"
                                                                className="bs-TextInput"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    padding:
                                                                        '3px 5px',
                                                                }}
                                                                autoFocus={true}
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
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="endpoint"
                                                    >
                                                        <span>Monitors</span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <FieldArray
                                                                name="monitors"
                                                                component={
                                                                    this
                                                                        .renderMonitors
                                                                }
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
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="monitorIds"
                                                    >
                                                        Description
                                                    </label>
                                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                        <Field
                                                            name="description"
                                                            component={
                                                                RenderCodeEditor
                                                            }
                                                            mode="markdown"
                                                            height="150px"
                                                            width="100%"
                                                            placeholder="This can be markdown"
                                                            wrapEnabled={true}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender if={createError}>
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {createError}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={() =>
                                                closeModal({
                                                    id: this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createScheduledEventModalId' does not ex... Remove this comment to see the full error message
                                                        .createScheduledEventModalId,
                                                })
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="createAnnouncementBtn"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={requesting}
                                            type="submit"
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Create</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {requesting && <FormLoader />}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
CreateAnnouncement.displayName = 'CreateAnnouncement';

const CreateAnnouncementForm = reduxForm({
    form: 'CreateAnnouncementForm',
    enableReinitialize: false,
    validate,
    destroyOnUnmount: true,
})(CreateAnnouncement);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
CreateAnnouncement.propTypes = {
    closeModal: PropTypes.func,
    createScheduledEventModalId: PropTypes.string,
    handleSubmit: PropTypes.func.isRequired,
    formValues: PropTypes.object,
    mergeMonitors: PropTypes.array,
    createAnnouncement: PropTypes.func,
    fetchAnnouncements: PropTypes.func,
    requesting: PropTypes.bool,
    createError: PropTypes.string,
    data: PropTypes.object,
    change: PropTypes.func,
};

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const {
        data: { projectId },
    } = ownProps;
    const allMonitors = state.monitor.monitorsList.monitors
        .filter((monitor: $TSFixMe) => String(monitor._id) === String(projectId))
        .map((monitor: $TSFixMe) => monitor.monitors)
        .flat();
    const monitors = state.statusPage.status.monitors;
    const mergeMonitors: $TSFixMe = [];
    allMonitors.forEach((allMon: $TSFixMe) => {
        monitors.forEach((mon: $TSFixMe) => {
            if (allMon._id === mon.monitor) {
                mergeMonitors.push(allMon);
            }
        });
    });

    return {
        createScheduledEventModalId: state.modal.modals[0].id,
        requesting: state.statusPage.createAnnouncement.requesting,
        createError: state.statusPage.createAnnouncement.error,
        mergeMonitors,
        initialValues: {
            selectAllMonitors: true,
        },
        formValues:
            state.form.CreateAnnouncementForm &&
            state.form.CreateAnnouncementForm.values,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { closeModal, createAnnouncement, fetchAnnouncements },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateAnnouncementForm);
