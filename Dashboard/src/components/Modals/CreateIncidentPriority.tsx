import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { Field, reduxForm } from 'redux-form';

import ClickOutside from 'react-click-outside';
import { ValidateField } from '../../config';
import Color from '../basic/Color';
import { RenderField } from '../basic/RenderField';
import { createIncidentPriority } from '../../actions/incidentPriorities';
import { closeModal } from 'CommonUI/actions/modal';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

interface ColorPickerProps {
    input?: object;
    displayColorPicker: boolean;
    id: string;
    currentColorPicker: string;
    handleClick: Function;
    handleClose: Function;
}

class ColorPicker extends Component<ComponentProps> {
    handleChange(e: $TSFixMe) {

        this.props.input.onChange(e.rgb);
    }
    override render() {
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

interface CreateIncidentPriorityProps {
    newIncidentPriority: object;
    currentProject: object;
    closeThisDialog: Function;
    handleSubmit: Function;
    createIncidentPriority: Function;
}

class CreateIncidentPriority extends Component<ComponentProps> {
    constructor() {

        super();
        this.state = {
            displayColorPicker: false,
        };
    }

    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm(values: $TSFixMe) {
        const { name, color } = values;
        this.props

            .createIncidentPriority(this.props.currentProject._id, {
                name,
                color,
            })

            .then(() => this.props.closeThisDialog());
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':

                return document
                    .getElementById('CreateIncidentPriority')
                    .click();
            default:
                return false;
        }
    };

    override render() {

        const { handleSubmit, closeThisDialog } = this.props;

        const { displayColorPicker } = this.state;
        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <form onSubmit={handleSubmit(this.submitForm.bind(this))}>
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Create New Incident Priority
                                        </span>
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

                                                            .newIncidentPriority
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

                                                            .newIncidentPriority
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

                                                this.props.newIncidentPriority
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

                                                                    .newIncidentPriority
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

                                                this.props.newIncidentPriority
                                                    .requesting
                                            }
                                            id="CreateIncidentPriority"
                                        >
                                            <ShouldRender
                                                if={
                                                    this.props

                                                        .newIncidentPriority
                                                        .requesting
                                                }
                                            >
                                                <Spinner />
                                            </ShouldRender>
                                            <>
                                                <span>Create</span>
                                                <span className="create-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </>
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


CreateIncidentPriority.displayName = 'CreateIncidentPriority';

CreateIncidentPriority.propTypes = {
    newIncidentPriority: PropTypes.object.isRequired,
    currentProject: PropTypes.object.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    createIncidentPriority: PropTypes.func.isRequired,
};
const CreateIncidentPriorityForm = reduxForm({
    form: 'IncidentPriorityForm',
    initialValues: { color: { r: 255, g: 0, b: 0, a: 1 } },
})(CreateIncidentPriority);

const mapStateToProps = (state: RootState) => {
    return {
        currentProject: state.project.currentProject,
        newIncidentPriority: state.incidentPriorities.newIncidentPriority,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        createIncidentPriority,
        closeModal,
    },
    dispatch
);
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateIncidentPriorityForm);
