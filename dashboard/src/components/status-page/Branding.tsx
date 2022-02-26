import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Component } from 'react';
import { API_URL } from '../../config';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
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

import ConfirmResetBrandColors from '../modals/ConfirmResetBrandColors';
import { openModal } from '../../actions/modal';
import DataPathHoC from '../DataPathHoC';

//Client side validation
function validate(values: $TSFixMe) {
    const errors = {};
    if (values.title) {
        if (!Validate.text(values.title)) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type '{}'.
            errors.title = 'Please mention title in text format .';
        }
    }
    if (values.description) {
        if (!Validate.text(values.description)) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'description' does not exist on type '{}'... Remove this comment to see the full error message
            errors.description = 'Please mention description in text format .';
        }
    }
    if (values.copyright) {
        if (!Validate.text(values.copyright)) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'copyright' does not exist on type '{}'.
            errors.copyright = 'Please mention copyright in text format .';
        }
    }

    return errors;
}

export class Branding extends Component {
    state = {
        displayColorPicker: false,
        currentColorPicker: '',
        confirmResetModalId: uuidv4(),
    };

    handleClick = (e: $TSFixMe) => {
        this.setState({
            displayColorPicker: !this.state.displayColorPicker,
            currentColorPicker: e.currentTarget.id,
        });
    };

    handleClose = () => {
        this.setState({ displayColorPicker: false, currentColorPicker: '' });
    };

    handleChange = (color: $TSFixMe) => {
        const { currentColorPicker } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'colors' does not exist on type 'Readonly... Remove this comment to see the full error message
        let newColors = this.props.colors;
        newColors = { ...newColors, [currentColorPicker]: color.rgb };
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setStatusPageColors' does not exist on t... Remove this comment to see the full error message
        this.props.setStatusPageColors(newColors);
    };

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

    updloadBannerHandler = (e: $TSFixMe) => {
        e.preventDefault();
        const reader = new FileReader();
        const file = e.target.files[0];

        reader.onloadend = () => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createBannerCache' does not exist on typ... Remove this comment to see the full error message
            this.props.createBannerCache(reader.result);
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
    removeImageHandler = (e: $TSFixMe) => {
        const values = {};
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        const { _id } = this.props.statusPage.status;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        let { projectId } = this.props.statusPage.status;
        projectId = projectId ? projectId._id || projectId : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
        if (_id) values._id = _id;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'reset' does not exist on type 'Readonly<... Remove this comment to see the full error message
            reset,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetLogoCache' does not exist on type '... Remove this comment to see the full error message
            resetLogoCache,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetFaviconCache' does not exist on typ... Remove this comment to see the full error message
            resetFaviconCache,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetBannerCache' does not exist on type... Remove this comment to see the full error message
            resetBannerCache,
        } = this.props;
        if (e.currentTarget.id === 'removeFavicon') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'favicon' does not exist on type '{}'.
            values.favicon = '';
        }
        if (e.currentTarget.id === 'removeBanner') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'banner' does not exist on type '{}'.
            values.banner = '';
        }
        if (e.currentTarget.id === 'removeLogo') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'logo' does not exist on type '{}'.
            values.logo = '';
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateStatusPageBranding' does not exist... Remove this comment to see the full error message
        this.props.updateStatusPageBranding(projectId, values).then(
            () => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectStatusPage' does not exist o... Remove this comment to see the full error message
                this.props.fetchProjectStatusPage(projectId, true, 0, 10);
                resetLogoCache();
                resetFaviconCache();
                resetBannerCache();
                reset();
            },
            function() {}
        );
    };

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        const { _id } = this.props.statusPage.status;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        let { projectId } = this.props.statusPage.status;
        projectId = projectId ? projectId._id || projectId : null;
        if (_id) values._id = _id;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'reset' does not exist on type 'Readonly<... Remove this comment to see the full error message
            reset,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetLogoCache' does not exist on type '... Remove this comment to see the full error message
            resetLogoCache,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetFaviconCache' does not exist on typ... Remove this comment to see the full error message
            resetFaviconCache,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetBannerCache' does not exist on type... Remove this comment to see the full error message
            resetBannerCache,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'colors' does not exist on type 'Readonly... Remove this comment to see the full error message
            colors,
        } = this.props;
        values.colors = colors;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateStatusPageBranding' does not exist... Remove this comment to see the full error message
        this.props.updateStatusPageBranding(projectId, values).then(
            () => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectStatusPage' does not exist o... Remove this comment to see the full error message
                this.props.fetchProjectStatusPage(projectId, true, 0, 10);
                resetLogoCache();
                resetFaviconCache();
                resetBannerCache();
                reset();
            },
            function() {}
        );
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('saveBranding').click();
            default:
                return false;
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit } = this.props;
        let faviconImage = <span />;
        let logoImage = <span />;
        let bannerImage = <span />;
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'bannerurl' does not exist on type 'Reado... Remove this comment to see the full error message
        const bannerUrl = this.props.bannerurl
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'bannerurl' does not exist on type 'Reado... Remove this comment to see the full error message
            ? this.props.bannerurl
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            : this.props.statusPage.status &&
              // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
              this.props.statusPage.status.bannerPath
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            ? `${API_URL}/file/${this.props.statusPage.status.bannerPath}`
            : '';
        const colors =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'colors' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.colors && Object.keys(this.props.colors).length > 0
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'colors' does not exist on type 'Readonly... Remove this comment to see the full error message
                ? this.props.colors
                : null;
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'logourl' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.logourl
        ) {
            logoImage = (
                <img src={logoUrl} alt="" className="image-small-circle" />
            );
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            (this.props.statusPage &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.statusPage.status &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.statusPage.status.bannerPath) ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'bannerurl' does not exist on type 'Reado... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        const { _id } = this.props.statusPage.status;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        let { projectId } = this.props.statusPage.status;
        projectId = projectId ? projectId._id || projectId : null;
        return (
            <div
                className="bs-ContentSection Card-root Card-shadow--medium"
                onKeyDown={this.handleKeyBoard}
            >
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
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element[]; className: string; ty... Remove this comment to see the full error message
                                                                type="button"
                                                            >
                                                                <ShouldRender
                                                                    if={
                                                                        !this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                        .statusPage
                                                                        .status
                                                                        .faviconPath
                                                                }
                                                            >
                                                                <label
                                                                    className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element[]; className: string; na... Remove this comment to see the full error message
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
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                .statusPage
                                                                .status
                                                                .faviconPath ||
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'faviconurl' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element[]; className: string; ty... Remove this comment to see the full error message
                                                                type="button"
                                                            >
                                                                <ShouldRender
                                                                    if={
                                                                        !this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                        .statusPage
                                                                        .status
                                                                        .logoPath
                                                                }
                                                            >
                                                                <label
                                                                    className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element[]; className: string; na... Remove this comment to see the full error message
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
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                .statusPage
                                                                .status
                                                                .logoPath ||
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'logourl' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element[]; className: string; ty... Remove this comment to see the full error message
                                                                type="button"
                                                            >
                                                                <ShouldRender
                                                                    if={
                                                                        !this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                        .statusPage
                                                                        .status
                                                                        .bannerPath
                                                                }
                                                            >
                                                                <label
                                                                    className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element[]; className: string; ty... Remove this comment to see the full error message
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
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                                .statusPage
                                                                .status
                                                                .bannerPath ||
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'bannerurl' does not exist on type 'Reado... Remove this comment to see the full error message
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
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'copyright' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                .copyright ||
                                                            '© MyCompany, Inc.'
                                                        }
                                                        disabled={
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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
                                    id="resetBranding"
                                    className="bs-Button bs-FileUploadButton bs-Button--new"
                                    disabled={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                        this.props.statusPage
                                            .resetBrandingColors.requesting
                                    }
                                    type="button"
                                    onClick={e => {
                                        e.preventDefault();
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                        return this.props.openModal({
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
                                            id: this.state.subProjectModalId,
                                            content: DataPathHoC(
                                                ConfirmResetBrandColors,
                                                {
                                                    confirmResetModalId: this
                                                        .state
                                                        .confirmResetModalId,
                                                    projectId,
                                                    statusPageId: _id,
                                                }
                                            ),
                                        });
                                    }}
                                >
                                    <span>Reset Colors to Default</span>
                                </button>
                                <button
                                    id="saveBranding"
                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                    disabled={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                        this.props.statusPage.branding
                                            .requesting
                                    }
                                    type="submit"
                                >
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                    {!this.props.statusPage.branding
                                        .requesting && <span>Save</span>}
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Branding.displayName = 'Branding';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
    logourl: PropTypes.string,
    colors: PropTypes.object,
    reset: PropTypes.func.isRequired,
    copyright: PropTypes.string,
    fetchProjectStatusPage: PropTypes.func.isRequired,
    resetBrandingColors: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    faviconurl: PropTypes.string,
    bannerurl: PropTypes.string,
};

const BrandingForm = reduxForm({
    form: 'Branding', // a unique identifier for this form
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
            updateStatusPageBranding,
            updateStatusPageBrandingRequest,
            createBannerCache,
            resetBannerCache,
            setStatusPageColors,
            updateStatusPageBrandingSuccess,
            updateStatusPageBrandingError,
            fetchProjectStatusPage,
            openModal,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
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
