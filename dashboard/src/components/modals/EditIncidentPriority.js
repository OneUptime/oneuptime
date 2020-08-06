import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm } from 'redux-form';
import { ValidateField } from '../../config';
import Color from '../basic/Color';
import { RenderField } from '../basic/RenderField';
import { updateIncidentPriority } from '../../actions/incidentPriorities';
import { closeModal } from '../../actions/modal';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

class ColorPicker extends Component {
    handleChange(e) {
        this.props.input.onChange(e.rgb);
    }
    render() {
        const {
            displayColorPicker,
            currentColorPicker,
            input,
            id,
            handleClose,
            handleClick,
        } = this.props;

        return (
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
ColorPicker.displayName = 'ColorPicker';
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
        super();
        this.state = {
            displayColorPicker: false,
        };
    }

    submitForm(values) {
        const { name, color } = values;
        this.props
            .updateIncidentPriority(this.props.currentProject._id, {
                _id: this.props.data.selectedIncidentPriority,
                name,
                color,
            })
            .then(() => this.props.closeThisDialog());
    }

    render() {
        const { handleSubmit, closeThisDialog } = this.props;
        const { displayColorPicker } = this.state;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <form onSubmit={handleSubmit(this.submitForm.bind(this))}>
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
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
                                                        .editIncidentPriority
                                                        .requesting
                                                }
                                                validate={
                                                    ValidateField.required
                                                }
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
                                                        .editIncidentPriority
                                                        .requesting &&
                                                    displayColorPicker
                                                }
                                                handleClick={() =>
                                                    this.setState({
                                                        displayColorPicker: !this
                                                            .state
                                                            .displayColorPicker,
                                                    })
                                                }
                                                handleClose={() =>
                                                    this.setState({
                                                        displayColorPicker: !this
                                                            .state
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
                                            this.props.editIncidentPriority
                                                .error
                                        }
                                    >
                                        <div className="bs-Tail-copy">
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{ marginTop: '10px' }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
                                                        {
                                                            this.props
                                                                .editIncidentPriority
                                                                .error
                                                        }
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <button
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={closeThisDialog}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={
                                            this.props.editIncidentPriority
                                                .requesting
                                        }
                                        type="save"
                                    >
                                        <ShouldRender
                                            if={
                                                this.props.editIncidentPriority
                                                    .requesting
                                            }
                                        >
                                            <Spinner />
                                        </ShouldRender>
                                        <span>Save</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </form>
            </div>
        );
    }
}

EditIncidentPriority.displayName = 'EditIncidentPriority';
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

const mapStateToProps = (state, ownProps) => {
    return {
        currentProject: state.project.currentProject,
        editIncidentPriority: state.incidentPriorities.editIncidentPriority,
        initialValues: state.incidentPriorities.incidentPrioritiesList.incidentPriorities.filter(
            incidentPriority =>
                incidentPriority._id === ownProps.data.selectedIncidentPriority
        )[0],
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
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
