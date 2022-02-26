import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, FieldArray } from 'redux-form';
import {
    updateStatusPageLinks,
    updateStatusPageLinksRequest,
    updateStatusPageLinksSuccess,
    updateStatusPageLinksError,
    fetchProjectStatusPage,
} from '../../actions/statusPage';
import { RenderLinks } from '../basic/RenderLinks';
import { Validate } from '../../config';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import CreateFooterLink from '../modals/FooterLink';
import { openModal, closeModal } from '../../actions/modal';
import MessageBox from '../modals/MessageBox';

//Client side validation
function validate(values: $TSFixMe) {
    const errors = {};
    const linksArrayErrors = [];

    if (values.links) {
        for (let i = 0; i < values.links.length; i++) {
            const linkErrors = {};
            if (values.links[i].name) {
                if (!Validate.text(values.links[i].name)) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
                    linkErrors.name = 'Name is not in text format.';
                    linksArrayErrors[i] = linkErrors;
                }
            }

            if (values.links[i].url) {
                if (!Validate.url(values.links[i].url)) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'url' does not exist on type '{}'.
                    linkErrors.url = 'Url is invalid.';
                    linksArrayErrors[i] = linkErrors;
                }
            }
        }

        if (linksArrayErrors.length) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'links' does not exist on type '{}'.
            errors.links = linksArrayErrors;
        }
    }

    return errors;
}

export class Links extends Component {
    handleKeyBoard: $TSFixMe;
    state = {
        createFooterLinkModalId: uuidv4(),
        MessageBoxId: uuidv4(),
        removeFooterLinkModalId: uuidv4(),
    };

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        const { _id, projectId } = this.props.statusPage.status;
        if (_id) values._id = _id;
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateStatusPageLinks' does not exist on... Remove this comment to see the full error message
            .updateStatusPageLinks(projectId._id || projectId, values)
            .then(() => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectStatusPage' does not exist o... Remove this comment to see the full error message
                this.props.fetchProjectStatusPage(
                    projectId._id || projectId,
                    true
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.closeModal({
                    id: this.state.createFooterLinkModalId,
                });
            });
    };

    handleRemoveFooterLink = (index: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
        const { links } = this.props.initialValues;
        const newLinks = [...links];
        newLinks.splice(index, 1);
        this.submitForm({ links: newLinks });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit, statusPage, openModal } = this.props;
        const {
            createFooterLinkModalId,
            MessageBoxId,
            removeFooterLinkModalId,
        } = this.state;
        let deleting = false;

        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statusPage.links &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statusPage.links.requesting
        ) {
            deleting = true;
        }

        return (
            <div
                className="bs-ContentSection Card-root Card-shadow--medium"
                onKeyDown={this.handleKeyBoard}
            >
                <div className="Box-root">
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span
                                        style={{ textTransform: 'capitalize' }}
                                    >
                                        Custom Footer Links
                                    </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        This section belongs to customizing your
                                        footer and adding links to external
                                        pages. You can add upto five links.
                                    </span>
                                </span>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div>
                                    <button
                                        id="btnAddLink"
                                        type="button"
                                        className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                        onClick={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
                                            this.props.initialValues &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
                                            this.props.initialValues.links
                                                .length >= 5
                                                ? () =>
                                                      openModal({
                                                          id: MessageBoxId,
                                                          content: MessageBox,
                                                          title:
                                                              'Custom Footer Links',
                                                          message:
                                                              'You have already added 5 custom footer links',
                                                      })
                                                : () =>
                                                      openModal({
                                                          id: createFooterLinkModalId,
                                                          content: DataPathHoC(
                                                              CreateFooterLink,
                                                              {
                                                                  submitForm: this
                                                                      .submitForm,
                                                                  statusPage: statusPage,
                                                              }
                                                          ),
                                                      })
                                        }
                                    >
                                        Add Link
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit(this.submitForm)}>
                        <div
                            className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1"
                            style={{ overflow: 'hidden', overflowX: 'auto' }}
                        >
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root">
                                    <fieldset className="Box-background--white">
                                        <div className="bs-Fieldset-rows">
                                            <FieldArray
                                                name="links"
                                                component={RenderLinks}
                                                openModal={openModal}
                                                createFooterLinkModalId={
                                                    createFooterLinkModalId
                                                }
                                                submitForm={this.submitForm}
                                                //statusPage={statusPage}
                                                removeFooterLink={
                                                    this.handleRemoveFooterLink
                                                }
                                                removeFooterLinkModalId={
                                                    removeFooterLinkModalId
                                                }
                                                deleting={deleting}
                                            />
                                        </div>
                                        <ShouldRender
                                            if={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
                                                this.props.initialValues.links
                                                    .length === 0
                                            }
                                        >
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                                style={{
                                                    textAlign: 'center',
                                                    marginTop: '20px',
                                                    padding: '0 10px',
                                                }}
                                            >
                                                You don&#39;t have any custom
                                                footer link added yet!
                                            </div>
                                        </ShouldRender>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root">
                                        <p>
                                            <span>
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    {
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
                                                        this.props.initialValues
                                                            .links.length
                                                    }{' '}
                                                    Footer links
                                                </span>
                                            </span>
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Links.displayName = 'Links';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Links.propTypes = {
    updateStatusPageLinks: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
    statusPage: PropTypes.object.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
    initialValues: PropTypes.object,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        updateStatusPageLinks,
        updateStatusPageLinksRequest,
        updateStatusPageLinksSuccess,
        updateStatusPageLinksError,
        fetchProjectStatusPage,
        openModal,
        closeModal,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    const status = state.statusPage.status || [];
    const links: $TSFixMe = [];

    status.links &&
        status.links.forEach((link: $TSFixMe) => {
            links.push({
                name: link.name,
                url: link.url,
            });
        });

    return {
        initialValues: { links },
        statusPage: state.statusPage,
        currentProject: state.project.currentProject,
    };
};

const LinksForm = reduxForm({
    form: 'Links', // a unique identifier for this form
    validate, // <--- validation function given to redux-for
    enableReinitialize: true,
})(Links);

export default connect(mapStateToProps, mapDispatchToProps)(LinksForm);
