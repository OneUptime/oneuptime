import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Component } from 'react';
import { API_URL } from '../../config';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import {
    createLogoCache,
    createFaviconCache,
    resetLogoCache,
    resetFaviconCache,
    fetchProjectStatusPage,
    updateStatusPageNameRequest,
    updateStatusPageName,
} from '../../actions/statusPage';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';

import { history } from '../../store';

//Client side validation
function validate(values: $TSFixMe) {
    const errors = {};
    if (values.name) {
        if (!Validate.text(values.name)) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
            errors.name = 'Please mention name in text format .';
        }
    }

    return errors;
}

export class Branding extends Component {
    changelogo = (e: $TSFixMe) => {
        e.preventDefault();

        const reader = new FileReader();
        const file = e.target.files[0];

        reader.onloadend = () => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createLogoCache' does not exist on type ... Remove this comment to see the full error message
            this.props.createLogoCache(reader.result);
        };
        try {
            reader.readAsDataURL(file);
        } catch (error) {
            return;
        }
    };

    changefavicon = (e: $TSFixMe) => {
        e.preventDefault();

        const reader = new FileReader();
        const file = e.target.files[0];

        reader.onloadend = () => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createFaviconCache' does not exist on ty... Remove this comment to see the full error message
            this.props.createFaviconCache(reader.result);
        };
        try {
            reader.readAsDataURL(file);
        } catch (error) {
            return;
        }
    };

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        const { _id } = this.props.statusPage.status;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        let { projectId } = this.props.statusPage.status;
        projectId = projectId ? projectId._id || projectId : null;
        if (_id) values._id = _id;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reset' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { reset, resetLogoCache, resetFaviconCache } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateStatusPageName' does not exist on ... Remove this comment to see the full error message
        this.props.updateStatusPageName(projectId, values).then(
            (data: $TSFixMe) => {
                history.replace(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    `/dashboard/project/${this.props.currentProject.slug}/status-page/${data.data.slug}`
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectStatusPage' does not exist o... Remove this comment to see the full error message
                this.props.fetchProjectStatusPage(projectId, true, 0, 10);
                resetLogoCache();
                resetFaviconCache();
                reset();
            },
            function() {}
        );
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit } = this.props;
        // eslint-disable-next-line no-unused-vars
        let faviconImage = <span />;
        // eslint-disable-next-line no-unused-vars
        let logoImage = <span />;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'logourl' does not exist on type 'Readonl... Remove this comment to see the full error message
        const logoUrl = this.props.logourl
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'logourl' does not exist on type 'Readonl... Remove this comment to see the full error message
            ? this.props.logourl
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            : this.props.statusPage.status &&
              // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
              this.props.statusPage.status.logoPath
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            ? `${API_URL}/file/${this.props.statusPage.status.logoPath}`
            : '';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'faviconurl' does not exist on type 'Read... Remove this comment to see the full error message
        const faviconUrl = this.props.faviconurl
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'faviconurl' does not exist on type 'Read... Remove this comment to see the full error message
            ? this.props.faviconurl
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            : this.props.statusPage.status &&
              // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
              this.props.statusPage.status.faviconPath
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            ? `${API_URL}/file/${this.props.statusPage.status.faviconPath}`
            : '';
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            (this.props.statusPage &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.statusPage.status &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.statusPage.status.faviconPath) ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'faviconurl' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.faviconurl
        ) {
            // eslint-disable-next-line no-unused-vars
            faviconImage = (
                <img src={faviconUrl} alt="" className="image-small-circle" />
            );
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            (this.props.statusPage &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.statusPage.status &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.statusPage.status.logoPath) ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'faviconurl' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.faviconurl
        ) {
            // eslint-disable-next-line no-unused-vars
            logoImage = (
                <img src={logoUrl} alt="" className="image-small-circle" />
            );
        }
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Basic Settings</span>
                            </span>
                            <p>
                                <span>
                                    Basic Settings for your status page.
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
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Status Page Name
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        component={RenderField}
                                                        type="text"
                                                        name="name"
                                                        id="name"
                                                        placeholder="My Company Status Page"
                                                        disabled={
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                .statusPage
                                                                .pageName
                                                                .requesting
                                                        }
                                                    />
                                                    <p className="bs-Fieldset-explanation">
                                                        <span>
                                                            This is for internal
                                                            use only.
                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage">
                                <ShouldRender
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                    if={this.props.statusPage.pageName.error}
                                >
                                    <div className="bs-Tail-copy">
                                        <div
                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                            style={{ marginTop: '10px' }}
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                        this.props.statusPage
                                                            .pageName.error
                                                    }
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                            </span>

                            <div>
                                <button
                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                    disabled={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                        this.props.statusPage.pageName
                                            .requesting
                                    }
                                    type="submit"
                                >
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                    {!this.props.statusPage.pageName
                                        .requesting && <span>Save</span>}
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                    {this.props.statusPage.pageName
                                        .requesting && <FormLoader />}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Branding.displayName = 'Branding';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Branding.propTypes = {
    statusPage: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    resetLogoCache: PropTypes.func.isRequired,
    createFaviconCache: PropTypes.func.isRequired,
    currentProject: PropTypes.func.isRequired,
    resetFaviconCache: PropTypes.func.isRequired,
    updateStatusPageName: PropTypes.func.isRequired,
    createLogoCache: PropTypes.func.isRequired,
    logourl: PropTypes.string,
    reset: PropTypes.func.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
    faviconurl: PropTypes.string,
};

const BasicForm = reduxForm({
    form: 'BasicForm', // a unique identifier for this form
    enableReinitialize: true,
    validate, // <--- validation function given to redux-for
})(Branding);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            createLogoCache,
            createFaviconCache,
            resetLogoCache,
            resetFaviconCache,
            fetchProjectStatusPage,
            updateStatusPageName,
            updateStatusPageNameRequest,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    return {
        statusPage: state.statusPage,
        logourl: state.statusPage.logocache.data,
        faviconurl: state.statusPage.faviconcache.data,
        initialValues: {
            name:
                state.statusPage &&
                state.statusPage.status &&
                state.statusPage.status.name
                    ? state.statusPage.status.name
                    : '',
        },
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(BasicForm);
