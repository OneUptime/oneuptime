import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { reduxForm, Field } from 'redux-form';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from 'CommonUI/actions/modal';
import {
    updateStatusPageLinksRequest,
    updateStatusPageLinksSuccess,
    updateStatusPageLinksError,
} from '../../actions/statusPage';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';

interface CreateFooterLinkProps {
    createFooterLinkModalId?: string;
    handleSubmit: Function;
    statusPage: object;
    links: unknown[];
    data?: object;
    closeModal: Function;
}

class CreateFooterLink extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (footerLinkValues: $TSFixMe) => {

        const { submitForm, footerName, index }: $TSFixMe = this.props.data;

        const values: $TSFixMe = this.props.links;

        if (footerName) {
            values[index] = footerLinkValues;
        } else {
            values.push(footerLinkValues);
        }
        submitForm({ links: values });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':

                return document.getElementById('createFooter').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.createFooterLinkModalId,
        });
    };

    override render() {

        const { handleSubmit, data }: $TSFixMe = this.props;

        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
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
                                            {data && data.footerName
                                                ? 'Update '
                                                : 'Create New '}{' '}
                                            Footer Link
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <form
                                onSubmit={handleSubmit(
                                    this.submitForm.bind(this)
                                )}
                            >
                                <div className="bs-Modal-content bs-u-paddingless">
                                    <div className="bs-Modal-block bs-u-paddingless">
                                        <div className="bs-Modal-content">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Link Name
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        name="name"
                                                        id="footerName"
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        component={RenderField}
                                                        placeholder="Home"
                                                        autoFocus={true}
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Link URL
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        name="url"
                                                        id="url"
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        component={RenderField}
                                                        placeholder="https://mycompany.com"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={

                                                this.props.statusPage &&

                                                this.props.statusPage.links
                                                    .error
                                            }
                                        >
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                        width: '208px',
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

                                                                    .statusPage
                                                                    .links.error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            onClick={e => {
                                                e.preventDefault();

                                                this.props.closeModal({
                                                    id: this.props

                                                        .createFooterLinkModalId,
                                                });
                                            }}
                                            type="button"
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="createFooter"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={

                                                this.props.statusPage.links
                                                    .requesting
                                            }
                                            type="submit"
                                        >

                                            {this.props.statusPage.links &&

                                                !this.props.statusPage.links
                                                    .requesting && (
                                                    <>
                                                        <span>
                                                            {data &&
                                                                data.footerName
                                                                ? 'Update'
                                                                : 'Add'}
                                                        </span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}

                                            {this.props.statusPage.links &&

                                                this.props.statusPage.links
                                                    .requesting && (
                                                    <FormLoader />
                                                )}
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


CreateFooterLink.displayName = 'CreateFooterLink';

//Client side validation
function validate(values: $TSFixMe) {
    const errors: $TSFixMe = {};

    if (!Validate.text(values.name)) {

        errors.name = 'Name is not in text format.';
    }
    if (!Validate.text(values.url)) {

        errors.url = 'Url is invalid.';
    }
    return errors;
}

const CreateFooterLinkForm: $TSFixMe = reduxForm({
    form: 'CreateFooterLink',
    validate, // <--- validation function given to redux-for
})(CreateFooterLink);

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            closeModal,
            updateStatusPageLinksRequest,
            updateStatusPageLinksSuccess,
            updateStatusPageLinksError,
        },
        dispatch
    );
};

function mapStateToProps(state: RootState, ownProps: $TSFixMe) {
    const status: $TSFixMe = state.statusPage.status || [];
    const links: $TSFixMe = [];

    status.links &&
        status.links.forEach((link: $TSFixMe) => {
            links.push({
                name: link.name,
                url: link.url,
            });
        });

    return {
        links: links,
        statusPage: state.statusPage,
        currentProject: state.project.currentProject,
        createFooterLinkModalId: state.modal.modals[0].id,
        initialValues:
            links.length > 0

                ? links.filter(obj => obj.name === ownProps.data.footerName)[0]
                : {},
    };
}


CreateFooterLink.propTypes = {
    createFooterLinkModalId: PropTypes.string,
    handleSubmit: PropTypes.func.isRequired,
    statusPage: PropTypes.object.isRequired,
    links: PropTypes.array.isRequired,
    data: PropTypes.object,
    closeModal: PropTypes.func.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateFooterLinkForm);
