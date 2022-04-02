import React, { Component } from 'react';

import ClickOutside from 'react-click-outside';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { closeModal } from 'common-ui/actions/modal';
import PropTypes from 'prop-types';

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

        errors.name = 'Announcement name is required';
    }
    if (!values.description) {

        errors.description = 'Announcement description is required';
    }
    return errors;
}

interface CreateAnnouncementProps {
    closeModal?: Function;
    createScheduledEventModalId?: string;
    handleSubmit: Function;
    formValues?: object;
    mergeMonitors?: unknown[];
    createAnnouncement?: Function;
    fetchAnnouncements?: Function;
    requesting?: boolean;
    createError?: string;
    data?: object;
    change?: Function;
}

class CreateAnnouncement extends Component<ComponentProps> {
    state = {
        monitorError: null,
    };
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (event: $TSFixMe) => {
        if (event.target.localName !== 'textarea' && event.key) {
            switch (event.key) {
                case 'Escape':
                    return this.handleCloseModal();
                case 'Enter':

                    return document
                        .getElementById('createAnnouncementBtn')
                        .click();
                default:
                    return false;
            }
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.createScheduledEventModalId,
        });
    };

    submitForm = (values: $TSFixMe) => {
        const {

            createAnnouncement,

            data: { projectId, statusPage },

            fetchAnnouncements,

            formValues,

            mergeMonitors,
        } = this.props;
        const postObj = {};
        if (values.monitors && values.monitors.length > 0) {
            const monitors = values.monitors.filter(
                (monitorId: $TSFixMe) => typeof monitorId === 'string'
            );

            postObj.monitors = monitors;
        } else {

            postObj.monitors = [];
        }

        postObj.name = values.name;

        postObj.description = values[`description`];

        postObj.hideAnnouncement = values.hideAnnouncement ? true : false;


        const isDuplicate = postObj.monitors

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

            postObj.monitors = mergeMonitors.map((monitor: $TSFixMe) => monitor._id);
        }

        createAnnouncement(projectId, statusPage._id, { data: postObj })
            .then((res: ExpressResponse) => {
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

        this.props.change('description', val);
    };

    renderMonitors = ({
        fields
    }: $TSFixMe) => {
        const { monitorError } = this.state;

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

    override render() {
        const {

            handleSubmit,

            closeModal,

            requesting,

            createError,
        } = this.props;
        return (
            <div
                className="ModalLayer-contents"

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


CreateAnnouncement.displayName = 'CreateAnnouncement';

const CreateAnnouncementForm = reduxForm({
    form: 'CreateAnnouncementForm',
    enableReinitialize: false,
    validate,
    destroyOnUnmount: true,
})(CreateAnnouncement);


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

const mapStateToProps = (state: RootState, ownProps: $TSFixMe) => {
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

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    { closeModal, createAnnouncement, fetchAnnouncements },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateAnnouncementForm);
