import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, FieldArray } from 'redux-form';
import { updateStatusPageLinks, updateStatusPageLinksRequest, updateStatusPageLinksSuccess, updateStatusPageLinksError, fetchProjectStatusPage } from '../../actions/statusPage';
import { RenderLinks } from '../basic/RenderLinks';
import { Validate } from '../../config';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import DataPathHoC from '../DataPathHoC';
import CreateFooterLink from '../modals/FooterLink';
import { openModal, closeModal } from '../../actions/modal';
import MessageBox from '../modals/MessageBox';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

//Client side validation
function validate(values) {
    const errors = {};
    const linksArrayErrors = [];

    if (values.links) {
        for (var i = 0; i < values.links.length; i++) {
            const linkErrors = {}
            if (values.links[i].name) {

                if (!Validate.text(values.links[i].name)) {
                    linkErrors.name = 'Name is not in text format.'
                    linksArrayErrors[i] = linkErrors
                }
            }

            if (values.links[i].url) {

                if (!Validate.url(values.links[i].url)) {
                    linkErrors.url = 'Url is invalid.'
                    linksArrayErrors[i] = linkErrors
                }
            }
        }

        if (linksArrayErrors.length) {
            errors.links = linksArrayErrors
        }
    }

    return errors;
}

export class Links extends Component {

    state = {
        createFooterLinkModalId: uuid.v4(),
        MessageBoxId: uuid.v4(),
        removeFooterLinkModalId: uuid.v4(),
    }

    submitForm = (values) => {
        const { _id, projectId } = this.props.statusPage.status
        if(_id) values._id = _id;
        this.props.updateStatusPageLinks(projectId._id || projectId, values).then(()=>{
            this.props.fetchProjectStatusPage(projectId._id || projectId, true);
            this.props.closeModal({ id: this.state.createFooterLinkModalId });
        })
        if (!IS_DEV) {
            logEvent('Links Updated', values);
        }
    }

    handleRemoveFooterLink = (linkName) => {
        let { links } = this.props.initialValues;
        links = links.filter(item => item.name !== linkName);
        this.submitForm({ links });
    }

    render() {
        const { handleSubmit, statusPage, openModal } = this.props;
        const { createFooterLinkModalId, MessageBoxId, removeFooterLinkModalId } = this.state;
        let deleting = false;

        if (this.props.statusPage.links && this.props.statusPage.links.requesting) {
            deleting = true;
        }

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium" onKeyDown={this.handleKeyBoard}>
                <div className="Box-root">
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span style={{ 'textTransform': 'capitalize' }}>Custom Footer Links</span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        This section belongs to customizing your footer and adding links to external pages. You can add upto five links.
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
                                            this.props.initialValues && this.props.initialValues.links.length >= 5 ? 
                                            () => openModal({
                                                id: MessageBoxId,
                                                content: MessageBox,
                                                title: 'Custom Footer Links',
                                                message: 'You have already added 5 custom footer links'
                                            }) :
                                            () => openModal({
                                                id: createFooterLinkModalId,
                                                content: DataPathHoC(CreateFooterLink, {
                                                    submitForm: this.submitForm,
                                                    statusPage: statusPage
                                                }),
                                            })
                                        }
                                    >
                                        Add Link
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit(this.submitForm)} >
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root">
                                    <fieldset className="Box-background--white">
                                        <div className="bs-Fieldset-rows">
                                            <FieldArray
                                                name="links"
                                                component={RenderLinks}
                                                openModal={openModal}
                                                createFooterLinkModalId={createFooterLinkModalId}
                                                submitForm={this.submitForm}
                                                statusPage={statusPage}
                                                removeFooterLink={this.handleRemoveFooterLink}
                                                removeFooterLinkModalId={removeFooterLinkModalId}
                                                deleting={deleting}
                                            />
                                        </div>
                                        <ShouldRender if={this.props.initialValues.links.length === 0}>
                                            <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center" style={{ marginTop: '20px' }}>
                                                You don&#39;t have any custom footer link added yet!
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
                                                    {this.props.initialValues.links.length} Footer links
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

Links.displayName = 'Links'

Links.propTypes = {
    updateStatusPageLinks: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
    statusPage: PropTypes.object.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
    initialValues: PropTypes.object,
}

const mapDispatchToProps = dispatch => bindActionCreators(
    {
        updateStatusPageLinks,
        updateStatusPageLinksRequest,
        updateStatusPageLinksSuccess,
        updateStatusPageLinksError,
        fetchProjectStatusPage,
        openModal,
        closeModal,
    }, dispatch
)

const mapStateToProps = state => {
    const status = state.statusPage.status || [];
    let links = [];

    status.links && status.links.forEach((link) => {
        links.push({
            name: link.name,
            url: link.url
        })
    });

    return {
        initialValues: { links },
        statusPage: state.statusPage,
        currentProject: state.project.currentProject,
    };
}

let LinksForm = reduxForm({
    form: 'Links', // a unique identifier for this form
    validate, // <--- validation function given to redux-for
    enableReinitialize: true
})(Links);

export default connect(mapStateToProps, mapDispatchToProps)(LinksForm);
