import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, FieldArray } from 'redux-form';
import { updateStatusPageLinks, updateStatusPageLinksRequest, updateStatusPageLinksSuccess, updateStatusPageLinksError, fetchProjectStatusPage } from '../../actions/statusPage';
import { RenderLinks } from '../basic/RenderLinks';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import DataPathHoC from '../DataPathHoC';
import CreateFooterLink from '../modals/FooterLink';
import { openModal, closeModal } from '../../actions/modal';

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
    }

    submitForm = (values) => {
        const { _id, projectId } = this.props.statusPage.status
        if(_id) values._id = _id;
        this.props.updateStatusPageLinks(projectId._id || projectId, values).then(()=>{
            this.props.fetchProjectStatusPage(projectId._id || projectId, true);
            this.props.closeModal({ id: this.state.createFooterLinkModalId });
        })
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Links Updated', values);
        }
    }

    render() {
        const { handleSubmit, statusPage, openModal } = this.props;
        const { createFooterLinkModalId } = this.state;

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
                                    <ShouldRender if={this.props.initialValues && this.props.initialValues.links.length < 5}>
                                        <button
                                            id="btnAddLink"
                                            type="button"
                                            className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                            onClick={() => openModal({
                                                    id: createFooterLinkModalId,
                                                    content: DataPathHoC(CreateFooterLink, { submitForm: this.submitForm, statusPage: statusPage }),
                                                })
                                            }
                                        >
                                            Add Link
                                        </button>
                                    </ShouldRender>
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
                                            />
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root">
                                        <p>
                                            <span>You can add as many as five links that will show up on your status page.</span>
                                        </p>
                                    </div>
                                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                        <span className="db-SettingsForm-footerMessage"></span>
                                        <div>
                                        <button
                                            id="btnSaveLinks"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                            disabled={statusPage.links.requesting}
                                            type="submit"
                                        >
                                            {!statusPage.links.requesting && <span>Save</span>}
                                            {statusPage.links.requesting && <FormLoader />}
                                        </button>
                                        </div>
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

Links.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(LinksForm);