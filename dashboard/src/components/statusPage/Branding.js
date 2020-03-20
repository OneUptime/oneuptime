import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Component } from 'react';
import { API_URL } from '../../config';
import { reduxForm, Field } from 'redux-form';
import {
    updateStatusPageBranding,
    updateStatusPageBrandingRequest,
    updateStatusPageBrandingSuccess,
    updateStatusPageBrandingError,
    createLogoCache,
    createFaviconCache,
    resetLogoCache,
    resetFaviconCache,
    fetchProjectStatusPage,
    createBannerCache,
    resetBannerCache,
    setStatusPageColors,
} from '../../actions/statusPage';
import { RenderField } from '../basic/RenderField';
import { RenderTextArea } from '../basic/RenderTextArea';
import { UploadFile } from '../basic/UploadFile';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import Colors from './Colors';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

//Client side validation
function validate(values) {
    const errors = {};
    if (values.title) {
        if (!Validate.text(values.title)) {
            errors.title = 'Please mention title in text format .';
        }
    }
    if (values.description) {
        if (!Validate.text(values.description)) {
            errors.description = 'Please mention description in text format .';
        }
    }
    if (values.copyright) {
        if (!Validate.text(values.copyright)) {
            errors.copyright = 'Please mention copyright in text format .';
        }
    }

    return errors;
}

export class Branding extends Component {
    state = {
        displayColorPicker: false,
        currentColorPicker: '',
    };

    handleClick = e => {
        this.setState({
            displayColorPicker: !this.state.displayColorPicker,
            currentColorPicker: e.currentTarget.id,
        });
    };

    handleClose = () => {
        this.setState({ displayColorPicker: false, currentColorPicker: '' });
    };

    handleChange = color => {
        const { currentColorPicker } = this.state;
        let newColors = this.props.colors;
        newColors = { ...newColors, [currentColorPicker]: color.rgb };
        this.props.setStatusPageColors(newColors);
    };

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
        if (!SHOULD_LOG_ANALYTICS) {
            logEvent('New Logo Selected');
        }
    };

    updloadBannerHandler = e => {
        e.preventDefault();
        const reader = new FileReader();
        const file = e.target.files[0];

        reader.onloadend = () => {
            this.props.createBannerCache(reader.result);
        };
        try {
            reader.readAsDataURL(file);
        } catch (error) {
            return;
        }

        if (!SHOULD_LOG_ANALYTICS) logEvent('New Banner Selected');
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
        if (!SHOULD_LOG_ANALYTICS) {
            logEvent('New Favicon Selected');
        }
    };

    removeImageHandler = e => {
        const values = {};
        const { _id } = this.props.statusPage.status;
        let { projectId } = this.props.statusPage.status;
        projectId = projectId ? projectId._id || projectId : null;
        if (_id) values._id = _id;
        const {
            reset,
            resetLogoCache,
            resetFaviconCache,
            resetBannerCache,
        } = this.props;
        if (e.currentTarget.id === 'removeFavicon') {
            values.favicon = '';
        }
        if (e.currentTarget.id === 'removeBanner') {
            values.banner = '';
        }
        if (e.currentTarget.id === 'removeLogo') {
            values.logo = '';
        }
        this.props.updateStatusPageBranding(projectId, values).then(
            () => {
                this.props.fetchProjectStatusPage(projectId, true, 0, 10);
                resetLogoCache();
                resetFaviconCache();
                resetBannerCache();
                reset();
            },
            function() {}
        );
        if (!SHOULD_LOG_ANALYTICS)
            logEvent('Updating status page Branding', values);
    };

    submitForm = values => {
        const { _id } = this.props.statusPage.status;
        let { projectId } = this.props.statusPage.status;
        projectId = projectId ? projectId._id || projectId : null;
        if (_id) values._id = _id;
        const {
            reset,
            resetLogoCache,
            resetFaviconCache,
            resetBannerCache,
            colors,
        } = this.props;
        values.colors = colors;
        this.props.updateStatusPageBranding(projectId, values).then(
            () => {
                this.props.fetchProjectStatusPage(projectId, true, 0, 10);
                resetLogoCache();
                resetFaviconCache();
                resetBannerCache();
                reset();
            },
            function() {}
        );
        if (!SHOULD_LOG_ANALYTICS) {
            logEvent('Changed Logo, Style, Branding', values);
        }
    };

    render() {
        const { handleSubmit } = this.props;
        let faviconImage = <span />;
        let logoImage = <span />;
        let bannerImage = <span />;
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
        const bannerUrl = this.props.bannerurl
            ? this.props.bannerurl
            : this.props.statusPage.status &&
              this.props.statusPage.status.bannerPath
            ? `${API_URL}/file/${this.props.statusPage.status.bannerPath}`
            : '';
        const colors =
            this.props.colors && Object.keys(this.props.colors).length > 0
                ? this.props.colors
                : null;
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
            this.props.logourl
        ) {
            logoImage = (
                <img src={logoUrl} alt="" className="image-small-circle" />
            );
        }
        if (
            (this.props.statusPage &&
                this.props.statusPage.status &&
                this.props.statusPage.status.bannerPath) ||
            this.props.bannerurl
        ) {
            bannerImage = (
                <img
                    src={bannerUrl}
                    alt=""
                    style={{ maxWidth: '74px', maxHeight: '60px' }}
                />
            );
        }
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Branding</span>
                            </span>
                            <p>
                                <span>
                                    Change the logo, style, and branding of your
                                    status page.
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
                                                    Page Title
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        component={RenderField}
                                                        type="text"
                                                        name="title"
                                                        id="title"
                                                        placeholder="MyCompany Status Page"
                                                        disabled={
                                                            this.props
                                                                .statusPage
                                                                .branding
                                                                .requesting
                                                        }
                                                    />
                                                    <p className="bs-Fieldset-explanation">
                                                        <span>
                                                            This is used for
                                                            SEO.
                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Page Description
                                                </label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <Field
                                                        className="bs-TextArea"
                                                        component={
                                                            RenderTextArea
                                                        }
                                                        type="text"
                                                        name="description"
                                                        rows="5"
                                                        id="account_app_product_description"
                                                        placeholder="A short description of the page. This is used for SEO."
                                                        disabled={
                                                            this.props
                                                                .statusPage
                                                                .branding
                                                                .requesting
                                                        }
                                                        style={{
                                                            width: '250px',
                                                            resize: 'none',
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Favicon
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <div className="Box-root Flex-flex Flex-alignItems--center">
                                                        <div>
                                                            <label
                                                                className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                type="button"
                                                            >
                                                                <ShouldRender
                                                                    if={
                                                                        !this
                                                                            .props
                                                                            .statusPage
                                                                            .status
                                                                            .faviconPath
                                                                    }
                                                                >
                                                                    <span className="bs-Button--icon bs-Button--new"></span>
                                                                    <span>
                                                                        Upload
                                                                        favicon
                                                                    </span>
                                                                </ShouldRender>
                                                                <ShouldRender
                                                                    if={
                                                                        this
                                                                            .props
                                                                            .statusPage
                                                                            .status
                                                                            .faviconPath
                                                                    }
                                                                >
                                                                    <span className="bs-Button--icon bs-Button--edit"></span>
                                                                    <span>
                                                                        Change
                                                                        favicon
                                                                    </span>
                                                                </ShouldRender>
                                                                <div className="bs-FileUploadButton-inputWrap">
                                                                    <Field
                                                                        className="bs-FileUploadButton-input"
                                                                        component={
                                                                            UploadFile
                                                                        }
                                                                        name="favicon"
                                                                        id="favicon"
                                                                        onChange={
                                                                            this
                                                                                .changefavicon
                                                                        }
                                                                        accept="image/jpeg, image/jpg, image/png"
                                                                    />
                                                                </div>
                                                            </label>
                                                            <ShouldRender
                                                                if={
                                                                    this.props
                                                                        .statusPage
                                                                        .status
                                                                        .faviconPath
                                                                }
                                                            >
                                                                <label
                                                                    className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                    name="favicon"
                                                                    id="removeFavicon"
                                                                    onClick={
                                                                        this
                                                                            .removeImageHandler
                                                                    }
                                                                    type="button"
                                                                >
                                                                    <span className="bs-Button--icon bs-Button--delete"></span>
                                                                    <span>
                                                                        Remove
                                                                        Favicon
                                                                    </span>
                                                                </label>
                                                            </ShouldRender>
                                                        </div>
                                                    </div>
                                                    <p className="bs-Fieldset-explanation">
                                                        <span>
                                                            Upload 64x64
                                                            favicon.
                                                        </span>
                                                    </p>
                                                    <ShouldRender
                                                        if={
                                                            this.props
                                                                .statusPage
                                                                .status
                                                                .faviconPath ||
                                                            this.props
                                                                .faviconurl
                                                        }
                                                    >
                                                        {faviconImage}
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Logo
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <div className="Box-root Flex-flex Flex-alignItems--center">
                                                        <div>
                                                            <label
                                                                className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                type="button"
                                                            >
                                                                <ShouldRender
                                                                    if={
                                                                        !this
                                                                            .props
                                                                            .statusPage
                                                                            .status
                                                                            .logoPath
                                                                    }
                                                                >
                                                                    <span className="bs-Button--icon bs-Button--new"></span>
                                                                    <span>
                                                                        Upload
                                                                        Logo
                                                                    </span>
                                                                </ShouldRender>
                                                                <ShouldRender
                                                                    if={
                                                                        this
                                                                            .props
                                                                            .statusPage
                                                                            .status
                                                                            .logoPath
                                                                    }
                                                                >
                                                                    <span className="bs-Button--icon bs-Button--edit"></span>
                                                                    <span>
                                                                        Change
                                                                        Logo
                                                                    </span>
                                                                </ShouldRender>
                                                                <div className="bs-FileUploadButton-inputWrap">
                                                                    <Field
                                                                        className="bs-FileUploadButton-input"
                                                                        component={
                                                                            UploadFile
                                                                        }
                                                                        name="logo"
                                                                        id="logo"
                                                                        onChange={
                                                                            this
                                                                                .changelogo
                                                                        }
                                                                        accept="image/jpeg, image/jpg, image/png"
                                                                    />
                                                                </div>
                                                            </label>
                                                            <ShouldRender
                                                                if={
                                                                    this.props
                                                                        .statusPage
                                                                        .status
                                                                        .logoPath
                                                                }
                                                            >
                                                                <label
                                                                    className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                    name="logo"
                                                                    id="removeLogo"
                                                                    onClick={
                                                                        this
                                                                            .removeImageHandler
                                                                    }
                                                                    type="button"
                                                                >
                                                                    <span className="bs-Button--icon bs-Button--delete"></span>
                                                                    <span>
                                                                        Remove
                                                                        Logo
                                                                    </span>
                                                                </label>
                                                            </ShouldRender>
                                                        </div>
                                                    </div>
                                                    <p className="bs-Fieldset-explanation">
                                                        <span>
                                                            Upload a square
                                                            400x400 logo.
                                                        </span>
                                                    </p>
                                                    <ShouldRender
                                                        if={
                                                            this.props
                                                                .statusPage
                                                                .status
                                                                .logoPath ||
                                                            this.props.logourl
                                                        }
                                                    >
                                                        {logoImage}
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Banner
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <div className="Box-root Flex-flex Flex-alignItems--center">
                                                        <div>
                                                            <label
                                                                className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                type="button"
                                                            >
                                                                <ShouldRender
                                                                    if={
                                                                        !this
                                                                            .props
                                                                            .statusPage
                                                                            .status
                                                                            .bannerPath
                                                                    }
                                                                >
                                                                    <span className="bs-Button--icon bs-Button--new"></span>
                                                                    <span>
                                                                        Upload
                                                                        Banner
                                                                    </span>
                                                                </ShouldRender>
                                                                <ShouldRender
                                                                    if={
                                                                        this
                                                                            .props
                                                                            .statusPage
                                                                            .status
                                                                            .bannerPath
                                                                    }
                                                                >
                                                                    <span className="bs-Button--icon bs-Button--edit"></span>
                                                                    <span>
                                                                        Change
                                                                        Banner
                                                                    </span>
                                                                </ShouldRender>
                                                                <div className="bs-FileUploadButton-inputWrap">
                                                                    <Field
                                                                        className="bs-FileUploadButton-input"
                                                                        component={
                                                                            UploadFile
                                                                        }
                                                                        name="banner"
                                                                        id="banner"
                                                                        onChange={
                                                                            this
                                                                                .updloadBannerHandler
                                                                        }
                                                                        accept="image/jpeg, image/jpg, image/png"
                                                                    />
                                                                </div>
                                                            </label>
                                                            <ShouldRender
                                                                if={
                                                                    this.props
                                                                        .statusPage
                                                                        .status
                                                                        .bannerPath
                                                                }
                                                            >
                                                                <label
                                                                    className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                    type="button"
                                                                    name="banner"
                                                                    id="removeBanner"
                                                                    onClick={
                                                                        this
                                                                            .removeImageHandler
                                                                    }
                                                                >
                                                                    <span className="bs-Button--icon bs-Button--delete"></span>
                                                                    <span>
                                                                        Remove
                                                                        Banner
                                                                    </span>
                                                                </label>
                                                            </ShouldRender>
                                                        </div>
                                                    </div>
                                                    <p className="bs-Fieldset-explanation">
                                                        <span>
                                                            Upload an image of
                                                            at least 1900*700
                                                        </span>
                                                    </p>
                                                    <ShouldRender
                                                        if={
                                                            this.props
                                                                .statusPage
                                                                .status
                                                                .bannerPath ||
                                                            this.props.bannerurl
                                                        }
                                                    >
                                                        {bannerImage}
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                            {colors && (
                                                <Colors
                                                    colors={colors}
                                                    currentColorPicker={
                                                        this.state
                                                            .currentColorPicker
                                                    }
                                                    displayColorPicker={
                                                        this.state
                                                            .displayColorPicker
                                                    }
                                                    handleClick={
                                                        this.handleClick
                                                    }
                                                    handleChange={
                                                        this.handleChange
                                                    }
                                                    handleClose={
                                                        this.handleClose
                                                    }
                                                />
                                            )}
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Copyright
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        component={RenderField}
                                                        type="text"
                                                        name="copyright"
                                                        id="copyright"
                                                        placeholder={
                                                            this.props
                                                                .copyright ||
                                                            '© MyCompany, Inc.'
                                                        }
                                                        disabled={
                                                            this.props
                                                                .statusPage
                                                                .branding
                                                                .requesting
                                                        }
                                                    />
                                                    <p className="bs-Fieldset-explanation">
                                                        <span>
                                                            This is shown on the
                                                            bottom of your
                                                            status page.
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
                                    if={this.props.statusPage.branding.error}
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
                                                            .branding.error
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
                                        this.props.statusPage.branding
                                            .requesting
                                    }
                                    type="submit"
                                >
                                    {!this.props.statusPage.branding
                                        .requesting && <span>Save</span>}
                                    {this.props.statusPage.branding
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
    createBannerCache: PropTypes.func.isRequired,
    resetBannerCache: PropTypes.func.isRequired,
    setStatusPageColors: PropTypes.func.isRequired,
    updateStatusPageBranding: PropTypes.func.isRequired,
    createLogoCache: PropTypes.func.isRequired,
    logourl: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    faviconurl: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    bannerurl: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    colors: PropTypes.object,
    reset: PropTypes.func.isRequired,
    copyright: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    fetchProjectStatusPage: PropTypes.func.isRequired,
};

const BrandingForm = reduxForm({
    form: 'Branding', // a unique identifier for this form
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
            updateStatusPageBranding,
            updateStatusPageBrandingRequest,
            createBannerCache,
            resetBannerCache,
            setStatusPageColors,
            updateStatusPageBrandingSuccess,
            updateStatusPageBrandingError,
            fetchProjectStatusPage,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        statusPage: state.statusPage,
        logourl: state.statusPage.logocache.data,
        faviconurl: state.statusPage.faviconcache.data,
        bannerurl: state.statusPage.bannercache.data,
        colors: state.statusPage.colors,
        initialValues: {
            title:
                state.statusPage &&
                state.statusPage.status &&
                state.statusPage.status.title
                    ? state.statusPage.status.title
                    : '',
            description:
                state.statusPage &&
                state.statusPage.status &&
                state.statusPage.status.description
                    ? state.statusPage.status.description
                    : '',
            copyright:
                state.statusPage &&
                state.statusPage.status &&
                state.statusPage.status.copyright
                    ? state.statusPage.status.copyright
                    : '',
        },
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(BrandingForm);
