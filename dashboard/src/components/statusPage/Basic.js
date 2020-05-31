import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Component } from 'react';
import { API_URL } from '../../config';
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
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

//Client side validation
function validate(values) {
    const errors = {};
    if (values.name) {
        if (!Validate.text(values.name)) {
            errors.name = 'Please mention name in text format .';
        }
    }

    return errors;
}

export class Branding extends Component {
    changelogo = e => {
        e.preventDefault();

        const reader = new FileReader();
        const file = e.target.files[0];

        reader.onloadend = () => {
            this.props.createLogoCache(reader.result);
        };
        try {
            reader.readAsDataURL(file);
        } catch (error) {
            return;
        }
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > STATUS PAGES > STATUS PAGE > LOGO UPDATED'
            );
        }
    };

    changefavicon = e => {
        e.preventDefault();

        const reader = new FileReader();
        const file = e.target.files[0];

        reader.onloadend = () => {
            this.props.createFaviconCache(reader.result);
        };
        try {
            reader.readAsDataURL(file);
        } catch (error) {
            return;
        }
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > STATUS PAGES > STATUS PAGE > FAVICON UPDATED'
            );
        }
    };

    submitForm = values => {
        const { _id } = this.props.statusPage.status;
        let { projectId } = this.props.statusPage.status;
        projectId = projectId ? projectId._id || projectId : null;
        if (_id) values._id = _id;
        const { reset, resetLogoCache, resetFaviconCache } = this.props;
        this.props.updateStatusPageName(projectId, values).then(
            () => {
                this.props.fetchProjectStatusPage(projectId, true, 0, 10);
                resetLogoCache();
                resetFaviconCache();
                reset();
            },
            function() {}
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > STATUS PAGES > STATUS PAGE > BRANDING UPDATED'
            );
        }
    };

    render() {
        const { handleSubmit } = this.props;
        // eslint-disable-next-line no-unused-vars
        let faviconImage = <span />;
        // eslint-disable-next-line no-unused-vars
        let logoImage = <span />;
        const logoUrl = this.props.logourl
            ? this.props.logourl
            : this.props.statusPage.status &&
              this.props.statusPage.status.logoPath
            ? `${API_URL}/file/${this.props.statusPage.status.logoPath}`
            : '';
        const faviconUrl = this.props.faviconurl
            ? this.props.faviconurl
            : this.props.statusPage.status &&
              this.props.statusPage.status.faviconPath
            ? `${API_URL}/file/${this.props.statusPage.status.faviconPath}`
            : '';
        if (
            (this.props.statusPage &&
                this.props.statusPage.status &&
                this.props.statusPage.status.faviconPath) ||
            this.props.faviconurl
        ) {
            faviconImage = (
                <img src={faviconUrl} alt="" className="image-small-circle" />
            );
        }
        if (
            (this.props.statusPage &&
                this.props.statusPage.status &&
                this.props.statusPage.status.logoPath) ||
            this.props.faviconurl
        ) {
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
                                        this.props.statusPage.pageName
                                            .requesting
                                    }
                                    type="submit"
                                >
                                    {!this.props.statusPage.pageName
                                        .requesting && <span>Save</span>}
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

Branding.displayName = 'Branding';

Branding.propTypes = {
    statusPage: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    resetLogoCache: PropTypes.func.isRequired,
    createFaviconCache: PropTypes.func.isRequired,
    resetFaviconCache: PropTypes.func.isRequired,
    updateStatusPageName: PropTypes.func.isRequired,
    createLogoCache: PropTypes.func.isRequired,
    logourl: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    faviconurl: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    reset: PropTypes.func.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
};

const BasicForm = reduxForm({
    form: 'BasicForm', // a unique identifier for this form
    enableReinitialize: true,
    validate, // <--- validation function given to redux-for
})(Branding);

const mapDispatchToProps = dispatch => {
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

function mapStateToProps(state) {
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
