import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field } from 'redux-form';
import {
    updateStatusPageSetting,
    updateStatusPageSettingRequest,
    updateStatusPageSettingSuccess,
    updateStatusPageSettingError,
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
import { SHOULD_LOG_ANALYTICS } from '../../config';

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
    submitForm = values => {
        const { reset } = this.props;
        const { _id, projectId } = this.props.statusPage.status;
        if (_id) values._id = _id;
        this.props
            .updateStatusPageSetting(projectId._id || projectId, values)
            .then(
                () => {
                    reset();
                },
                function() {}
            );
        if (!SHOULD_LOG_ANALYTICS) {
            logEvent('StatusPage Domain Updated', values);
        }
    };

    render() {
        let statusPageId = '';
        let hosted = '';
        let statusurl = '';
        let { projectId } = this.props.statusPage.status;
        projectId = projectId ? projectId._id || projectId : null;
        if (
            this.props.statusPage &&
            this.props.statusPage.status &&
            this.props.statusPage.status.domain
        ) {
            hosted = this.props.statusPage.status.domain;
        } else if (
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
        if (window.location.href.indexOf('staging') > -1) {
            statusurl = `http://${statusPageId}.staging.fyipeapp.com`;
        } else if (window.location.href.indexOf('localhost') > -1) {
            statusurl = `http://${statusPageId}.localhost:3006`;
        } else {
            statusurl = `http://${statusPageId}.fyipeapp.com`;
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
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Domain and CNAME Settings</span>
                            </span>
                            <p>
                                <span>
                                    Change the domain settings of where the
                                    status page will be hosted.
                                </span>
                            </p>
                        </div>
                    </div>
                    <form onSubmit={handleSubmit(this.submitForm)}>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            {IsAdminSubProject(subProject) ||
                                            IsOwnerSubProject(subProject) ? (
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
                                                        <p className="bs-Fieldset-explanation">
                                                            <span>
                                                                Add
                                                                statuspage.fyipeapp.com
                                                                to your domains
                                                                CNAME. If you
                                                                want to preview
                                                                your status
                                                                page. Please
                                                                check{' '}
                                                                <a
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    href={
                                                                        statusurl
                                                                    }
                                                                >
                                                                    {statusurl}{' '}
                                                                </a>
                                                            </span>
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
    updateStatusPageSetting: PropTypes.func.isRequired,
    currentProject: PropTypes.oneOfType([
        PropTypes.object.isRequired,
        PropTypes.oneOf([null, undefined]),
    ]),
    reset: PropTypes.func.isRequired,
    subProjects: PropTypes.array.isRequired,
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
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        statusPage: state.statusPage,
        currentProject: state.project.currentProject,
        initialValues: {
            domain:
                state.statusPage &&
                state.statusPage.status &&
                state.statusPage.status.domain
                    ? state.statusPage.status.domain
                    : '',
        },
        subProjects: state.subProject.subProjects.subProjects,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(SettingForm);
