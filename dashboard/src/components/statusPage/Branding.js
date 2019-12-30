import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Component } from 'react';
import { API_URL } from '../../config';
import { reduxForm, Field } from 'redux-form';
import {
    updateStatusPageBranding, updateStatusPageBrandingRequest, updateStatusPageBrandingSuccess,
    updateStatusPageBrandingError, createLogoCache, createFaviconCache,
    resetLogoCache, resetFaviconCache, fetchProjectStatusPage,
} from '../../actions/statusPage';
import { RenderField } from '../basic/RenderField';
import { RenderTextArea } from '../basic/RenderTextArea';
import { UploadFile } from '../basic/UploadFile';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

//Client side validation
function validate(values) {
    const errors = {};
    if (values.title) {
        if (!Validate.text(values.title)) {
            errors.title = 'Please mention title in text format .'
        }
    }
    if (values.description) {
        if (!Validate.text(values.description)) {
            errors.description = 'Please mention description in text format .'
        }
    }
    if (values.copyright) {
        if (!Validate.text(values.copyright)) {
            errors.copyright = 'Please mention copyright in text format .'
        }
    }

    return errors;
}

export class Branding extends Component {

    changelogo = (e) => {
        e.preventDefault();

        let reader = new FileReader();
        let file = e.target.files[0];

        reader.onloadend = () => {
            this.props.createLogoCache(reader.result);
        }
        try {
            reader.readAsDataURL(file)
        } catch (error) {
            return
        }
        if (!IS_DEV) {
            logEvent('New Logo Selected');
        }
    }

    changefavicon = (e) => {
        e.preventDefault();

        let reader = new FileReader();
        let file = e.target.files[0];

        reader.onloadend = () => {
            this.props.createFaviconCache(reader.result);
        }
        try {
            reader.readAsDataURL(file)
        } catch (error) {
            return
        }
        if (!IS_DEV) {
            logEvent('New Favicon Selected');
        }
    }

    submitForm = (values) => {
        var { _id, projectId } = this.props.statusPage.status
        projectId = projectId ? projectId._id || projectId : null;
        if(_id) values._id = _id;
        const { reset, resetLogoCache, resetFaviconCache } = this.props;
        this.props.updateStatusPageBranding(projectId, values).then( ()=> {
            this.props.fetchProjectStatusPage(projectId, true, 0, 10);
            resetLogoCache();
            resetFaviconCache();
            reset();
        }, function () {

        });
        if (!IS_DEV) {
            logEvent('Changed Logo, Style, Branding', values);
        }
    }

    render() {
        const { handleSubmit } = this.props;
        var faviconImage = <span />;
        var logoImage = <span />;
        var logoUrl = this.props.logourl ? this.props.logourl : this.props.statusPage.status && this.props.statusPage.status.logoPath ? `${API_URL}/file/${this.props.statusPage.status.logoPath}` : '';
        var faviconUrl = this.props.faviconurl ? this.props.faviconurl : this.props.statusPage.status && this.props.statusPage.status.faviconPath ? `${API_URL}/file/${this.props.statusPage.status.faviconPath}` : '';
        if ((this.props.statusPage && this.props.statusPage.status && this.props.statusPage.status.faviconPath) || this.props.faviconurl) {
            faviconImage = <img src={faviconUrl} alt="" className="image-small-circle" />;
        }
        if ((this.props.statusPage && this.props.statusPage.status && this.props.statusPage.status.logoPath) || this.props.faviconurl) {
            logoImage = <img src={logoUrl} alt="" className="image-small-circle" />;
        }
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Branding</span>
                            </span>
                            <p><span>Change the logo, style, and branding of your status page.</span></p>
                        </div>
                    </div>
                    <form onSubmit={handleSubmit(this.submitForm)} >
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Page Title</label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        component={RenderField}
                                                        type="text"
                                                        name="title"
                                                        id="title"
                                                        placeholder="MyCompany Status Page"
                                                        disabled={this.props.statusPage.branding.requesting}
                                                    />
                                                    <p className="bs-Fieldset-explanation"><span>This is used for SEO.
																				</span></p>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Page Description</label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <Field className="bs-TextArea"
                                                        component={RenderTextArea}
                                                        type="text"
                                                        name="description"
                                                        rows="5"
                                                        id="account_app_product_description"
                                                        placeholder="A short description of the page. This is used for SEO."
                                                        disabled={this.props.statusPage.branding.requesting}
                                                        style={{ width: '250px', resize: 'none' }}
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Favicon</label>
                                                <div className="bs-Fieldset-fields">
                                                    <div className="Box-root Flex-flex Flex-alignItems--center"><div>
                                                        <label className="bs-Button bs-DeprecatedButton bs-FileUploadButton" type="button" >
                                                            <ShouldRender if={!this.props.statusPage.status.logoPath}>
                                                                <span className="bs-Button--icon bs-Button--new"></span>
                                                                <span>Upload favicon</span>
                                                            </ShouldRender>
                                                            <ShouldRender if={this.props.statusPage.status.logoPath}>
                                                                <span className="bs-Button--icon bs-Button--edit"></span>
                                                                <span>Change favicon</span>
                                                            </ShouldRender>
                                                            <div className="bs-FileUploadButton-inputWrap">
                                                                <Field className="bs-FileUploadButton-input"
                                                                    component={UploadFile}
                                                                    name="favicon"
                                                                    id="favicon"
                                                                    onChange={this.changefavicon}
                                                                    accept="image/jpeg, image/jpg, image/png"
                                                                />
                                                            </div></label></div></div>
                                                    <p className="bs-Fieldset-explanation"><span>Upload 64x64 favicon.
                                                    </span></p>
                                                    <ShouldRender if={this.props.statusPage.status.faviconPath || this.props.faviconurl}>
                                                        {faviconImage}
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Logo</label>
                                                <div className="bs-Fieldset-fields">
                                                    <div className="Box-root Flex-flex Flex-alignItems--center"><div>
                                                        <label className="bs-Button bs-DeprecatedButton bs-FileUploadButton" type="button" >
                                                            <ShouldRender if={!this.props.statusPage.status.logoPath}>
                                                                <span className="bs-Button--icon bs-Button--new"></span>
                                                                <span>Upload Logo</span>
                                                            </ShouldRender>
                                                            <ShouldRender if={this.props.statusPage.status.logoPath}>
                                                                <span className="bs-Button--icon bs-Button--edit"></span>
                                                                <span>Change Logo</span>
                                                            </ShouldRender>
                                                            <div className="bs-FileUploadButton-inputWrap">
                                                                <Field className="bs-FileUploadButton-input"
                                                                    component={UploadFile}
                                                                    name="logo"
                                                                    id="logo"
                                                                    onChange={this.changelogo}
                                                                    accept="image/jpeg, image/jpg, image/png"
                                                                />
                                                            </div>
                                                        </label>
                                                    </div>
                                                    </div>
                                                    <p className="bs-Fieldset-explanation"><span>Upload a square 400x400 logo.</span></p>
                                                    <ShouldRender if={this.props.statusPage.status.logoPath || this.props.logourl}>
                                                        {logoImage}
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Copyright</label>
                                                <div className="bs-Fieldset-fields">

                                                    <Field className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        component={RenderField}
                                                        type="text"
                                                        name="copyright"
                                                        id="copyright"
                                                        placeholder={this.props.copyright || '© MyCompany, Inc.'}
                                                        disabled={this.props.statusPage.branding.requesting}
                                                    />
                                                    <p className="bs-Fieldset-explanation"><span>This is shown on the bottom of your status page.
																				</span></p>
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12"><span className="db-SettingsForm-footerMessage">
                            <ShouldRender if={this.props.statusPage.branding.error}>
                                <div className="bs-Tail-copy">
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                            </div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>{this.props.statusPage.branding.error}</span>
                                        </div>
                                    </div>
                                </div>
                            </ShouldRender>
                        </span>

                            <div>
                                <button className="bs-Button bs-DeprecatedButton bs-Button--blue" disabled={this.props.statusPage.branding.requesting} type="submit">{!this.props.statusPage.branding.requesting && <span>Save</span>}
                                    {this.props.statusPage.branding.requesting && <FormLoader />}</button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

Branding.displayName = 'Branding'

Branding.propTypes = {
    statusPage: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    resetLogoCache: PropTypes.func.isRequired,
    createFaviconCache: PropTypes.func.isRequired,
    resetFaviconCache: PropTypes.func.isRequired,
    updateStatusPageBranding: PropTypes.func.isRequired,
    createLogoCache: PropTypes.func.isRequired,
    logourl: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    faviconurl: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    reset: PropTypes.func.isRequired,
    copyright: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    fetchProjectStatusPage: PropTypes.func.isRequired,
}

let BrandingForm = reduxForm({
    form: 'Branding', // a unique identifier for this form
    enableReinitialize: true,
    validate // <--- validation function given to redux-for
})(Branding);

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        createLogoCache, createFaviconCache,
        resetLogoCache, resetFaviconCache,
        updateStatusPageBranding, updateStatusPageBrandingRequest,
        updateStatusPageBrandingSuccess, updateStatusPageBrandingError, fetchProjectStatusPage,
    }, dispatch)
}

function mapStateToProps(state) {

    return {
        statusPage: state.statusPage,
        logourl: state.statusPage.logocache.data,
        faviconurl: state.statusPage.faviconcache.data,
        initialValues: {
            title: state.statusPage && state.statusPage.status && state.statusPage.status.title ? state.statusPage.status.title : '',
            description: state.statusPage && state.statusPage.status && state.statusPage.status.description ? state.statusPage.status.description : '',
            copyright: state.statusPage && state.statusPage.status && state.statusPage.status.copyright ? state.statusPage.status.copyright : '',
        }

    };
}

export default connect(mapStateToProps, mapDispatchToProps)(BrandingForm);