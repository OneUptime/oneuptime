import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { changeMonitorComponent } from '../../actions/monitor';
import ComponentSelector from '../basic/ComponentSelector';
import { ValidateField } from '../../config';

const formName = 'changeMonitorComponentForm';

class ChangeMonitorComponent extends React.Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = values => {
        const { data, changeMonitorComponent } = this.props;
        const projectId = data.monitor.projectId._id;
        const monitorId = data.monitor._id;
        const { newComponentId } = values;
        changeMonitorComponent(projectId, monitorId, newComponentId).then(
            response => {
                if (!this.props.changeMonitorComponentError) {
                    this.props.confirmThisDialog(response.data);
                }
            }
        );
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return document
                    .getElementById('changeMonitorComponentButton')
                    .click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        this.props.closeModal({
            id: this.props.changeMonitorComponentModalId,
        });
    };

    render() {
        const {
            requesting,
            changeMonitorComponentError,
            closeModal,
            handleSubmit,
            components,
            data,
        } = this.props;

        const projectId = data.monitor.projectId._id;
        const oldComponentId = data.monitor.componentId._id;

        return (
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 600 }}>
                        <ClickOutside onClickOutside={this.handleCloseModal}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Move Monitor to another Component
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <form
                                id={formName}
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
                                                        htmlFor="fieldName"
                                                    >
                                                        <span>
                                                            New Component
                                                        </span>
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
                                                                    ComponentSelector
                                                                }
                                                                name="newComponentId"
                                                                placeholder="Select Component"
                                                                id="newComponentId"
                                                                className="db-select-nw"
                                                                style={{
                                                                    height:
                                                                        '28px',
                                                                    width:
                                                                        '100%',
                                                                }}
                                                                autoFocus={true}
                                                                components={components
                                                                    .reduce(
                                                                        (
                                                                            result,
                                                                            component
                                                                        ) => {
                                                                            if (
                                                                                component._id ===
                                                                                projectId
                                                                            ) {
                                                                                return [
                                                                                    ...result,
                                                                                    ...component.components,
                                                                                ];
                                                                            }

                                                                            return result;
                                                                        },
                                                                        []
                                                                    )
                                                                    .filter(
                                                                        component =>
                                                                            component._id !==
                                                                            oldComponentId
                                                                    )}
                                                                validate={
                                                                    ValidateField.select
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={changeMonitorComponentError}
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
                                                                changeMonitorComponentError
                                                            }
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
                                                        .changeMonitorComponentModalId,
                                                })
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="changeMonitorComponentButton"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={requesting}
                                            type="submit"
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Change</span>
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

ChangeMonitorComponent.displayName = 'ChangeMonitorComponent';

ChangeMonitorComponent.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    changeMonitorComponent: PropTypes.func.isRequired,
    changeMonitorComponentModalId: PropTypes.string,
    data: PropTypes.object,
    requesting: PropTypes.bool,
    changeMonitorComponentError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    components: PropTypes.array,
    confirmThisDialog: PropTypes.func,
};

const ChangeMonitorComponentForm = reduxForm({
    form: formName,
    enableReinitialize: false,
    destroyOnUnmount: true,
})(ChangeMonitorComponent);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            changeMonitorComponent,
            closeModal,
        },
        dispatch
    );

const mapStateToProps = state => {
    return {
        components: state.component.componentList.components,
        requesting: state.monitor.changeMonitorComponent.requesting,
        changeMonitorComponentError: state.monitor.changeMonitorComponent.error,
        changeMonitorComponentModalId: state.modal.modals[0].id,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ChangeMonitorComponentForm);
