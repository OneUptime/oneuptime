/*eslint-disable*/
import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, FieldArray } from 'redux-form';
import {
    updateStatusPageLinks,
    updateStatusPageLinksRequest,
    updateStatusPageLinksSuccess,
    updateStatusPageLinksError,
    fetchProjectStatusPage,
    fetchExternalStatusPages
} from '../../actions/statusPage';
import { ExternalStatusPagesTable } from '../basic/ExternalStatusPagesTable';
import { Validate } from '../../config';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import ExternalStatusPagesModal from '../modals/ExternalStatusPagesModal';
import { openModal, closeModal } from '../../actions/modal';

//Client side validation
function validate(values) {
    const errors = {};
    const linksArrayErrors = [];

    if (values.links) {
        for (let i = 0; i < values.links.length; i++) {
            const linkErrors = {};
            if (values.links[i].name) {
                if (!Validate.text(values.links[i].name)) {
                    linkErrors.name = 'Name is not in text format.';
                    linksArrayErrors[i] = linkErrors;
                }
            }

            if (values.links[i].url) {
                if (!Validate.url(values.links[i].url)) {
                    linkErrors.url = 'Url is invalid.';
                    linksArrayErrors[i] = linkErrors;
                }
            }
        }

        if (linksArrayErrors.length) {
            errors.links = linksArrayErrors;
        }
    }

    return errors;
}

export class ExternalStatusPages extends Component {
    state = {
        createFooterLinkModalId: uuidv4(),
        MessageBoxId: uuidv4(),
        removeFooterLinkModalId: uuidv4(),

        externalStatusPageModalId: uuidv4(),
        deleteModalId: uuidv4(),
    };

    componentDidMount(){
        this.props.fetchExternalStatusPages(this.props.subProjectId, this.props.statusPageId);
    }
    render() {
        const { handleSubmit, statusPage, openModal } = this.props;
        const {
            createFooterLinkModalId,
            MessageBoxId,
            removeFooterLinkModalId,
            externalStatusPageModalId
        } = this.state;
        let deleting = false;

        if (
            this.props.statusPage.links &&
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
                                        External Status Pages
                                    </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        This is a service for adding external status pages.
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
                                            () =>
                                                openModal({
                                                    id: externalStatusPageModalId,
                                                    content: DataPathHoC(
                                                        ExternalStatusPagesModal,
                                                        {
                                                            statusPage: statusPage,
                                                        }
                                                    ),
                                                })
                                        }
                                    >
                                        Add External Status Pages
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <form>
                        <div
                            className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1"
                            style={{ overflow: 'hidden', overflowX: 'auto' }}
                        >
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root">
                                    <fieldset className="Box-background--white">
                                        <ExternalStatusPagesTable statusPage={statusPage}/>
                                        <ShouldRender
                                            if={
                                                statusPage.externalStatusPages.externalStatusPagesList
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
                                                        statusPage.externalStatusPages.externalStatusPagesList
                                                        .length
                                                    }{' '}
                                                    External Status Pages
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

ExternalStatusPages.displayName = 'ExternalStatusPages';

ExternalStatusPages.propTypes = {
    updateStatusPageLinks: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
    statusPage: PropTypes.object.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
    fetchExternalStatusPages: PropTypes.func.isRequired,
    initialValues: PropTypes.object,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            updateStatusPageLinks,
            updateStatusPageLinksRequest,
            updateStatusPageLinksSuccess,
            updateStatusPageLinksError,
            fetchProjectStatusPage,
            fetchExternalStatusPages,
            openModal,
            closeModal,
        },
        dispatch
    );

const mapStateToProps = state => {
    const status = state.statusPage.status || [];
    const links = [];

    status.links &&
        status.links.forEach(link => {
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

const ExternalStatusPagesForm = reduxForm({
    form: 'ExternalStatusPages', // a unique identifier for this form
    validate, // <--- validation function given to redux-for
    enableReinitialize: true,
})(ExternalStatusPages);

export default connect(mapStateToProps, mapDispatchToProps)(ExternalStatusPagesForm);
