import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field } from 'redux-form';
import uuid from 'uuid';
import {
    updateStatusPageSetting,
    updateStatusPageSettingRequest,
    updateStatusPageSettingSuccess,
    updateStatusPageSettingError,
    addMoreDomain,
    cancelAddMoreDomain,
} from '../../actions/statusPage';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import IsAdminSubProject from '../basic/IsAdminSubProject';
import IsOwnerSubProject from '../basic/IsOwnerSubProject';
import { logEvent } from '../../analytics';
import {
    SHOULD_LOG_ANALYTICS,
    IS_LOCALHOST,
    IS_SAAS_SERVICE,
} from '../../config';
import { verifyDomain, createDomain } from '../../actions/domain';
import { openModal, closeModal } from '../../actions/modal';
import VerifyDomainModal from './VerifyDomainModal';

//Client side validation
function validate(values) {
    const errors = {};
    if (!Validate.text(values.domain)) {
        errors.domain = 'Domain is required.';
    } else if (!Validate.isDomain(values.domain)) {
        errors.domain = 'Domain is invalid.';
    }
    return errors;
}

export class Setting extends Component {
    state = { verifyModalId: uuid.v4() };

    submitForm = values => {
        const { reset } = this.props;
        const { domain } = values;
        const { _id, projectId } = this.props.statusPage.status;

        if (!domain) return;

        const data = {
            domain,
            projectId: projectId._id || projectId,
            statusPageId: _id,
        };
        this.props.createDomain(data).then(
            () => {
                reset();
            },
            function() {}
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('StatusPage Domain Updated', values);
        }
    };

    handleVerifyDomain = (e, { domain, domainVerificationToken }) => {
        e.preventDefault();
        const { verifyDomain } = this.props;
        const { projectId } = this.props.statusPage.status;
        const thisObj = this;
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

                    if (window.location.href.indexOf('localhost') <= -1) {
                        thisObj.context.mixpanel.track('Domain verification');
                    }
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

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.verifyModalId });
            default:
                return false;
        }
    };

    render() {
        let statusPageId = '';
        let hosted = '';
        let publicStatusPageUrl = '';
        let { projectId } = this.props.statusPage.status;
        projectId = projectId ? projectId._id || projectId : null;
        if (
            this.props.statusPage &&
            this.props.statusPage.status &&
            this.props.statusPage.status._id
        ) {
            hosted = `${this.props.statusPage.status._id}.fyipeapp.com`;
        }
        if (
            this.props.statusPage &&
            this.props.statusPage.status &&
            this.props.statusPage.status._id
        ) {
            statusPageId = this.props.statusPage.status._id;
        }

        if (IS_LOCALHOST) {
            publicStatusPageUrl = `http://${statusPageId}.localhost:3006`;
        } else {
            publicStatusPageUrl =
                window.location.origin + '/status-page/' + statusPageId;
        }

        const { handleSubmit, subProjects, currentProject } = this.props;
        const currentProjectId = currentProject ? currentProject._id : null;
        let subProject =
            currentProjectId === projectId ? currentProject : false;
        if (!subProject)
            subProject = subProjects.find(
                subProject => subProject._id === projectId
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
                                <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span
                                        style={{ textTransform: 'capitalize' }}
                                    >
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
                                        className="Button bs-ButtonLegacy ActionIconParent"
                                        type="button"
                                        onClick={this.props.addMoreDomain}
                                    >
                                        <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                            <div className="Box-root Margin-right--8">
                                                <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                            </div>
                                            <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                <span>Add Domain(s)</span>
                                            </span>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <form onSubmit={handleSubmit(this.submitForm)}>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    {this.props.domains &&
                                        this.props.domains.map(domain => {
                                            return (
                                                <fieldset
                                                    key={domain._id}
                                                    className="bs-Fieldset"
                                                    style={{ padding: 0 }}
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
                                                                <label className="bs-Fieldset-label">
                                                                    Your Status
                                                                    Page is
                                                                    hosted at
                                                                </label>

                                                                <div className="bs-Fieldset-fields">
                                                                    <Field
                                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                        component={
                                                                            RenderField
                                                                        }
                                                                        type="text"
                                                                        name={
                                                                            domain._id
                                                                        }
                                                                        id={
                                                                            domain._id
                                                                        }
                                                                        disabled={
                                                                            this
                                                                                .props
                                                                                .statusPage
                                                                                .setting
                                                                                .requesting
                                                                        }
                                                                        placeholder="domain"
                                                                    />
                                                                    <p className="bs-Fieldset-explanation">
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
                                                                                    Add
                                                                                    statuspage.fyipeapp.com
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
                                                                    <ShouldRender
                                                                        if={
                                                                            !domain
                                                                                .domainVerificationToken
                                                                                .verified
                                                                        }
                                                                    >
                                                                        <div
                                                                            className="bs-Fieldset-row"
                                                                            style={{
                                                                                marginBottom: -5,
                                                                                marginTop: -5,
                                                                                paddingLeft: 0,
                                                                                paddingRight: 0,
                                                                            }}
                                                                        >
                                                                            <button
                                                                                id="btnVerifyDomain"
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
                                                                </div>
                                                                <ShouldRender
                                                                    if={domain}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-fields"
                                                                        style={{
                                                                            marginTop: 5,
                                                                        }}
                                                                    >
                                                                        {!domain
                                                                            .domainVerificationToken
                                                                            .verified ? (
                                                                            <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                                    Not
                                                                                    verified
                                                                                </span>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="Badge Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--14 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                                    Verified
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </ShouldRender>
                                                            </div>
                                                        ) : (
                                                            <div className="bs-Fieldset-row">
                                                                <label className="bs-Fieldset-label">
                                                                    Your Status
                                                                    Page is
                                                                    hosted at
                                                                </label>
                                                                <div className="bs-Fieldset-fields">
                                                                    <span
                                                                        className="value"
                                                                        style={{
                                                                            marginTop:
                                                                                '6px',
                                                                        }}
                                                                    >
                                                                        {hosted}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </fieldset>
                                            );
                                        })}

                                    {(this.props.domains.length < 1 ||
                                        this.props.showDomainField) && (
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                {IsAdminSubProject(
                                                    subProject
                                                ) ||
                                                IsOwnerSubProject(
                                                    subProject
                                                ) ? (
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            {' '}
                                                            Your Status Page is
                                                            hosted at{' '}
                                                        </label>

                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="text"
                                                                name="domain"
                                                                id="domain"
                                                                disabled={
                                                                    this.props
                                                                        .statusPage
                                                                        .setting
                                                                        .requesting
                                                                }
                                                                placeholder="domain"
                                                            />
                                                            <ShouldRender
                                                                if={
                                                                    !this.props
                                                                        .addDomain
                                                                        .requesting &&
                                                                    this.props
                                                                        .addDomain
                                                                        .error
                                                                }
                                                            >
                                                                <div
                                                                    id="verifyDomainError"
                                                                    className="bs-Tail-copy"
                                                                >
                                                                    <div
                                                                        className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                                        style={{
                                                                            marginTop:
                                                                                '10px',
                                                                        }}
                                                                    >
                                                                        <div className="Box-root Margin-right--8">
                                                                            <div
                                                                                className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"
                                                                                style={{
                                                                                    marginTop:
                                                                                        '2px',
                                                                                }}
                                                                            ></div>
                                                                        </div>
                                                                        <div className="Box-root">
                                                                            <span
                                                                                style={{
                                                                                    color:
                                                                                        'red',
                                                                                }}
                                                                            >
                                                                                {
                                                                                    this
                                                                                        .props
                                                                                        .addDomain
                                                                                        .error
                                                                                }
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </ShouldRender>
                                                            <p className="bs-Fieldset-explanation">
                                                                {IS_LOCALHOST && (
                                                                    <span>
                                                                        If you
                                                                        want to
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
                                                                            Add
                                                                            statuspage.fyipeapp.com
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
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Your Status Page is
                                                            hosted at{' '}
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <span
                                                                className="value"
                                                                style={{
                                                                    marginTop:
                                                                        '6px',
                                                                }}
                                                            >
                                                                {hosted}
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </fieldset>
                                    )}
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
                                        <ShouldRender
                                            if={
                                                this.props.statusPage.setting
                                                    .error
                                            }
                                        >
                                            <span style={{ color: 'red' }}>
                                                {
                                                    this.props.statusPage
                                                        .setting.error
                                                }
                                            </span>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                !this.props.statusPage.setting
                                                    .error
                                            }
                                        >
                                            <span>
                                                Changes to these settings will
                                                take 72 hours to propogate.
                                            </span>
                                        </ShouldRender>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <RenderIfSubProjectAdmin
                                    subProjectId={projectId}
                                >
                                    <ShouldRender
                                        if={
                                            this.props.showDomainField ||
                                            this.props.domains.length < 1
                                                ? true
                                                : false
                                        }
                                    >
                                        <button
                                            id="btnCancelAddDomain"
                                            className="bs-Button bs-DeprecatedButton"
                                            disabled={
                                                this.props.statusPage.setting
                                                    .requesting
                                            }
                                            onClick={e => {
                                                e.preventDefault();
                                                this.props.cancelAddMoreDomain();
                                            }}
                                        >
                                            {!this.props.statusPage.setting
                                                .requesting && (
                                                <span>Cancel</span>
                                            )}
                                            {this.props.statusPage.setting
                                                .requesting && <FormLoader />}
                                        </button>
                                    </ShouldRender>

                                    <button
                                        id="btnAddDomain"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={
                                            this.props.statusPage.setting
                                                .requesting
                                        }
                                        type="submit"
                                    >
                                        {!this.props.statusPage.setting
                                            .requesting && (
                                            <span>Save Domain Settings </span>
                                        )}
                                        {this.props.statusPage.setting
                                            .requesting && <FormLoader />}
                                    </button>
                                </RenderIfSubProjectAdmin>
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
    handleSubmit: PropTypes.func.isRequired,
    statusPage: PropTypes.object.isRequired,
    currentProject: PropTypes.oneOfType([
        PropTypes.object.isRequired,
        PropTypes.oneOf([null, undefined]),
    ]),
    reset: PropTypes.func.isRequired,
    subProjects: PropTypes.array.isRequired,
    addMoreDomain: PropTypes.func,
    cancelAddMoreDomain: PropTypes.func,
    domains: PropTypes.array,
    showDomainField: PropTypes.bool,
    openModal: PropTypes.func.isRequired,
    createDomain: PropTypes.func,
    verifyDomain: PropTypes.func,
    closeModal: PropTypes.func,
    verifyError: PropTypes.bool,
    addDomain: PropTypes.object,
};

const SettingForm = reduxForm({
    form: 'Setting', // a unique identifier for this form
    enableReinitialize: true,
    validate, // <--- validation function given to redux-for
})(Setting);

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            updateStatusPageSetting,
            updateStatusPageSettingRequest,
            updateStatusPageSettingSuccess,
            updateStatusPageSettingError,
            addMoreDomain,
            cancelAddMoreDomain,
            verifyDomain,
            createDomain,
            openModal,
            closeModal,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    const domainsContainer =
        state.statusPage &&
        state.statusPage.status &&
        state.statusPage.status.domains
            ? state.statusPage.status.domains
            : [];

    let obj = {};
    domainsContainer.forEach(d => {
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
        addDomain: state.statusPage.addDomain,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(SettingForm);
