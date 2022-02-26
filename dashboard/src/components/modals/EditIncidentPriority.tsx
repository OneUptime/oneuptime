import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { ValidateField } from '../../config';
import Color from '../basic/Color';
import { RenderField } from '../basic/RenderField';
import { updateIncidentPriority } from '../../actions/incidentPriorities';
import { closeModal } from '../../actions/modal';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

class ColorPicker extends Component {
    handleChange(e: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'input' does not exist on type 'Readonly<... Remove this comment to see the full error message
        this.props.input.onChange(e.rgb);
    }
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'displayColorPicker' does not exist on ty... Remove this comment to see the full error message
            displayColorPicker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentColorPicker' does not exist on ty... Remove this comment to see the full error message
            currentColorPicker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'input' does not exist on type 'Readonly<... Remove this comment to see the full error message
            input,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'id' does not exist on type 'Readonly<{}>... Remove this comment to see the full error message
            id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleClose' does not exist on type 'Rea... Remove this comment to see the full error message
            handleClose,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleClick' does not exist on type 'Rea... Remove this comment to see the full error message
            handleClick,
        } = this.props;

        return (
            // @ts-expect-error ts-migrate(2741) FIXME: Property 'title' is missing in type '{ handleClick... Remove this comment to see the full error message
            <Color
                handleClick={handleClick}
                handleChange={e => this.handleChange(e)}
                handleClose={handleClose}
                id={id}
                color={input.value}
                displayColorPicker={displayColorPicker}
                currentColorPicker={currentColorPicker}
            />
        );
    }
}
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ColorPicker.displayName = 'ColorPicker';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ColorPicker.propTypes = {
    input: PropTypes.object,
    displayColorPicker: PropTypes.bool.isRequired,
    id: PropTypes.string.isRequired,
    currentColorPicker: PropTypes.string.isRequired,
    handleClick: PropTypes.func.isRequired,
    handleClose: PropTypes.func.isRequired,
};

class EditIncidentPriority extends Component {
    constructor() {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1-2 arguments, but got 0.
        super();
        this.state = {
            displayColorPicker: false,
        };
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm(values: $TSFixMe) {
        const { name, color } = values;
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateIncidentPriority' does not exist o... Remove this comment to see the full error message
            .updateIncidentPriority(this.props.currentProject._id, {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                _id: this.props.data.selectedIncidentPriority,
                name,
                color,
            })
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            .then(() => this.props.closeThisDialog());
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('EditIncidentPriority').click();
            default:
                return false;
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit, closeThisDialog } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'displayColorPicker' does not exist on ty... Remove this comment to see the full error message
        const { displayColorPicker } = this.state;

        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <form onSubmit={handleSubmit(this.submitForm.bind(this))}>
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Edit Incident Priority</span>
                                    </span>
                                </div>
                                <div className="bs-Modal-content">
                                    <div className="bs-Fieldset-rows">
                                        <div className="bs-Fieldset-row Margin-bottom--12">
                                            <label className="bs-Fieldset-label">
                                                Priority name
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <Field
                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                    component={RenderField}
                                                    name="name"
                                                    placeholder="Priority name"
                                                    disabled={
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editIncidentPriority' does not exist on ... Remove this comment to see the full error message
                                                            .editIncidentPriority
                                                            .requesting
                                                    }
                                                    validate={
                                                        ValidateField.required
                                                    }
                                                    autoFocus={true}
                                                />
                                            </div>
                                        </div>

                                        <div className="bs-Fieldset-row Margin-bottom--12">
                                            <label className="bs-Fieldset-label">
                                                Priority Color
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <Field
                                                    component={ColorPicker}
                                                    id="color"
                                                    name="color"
                                                    currentColorPicker="color"
                                                    displayColorPicker={
                                                        !this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editIncidentPriority' does not exist on ... Remove this comment to see the full error message
                                                            .editIncidentPriority
                                                            .requesting &&
                                                        displayColorPicker
                                                    }
                                                    handleClick={() =>
                                                        this.setState({
                                                            displayColorPicker: !this
                                                                .state
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'displayColorPicker' does not exist on ty... Remove this comment to see the full error message
                                                                .displayColorPicker,
                                                        })
                                                    }
                                                    handleClose={() =>
                                                        this.setState({
                                                            displayColorPicker: !this
                                                                .state
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'displayColorPicker' does not exist on ty... Remove this comment to see the full error message
                                                                .displayColorPicker,
                                                        })
                                                    }
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'editIncidentPriority' does not exist on ... Remove this comment to see the full error message
                                                this.props.editIncidentPriority
                                                    .error
                                            }
                                        >
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
                                                            {
                                                                this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'editIncidentPriority' does not exist on ... Remove this comment to see the full error message
                                                                    .editIncidentPriority
                                                                    .error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={closeThisDialog}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'editIncidentPriority' does not exist on ... Remove this comment to see the full error message
                                                this.props.editIncidentPriority
                                                    .requesting
                                            }
                                            id="EditIncidentPriority"
                                        >
                                            <ShouldRender
                                                if={
                                                    this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editIncidentPriority' does not exist on ... Remove this comment to see the full error message
                                                        .editIncidentPriority
                                                        .requesting
                                                }
                                            >
                                                <Spinner />
                                            </ShouldRender>
                                            <span>Save</span>
                                            <span className="create-btn__keycode">
                                                <span className="keycode__icon keycode__icon--enter" />
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </form>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
EditIncidentPriority.displayName = 'EditIncidentPriority';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
EditIncidentPriority.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    editIncidentPriority: PropTypes.object.isRequired,
    data: PropTypes.object.isRequired,
    currentProject: PropTypes.object.isRequired,
    updateIncidentPriority: PropTypes.func.isRequired,
};
const EditIncidentPriorityForm = reduxForm({
    form: 'EditIncidentPriorityForm',
})(EditIncidentPriority);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        editIncidentPriority: state.incidentPriorities.editIncidentPriority,
        initialValues: state.incidentPriorities.incidentPrioritiesList.incidentPriorities.filter(
            (incidentPriority: $TSFixMe) => incidentPriority._id === ownProps.data.selectedIncidentPriority
        )[0],
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        updateIncidentPriority,
        closeModal,
    },
    dispatch
);
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditIncidentPriorityForm);
