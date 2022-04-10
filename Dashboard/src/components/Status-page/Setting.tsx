import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { reduxForm } from 'redux-form';

import { v4 as uuidv4 } from 'uuid';
// import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import IsAdminSubProject from '../basic/IsAdminSubProject';
import IsOwnerSubProject from '../basic/IsOwnerSubProject';
import { IS_LOCALHOST, IS_SAAS_SERVICE, STATUSPAGE_DOMAIN } from '../../config';
import { verifyDomain, deleteDomain } from '../../actions/domain';
import { openModal, closeModal } from 'CommonUI/actions/modal';
import VerifyDomainModal from './VerifyDomainModal';
import DeleteDomainModal from './DeleteDomainModal';
import AddMoreDomainModal from './AddMoreDomainModal';
import EditMoreDomainModal from './EditMoreDomainModal';

//Client side validation

function validate(_values: $TSFixMe) {
    const error = undefined;
    return error;
}

export class Setting extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};

    state = {
        verifyModalId: uuidv4(),
        deleteDomainModalId: uuidv4(),
        fields: [],
    };

    handleVerifyDomain = (e: $TSFixMe, {
        domain,
        domainVerificationToken
    }: $TSFixMe) => {
        e.preventDefault();

        const { verifyDomain } = this.props;

        const { projectId } = this.props.statusPage.status;
        const token = domainVerificationToken.verificationToken; // get the verification token

        const data = {
            projectId: projectId._id || projectId,
            domainId: domainVerificationToken._id,
            payload: {
                domain,
                verificationToken: token,
            },
        };

        this.props.openModal({
            id: this.state.verifyModalId,
            onConfirm: () => {
                //Todo: handle the dispatch to domain verification
                return verifyDomain(data).then(() => {

                    if (this.props.verifyError) {
                        // prevent dismissal of modal if errored

                        return this.handleVerifyDomain();
                    }


                    this.props.closeModal({
                        id: this.state.deleteDomainModalId,
                    });
                });
            },
            content: VerifyDomainModal,
            propArr: [
                {
                    domain,
                    verificationToken: token,
                    _id: domainVerificationToken._id,
                },
            ], // data to populate the modal
        });
    };

    handleDeleteDomain = (e: $TSFixMe, domain: $TSFixMe) => {
        e.preventDefault();

        const { deleteDomain } = this.props;

        const { _id, projectId } = this.props.statusPage.status;

        const data = {
            projectId: projectId._id || projectId,
            statusPageId: _id,
            domainId: domain._id,
        };

        this.props.openModal({
            id: this.state.deleteDomainModalId,
            onConfirm: () => {
                //Todo: handle the dispatch to delete domain
                return deleteDomain(data).then(() => {

                    if (this.props.deleteDomainError) {
                        // prevent dismissal of modal if errored

                        return this.handleDeleteDomain();
                    }


                    this.props.closeModal({
                        id: this.state.deleteDomainModalId,
                    });
                });
            },
            content: DeleteDomainModal,
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal({
                    id: this.state.verifyModalId,
                });
            default:
                return false;
        }
    };

    addMoreDomain = (statusPageId: $TSFixMe) => {

        const { openModal, statusPage } = this.props;
        const { projectId } = statusPage.status;

        openModal({
            id: statusPageId,
            content: AddMoreDomainModal,
            projectId: projectId._id || projectId,
            statusPageId,
        });
    };

    editDomain = (statusPageId: $TSFixMe, domain: $TSFixMe) => {

        const { openModal, statusPage } = this.props;
        const { projectId } = statusPage.status;

        openModal({
            id: statusPageId,
            content: EditMoreDomainModal,
            projectId: projectId._id || projectId,
            statusPageId,
            domain,
        });
    };

    override render() {
        let statusPageId = '';
        let statusPageSlug = '';
        let hosted = '';
        let publicStatusPageUrl = '';

        let { projectId } = this.props.statusPage.status;
        projectId = projectId ? projectId._id || projectId : null;
        if (

            this.props.statusPage &&

            this.props.statusPage.status &&

            this.props.statusPage.status._id
        ) {

            hosted = `${this.props.statusPage.status._id}.oneuptimeapp.com`;
        }
        if (

            this.props.statusPage &&

            this.props.statusPage.status &&

            this.props.statusPage.status._id
        ) {

            statusPageId = this.props.statusPage.status._id;
        }
        if (

            this.props.statusPage &&

            this.props.statusPage.status &&

            this.props.statusPage.status.slug
        ) {

            statusPageSlug = this.props.statusPage.status.slug;
        }

        if (IS_LOCALHOST) {
            publicStatusPageUrl = `http://${statusPageSlug}.localhost:3006`;
        } else {
            publicStatusPageUrl =
                window.location.origin + '/status-page/' + statusPageSlug;
        }


        const { subProjects, currentProject } = this.props;
        const currentProjectId = currentProject ? currentProject._id : null;
        let subProject =
            currentProjectId === projectId ? currentProject : false;
        if (!subProject)
            subProject = subProjects.find(
                (subProject: $TSFixMe) => subProject._id === projectId
            );

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="bs-ContentSection Card-root Card-shadow--medium"
            >
                <div className="Box-root">
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Domain and CNAME Settings
                                    </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Change the domain settings of where the
                                        status page will be hosted.
                                    </span>
                                </span>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div className="Box-root">
                                    <button
                                        id="addMoreDomain"
                                        className="bs-Button bs-Button--icon bs-Button--new"
                                        type="button"
                                        onClick={() =>
                                            this.addMoreDomain(statusPageId)
                                        }
                                    >
                                        <span>Add Domain</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <form>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <ShouldRender
                                        if={

                                            this.props.domains &&

                                            this.props.domains.length > 0
                                        }
                                    >

                                        {this.props.domains &&

                                            this.props.domains.map(
                                                (domain: $TSFixMe, index: $TSFixMe) => {
                                                    return (
                                                        <fieldset
                                                            key={domain._id}
                                                            className="bs-Fieldset"
                                                            style={{
                                                                padding: 0,
                                                            }}
                                                            name="added-domain"
                                                        >
                                                            <div className="bs-Fieldset-rows">
                                                                {IsAdminSubProject(
                                                                    subProject
                                                                ) ||
                                                                    IsOwnerSubProject(
                                                                        subProject
                                                                    ) ? (
                                                                    <div className="bs-Fieldset-row">
                                                                        <label
                                                                            className="bs-Fieldset-label"
                                                                            style={{
                                                                                paddingTop: 0,
                                                                            }}
                                                                        >
                                                                            Your
                                                                            Status
                                                                            Page
                                                                            is
                                                                            hosted
                                                                            at
                                                                        </label>

                                                                        <div className="bs-Fieldset-fields Text-fontSize--16 Text-fontWeight--medium">
                                                                            <div
                                                                                style={{
                                                                                    width:
                                                                                        '100%',
                                                                                }}
                                                                                id="domain-name"
                                                                            >
                                                                                {
                                                                                    domain.domain
                                                                                }
                                                                            </div>
                                                                            <p
                                                                                className="bs-Fieldset-explanation"
                                                                                id="publicStatusPageUrl"
                                                                            >
                                                                                {IS_LOCALHOST && (
                                                                                    <span>
                                                                                        If
                                                                                        you
                                                                                        want
                                                                                        to
                                                                                        preview
                                                                                        your
                                                                                        status
                                                                                        page.
                                                                                        Please
                                                                                        check{' '}
                                                                                        <a
                                                                                            target="_blank"
                                                                                            rel="noopener noreferrer"
                                                                                            href={
                                                                                                publicStatusPageUrl
                                                                                            }
                                                                                        >
                                                                                            {
                                                                                                publicStatusPageUrl
                                                                                            }{' '}
                                                                                        </a>
                                                                                    </span>
                                                                                )}
                                                                                {IS_SAAS_SERVICE &&
                                                                                    !IS_LOCALHOST && (
                                                                                        <span>
                                                                                            Add{' '}
                                                                                            {
                                                                                                STATUSPAGE_DOMAIN
                                                                                            }{' '}
                                                                                            to
                                                                                            your
                                                                                            CNAME.
                                                                                            If
                                                                                            you
                                                                                            want
                                                                                            to
                                                                                            preview
                                                                                            your
                                                                                            status
                                                                                            page.
                                                                                            Please
                                                                                            check{' '}
                                                                                            <a
                                                                                                target="_blank"
                                                                                                rel="noopener noreferrer"
                                                                                                href={
                                                                                                    publicStatusPageUrl
                                                                                                }
                                                                                            >
                                                                                                {
                                                                                                    publicStatusPageUrl
                                                                                                }{' '}
                                                                                            </a>
                                                                                        </span>
                                                                                    )}
                                                                                {!IS_SAAS_SERVICE &&
                                                                                    !IS_LOCALHOST && (
                                                                                        <span>
                                                                                            If
                                                                                            you
                                                                                            want
                                                                                            to
                                                                                            preview
                                                                                            your
                                                                                            status
                                                                                            page.
                                                                                            Please
                                                                                            check{' '}
                                                                                            <a
                                                                                                target="_blank"
                                                                                                rel="noopener noreferrer"
                                                                                                href={
                                                                                                    publicStatusPageUrl
                                                                                                }
                                                                                            >
                                                                                                {
                                                                                                    publicStatusPageUrl
                                                                                                }{' '}
                                                                                            </a>
                                                                                        </span>
                                                                                    )}
                                                                            </p>
                                                                            <div
                                                                                className="bs-Fieldset-row"
                                                                                style={{
                                                                                    alignItems:
                                                                                        'center',
                                                                                    paddingLeft: 0,
                                                                                    paddingBottom: 0,
                                                                                    paddingTop:
                                                                                        '5px',
                                                                                }}
                                                                            >
                                                                                <ShouldRender
                                                                                    if={
                                                                                        domain &&
                                                                                        domain.domainVerificationToken &&
                                                                                        !domain
                                                                                            .domainVerificationToken
                                                                                            .verified
                                                                                    }
                                                                                >
                                                                                    <div
                                                                                        className="bs-Fieldset-row"
                                                                                        style={{
                                                                                            padding: 0,
                                                                                            marginRight:
                                                                                                '5px',
                                                                                        }}
                                                                                    >
                                                                                        <button
                                                                                            id={`btnVerifyDomain_${index}`}
                                                                                            className="bs-Button"
                                                                                            onClick={e => {
                                                                                                this.handleVerifyDomain(
                                                                                                    e,
                                                                                                    domain
                                                                                                );
                                                                                            }}
                                                                                        >
                                                                                            <span>
                                                                                                Verify
                                                                                                domain
                                                                                            </span>
                                                                                        </button>
                                                                                    </div>
                                                                                </ShouldRender>
                                                                                <ShouldRender
                                                                                    if={
                                                                                        this
                                                                                            .props

                                                                                            .domains &&
                                                                                        this
                                                                                            .props

                                                                                            .domains
                                                                                            .length >
                                                                                        0
                                                                                    }
                                                                                >
                                                                                    <div
                                                                                        className="bs-Fieldset-row"
                                                                                        style={{
                                                                                            padding: 0,
                                                                                            marginRight: 5,
                                                                                        }}
                                                                                    >
                                                                                        <button
                                                                                            id={`editDomain_${index}`}
                                                                                            title="edit"
                                                                                            className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                                                                            type="button"
                                                                                            onClick={() =>
                                                                                                this.editDomain(
                                                                                                    statusPageId,
                                                                                                    domain
                                                                                                )
                                                                                            }
                                                                                        >
                                                                                            <span>
                                                                                                Edit
                                                                                            </span>
                                                                                        </button>
                                                                                    </div>
                                                                                </ShouldRender>
                                                                                <ShouldRender
                                                                                    if={
                                                                                        this
                                                                                            .props

                                                                                            .domains &&
                                                                                        this
                                                                                            .props

                                                                                            .domains
                                                                                            .length >
                                                                                        0
                                                                                    }
                                                                                >
                                                                                    <div
                                                                                        className="bs-Fieldset-row"
                                                                                        style={{
                                                                                            padding: 0,
                                                                                        }}
                                                                                    >
                                                                                        <button
                                                                                            id={`btnDeleteDomain_${index}`}
                                                                                            className="btnDeleteDomain bs-Button"
                                                                                            onClick={e => {
                                                                                                //Todo: handle delete here
                                                                                                this.handleDeleteDomain(
                                                                                                    e,
                                                                                                    domain
                                                                                                );
                                                                                            }}
                                                                                        >
                                                                                            <span className="bs-Button--icon bs-Button--delete"></span>
                                                                                            <span>
                                                                                                Delete
                                                                                                Domain
                                                                                            </span>
                                                                                        </button>
                                                                                    </div>
                                                                                </ShouldRender>
                                                                            </div>
                                                                        </div>
                                                                        <ShouldRender
                                                                            if={
                                                                                domain
                                                                            }
                                                                        >
                                                                            <div
                                                                                className="bs-Fieldset-fields"
                                                                                style={{
                                                                                    marginTop: 5,
                                                                                    flexDirection:
                                                                                        'row',
                                                                                }}
                                                                            >
                                                                                {domain &&
                                                                                    domain.domainVerificationToken &&
                                                                                    !domain
                                                                                        .domainVerificationToken
                                                                                        .verified ? (
                                                                                    <div
                                                                                        className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                                                        style={{
                                                                                            marginRight: 10,
                                                                                        }}
                                                                                    >
                                                                                        <span
                                                                                            className="Badge-text Text-color--red Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap pointer"
                                                                                            onClick={e => {
                                                                                                this.handleVerifyDomain(
                                                                                                    e,
                                                                                                    domain
                                                                                                );
                                                                                            }}
                                                                                        >
                                                                                            Not
                                                                                            verified
                                                                                        </span>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div
                                                                                        className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                                                        style={{
                                                                                            marginRight: 10,
                                                                                        }}
                                                                                    >
                                                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                                            Verified
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                                {domain &&
                                                                                    domain.enableHttps ? (
                                                                                    <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                                            HTTPS
                                                                                            enabled
                                                                                        </span>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                                            HTTPS
                                                                                            not
                                                                                            enabled
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </ShouldRender>
                                                                    </div>
                                                                ) : (
                                                                    <div className="bs-Fieldset-row">
                                                                        <label className="bs-Fieldset-label">
                                                                            Your
                                                                            Status
                                                                            Page
                                                                            is
                                                                            hosted
                                                                            at
                                                                        </label>
                                                                        <div className="bs-Fieldset-fields">
                                                                            <span
                                                                                className="value"
                                                                                style={{
                                                                                    marginTop:
                                                                                        '6px',
                                                                                }}
                                                                            >
                                                                                {
                                                                                    hosted
                                                                                }
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </fieldset>
                                                    );
                                                }
                                            )}
                                    </ShouldRender>
                                    <ShouldRender
                                        if={

                                            this.props.domains &&

                                            this.props.domains.length === 0 &&
                                            this.state.fields.length === 0
                                        }
                                    >
                                        <div
                                            id="domainNotSet"
                                            className="bs-Fieldset-wrapper Box-root Margin-bottom--2 Padding-all--16 Text-align--center Padding-top--20"
                                        >
                                            <span>No domains added</span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>

                            <div className="bs-Tail-copy">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <div className="Icon Icon--info Icon--size--14 Box-root Flex-flex"></div>
                                    </div>
                                    <div className="Box-root">
                                        <span>
                                            Changes to these settings will take
                                            72 hours to propagate.
                                        </span>
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


Setting.displayName = 'Setting';


Setting.propTypes = {
    statusPage: PropTypes.object.isRequired,
    currentProject: PropTypes.oneOfType([
        PropTypes.object.isRequired,
        PropTypes.oneOf([null, undefined]),
    ]),
    subProjects: PropTypes.array.isRequired,
    domains: PropTypes.array,
    openModal: PropTypes.func.isRequired,
    verifyDomain: PropTypes.func,
    closeModal: PropTypes.func,
    verifyError: PropTypes.bool,
    deleteDomain: PropTypes.func,
    deleteDomainError: PropTypes.oneOfType([
        PropTypes.oneOf([null, undefined]),
        PropTypes.string,
    ]),
};

const SettingForm = reduxForm({
    form: 'Setting', // a unique identifier for this form
    enableReinitialize: true,
    validate, // <--- validation function given to redux-for
})(Setting);

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            verifyDomain,
            deleteDomain,
            openModal,
            closeModal,
        },
        dispatch
    );
};

function mapStateToProps(state: RootState) {
    const domainsContainer =
        state.statusPage &&
            state.statusPage.status &&
            state.statusPage.status.domains
            ? state.statusPage.status.domains
            : [];

    let obj = {};
    domainsContainer.forEach((d: $TSFixMe) => {
        obj = { ...obj, [d._id]: d.domain };
    });

    return {
        statusPage: state.statusPage,
        currentProject: state.project.currentProject,
        domains:
            state.statusPage &&
                state.statusPage.status &&
                state.statusPage.status.domains
                ? state.statusPage.status.domains
                : [],
        initialValues: {
            ...obj,
        },
        subProjects: state.subProject.subProjects.subProjects,
        showDomainField: state.statusPage.addMoreDomain,
        verifyError:
            state.statusPage.verifyDomain &&
            state.statusPage.verifyDomain.error,
        deleteDomainError:
            state.statusPage.deleteDomain &&
            state.statusPage.deleteDomain.error,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(SettingForm);
