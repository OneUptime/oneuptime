import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { resetProjectToken } from '../../actions/project';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import RenderIfAdmin from '../../components/basic/RenderIfAdmin';

export class APISettings extends Component {

    constructor(props){
        super(props);

        this.state = {
            hidden: true
        }
    }

    resetToken =()=> {
        this.props.resetProjectToken(this.props.currentProject._id);
        if(window.location.href.indexOf('localhost') <= -1){
            this.context.mixpanel.track('Project Token Reset', {projectId:this.props.currentProject._id});
        }
    }

    render() {
        const { hidden } = this.state;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        API Settings
                                    </span>
                                </span>
                                <p>
                                    <span>
                                        Access and integrate your apps and services with Fyipe API.
                                    </span>
                                </p>
                            </div>
                        </div>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Project ID</label>
                                                <div className="bs-Fieldset-fields">
                                                    <span className="value" style={{ marginTop: '6px' }}>
                                                        {this.props.currentProject !== null ? this.props.currentProject._id : 'LOADING...'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">API Key</label>
                                                <div className="bs-Fieldset-fields" style={{ flex: 'none' }}>
                                                    <ShouldRender if={hidden}>
                                                        <span className="value" style={{ marginTop: '6px' }}>
                                                            XXXX - XXXX - XXXX - XXXX
                                                        </span>
                                                    </ShouldRender>
                                                    <ShouldRender if={!hidden}>
                                                        <span className="value" style={{ marginTop: '6px' }}>
                                                            {this.props.currentProject !== null ? this.props.currentProject.apiKey : 'LOADING...'}
                                                        </span>
                                                    </ShouldRender>
                                                </div>
                                                <div className="bs-Fieldset-fields">
                                                    <span style={{ display: 'block', marginLeft: '120px' }}>
                                                        <button className="button-as-anchor" onClick={() => this.setState(state => ({
                                                            hidden: !state.hidden
                                                        }))} > { hidden ? 'Show' : 'Hide' } </button>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>

                            <div>
                                <RenderIfAdmin>
                                    <button
                                        className="bs-Button bs-Button--blue"
                                        onClick={this.resetToken}
                                    >
                                        <ShouldRender if={!this.props.isRequesting}>
                                            <span>Reset API Key</span>
                                        </ShouldRender>
                                        <ShouldRender if={this.props.isRequesting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </RenderIfAdmin>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

APISettings.displayName = 'APISettings'

const mapStateToProps = state => (
    {
        currentProject: state.project.currentProject,
        isRequesting: state.project.resetToken.requesting
    }
);

const mapDispatchToProps = dispatch => (
    bindActionCreators({ resetProjectToken }, dispatch)
);

APISettings.propTypes = {
    resetProjectToken:PropTypes.func.isRequired,
    currentProject: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null,undefined])
    ]),
    isRequesting: PropTypes.oneOf([null,undefined,true,false]),
}

APISettings.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(APISettings);