import React, { Component } from 'react';
import ClickOutside from 'react-click-outside';
import { connect } from 'react-redux';
import { closeModal } from '../../actions/modal';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { Field, FieldArray, reduxForm } from 'redux-form';
import { RenderTextArea } from '../basic/RenderTextArea';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import {
    updateAnnouncement,
    fetchAnnouncements,
} from '../../actions/statusPage';

function validate(values) {
    const errors = {};

    if (!values.name) {
        errors.name = 'Announcement name is required';
    }
    if (!values.description) {
        errors.description = 'Announcement description is required';
    }
    return errors;
}

class EditAnnouncement extends Component {
    state = {
        monitorError: null,
    };

    handleCloseModal = () => {
        this.props.closeModal({
            id: this.props.EditAnnouncementId,
        });
    };

    submitForm = values => {
        const {
            mergeMonitors,
            updateAnnouncement,
            data: { projectId, statusPage, announcement },
            fetchAnnouncements,
        } = this.props;
        const postObj = {};
        if (values.monitors && values.monitors.length > 0) {
            const monitors = values.monitors.filter(
                monitorId => typeof monitorId === 'string'
            );
            postObj.monitors = monitors;
        } else {
            postObj.monitors = mergeMonitors.map(monitor => monitor._id);
        }
        postObj.name = values.name;
        postObj.description = values.description;
        postObj.update = true;
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

        if (
            postObj.monitors &&
            postObj.monitors.length === 0 &&
            !values.selectAllMonitors
        ) {
            this.setState({
                monitorError: 'No monitor was selected',
            });
            return;
        }

        updateAnnouncement(projectId, statusPage._id, announcement._id, {
            data: postObj,
        })
            .then(res => {
                if (res) {
                    this.handleCloseModal();
                    fetchAnnouncements(projectId, statusPage._id, 0, 10);
                }
            })
            .catch(err => {
                if (!err) {
                    this.handleCloseModal();
                }
            });
    };

    renderMonitors = ({ fields }) => {
        const { monitorError } = this.state;
        const { formValues, mergeMonitors } = this.props;

        return (
            <>
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
                        {fields.map((field, index) => {
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
                                                      monitor => ({
                                                          value: monitor._id,
                                                          label: `${monitor.componentId.name} / ${monitor.name}`,
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
            </>
        );
    };

    render() {
        const {
            handleSubmit,
            closeModal,
            requesting,
            updateError,
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
                                        <span>Update Announcement</span>
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
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <Field
                                                                className="bs-TextArea"
                                                                component={
                                                                    RenderTextArea
                                                                }
                                                                type="text"
                                                                name="description"
                                                                rows="5"
                                                                id="description"
                                                                placeholder="Description"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    resize:
                                                                        'none',
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <fieldset>
                                            <div
                                                style={{ display: 'flex' }}
                                                className="Flex-alignItems--center Flex-justifyContent--center"
                                            >
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{
                                                        width: '11rem',
                                                        flex: 'none',
                                                        textAlign: 'left',
                                                    }}
                                                ></label>
                                                <div className="bs-Fieldset-fields">
                                                    <span className="value">
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                            <label
                                                                className="Checkbox"
                                                                htmlFor="hideAnnouncementBox"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="checkbox"
                                                                    name="hideAnnouncement"
                                                                    className="Checkbox-source"
                                                                    id="hideAnnouncementBox"
                                                                />
                                                                <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                    <div className="Checkbox-target Box-root">
                                                                        <div className="Checkbox-color Box-root"></div>
                                                                    </div>
                                                                </div>
                                                                <div className="Checkbox-label Box-root Margin-left--8">
                                                                    <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                        <span>
                                                                            Hide
                                                                            on
                                                                            status
                                                                            page
                                                                        </span>
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </span>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender if={updateError}>
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
                                                            {updateError}
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
                                                        .EditAnnouncementId,
                                                })
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="updateAnnouncementBtn"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={requesting}
                                            type="submit"
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Update</span>
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

EditAnnouncement.displayName = 'EditAnnouncement';

const EditAnnouncementForm = reduxForm({
    form: 'EditAnnouncementForm',
    validate,
    destroyOnUnmount: true,
})(EditAnnouncement);

EditAnnouncement.propTypes = {
    closeModal: PropTypes.func,
    EditAnnouncementId: PropTypes.string,
    handleSubmit: PropTypes.func,
    formValues: PropTypes.object,
    mergeMonitors: PropTypes.array,
    updateAnnouncement: PropTypes.func,
    fetchAnnouncements: PropTypes.func,
    requesting: PropTypes.bool,
    updateError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    data: PropTypes.object,
};

const mapStateToProps = (state, ownProps) => {
    const {
        data: { announcement },
    } = ownProps;
    const {
        data: { projectId },
    } = ownProps;
    const allMonitors = state.monitor.monitorsList.monitors
        .filter(monitor => String(monitor._id) === String(projectId))
        .map(monitor => monitor.monitors)
        .flat();

    const monitorIds =
        allMonitors.length !== announcement.monitors.length
            ? announcement
                ? announcement.monitors.map(monitor => monitor.monitorId._id)
                : []
            : [];

    const initialValues = {};
    initialValues.name = announcement.name;
    initialValues.description = announcement.description;
    initialValues.hideAnnouncement = announcement.hideAnnouncement;
    initialValues.selectAllMonitors =
        allMonitors.length === announcement.monitors.length ? true : false;
    initialValues.monitors = [...monitorIds];

    const monitors = state.statusPage.status.monitors;
    const mergeMonitors = [];
    allMonitors.forEach(allMon => {
        monitors.forEach(mon => {
            if (allMon._id === mon.monitor) {
                mergeMonitors.push(allMon);
            }
        });
    });
    return {
        requesting: state.statusPage.createAnnouncement.requesting,
        updateError: state.statusPage.createAnnouncement.error,
        mergeMonitors,
        initialValues,
        formValues:
            state.form.EditAnnouncementForm &&
            state.form.EditAnnouncementForm.values,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { closeModal, updateAnnouncement, fetchAnnouncements },
        dispatch
    );

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditAnnouncementForm);
