
import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { resetProjectToken } from '../../actions/project';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import RenderIfAdmin from '../../components/basic/RenderIfAdmin';
import ResetAPIKey from '../modals/ResetAPIKey';
import { openModal } from 'CommonUI/actions/modal';

import { API_URL } from '../../config';
import TooltipMini from '../basic/TooltipMini';

export class APISettings extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};

    constructor(props: $TSFixMe) {
        super(props);

        this.state = {
            hidden: true,
            resetModalId: uuidv4(),
        };
    }

    apiResetModal = () => {

        this.props.openModal({

            id: this.state.resetModalId,
            onClose: () => '',
            content: ResetAPIKey,
            onConfirm: () => {

                return this.props.resetProjectToken(

                    this.props.currentProject._id
                );
            },
        });
    };
    changeAPIKeyVisualState = () => {
        this.setState(state => ({

            hidden: !state.hidden,
        }));
    };

    override render() {

        const { hidden }: $TSFixMe = this.state;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span id="oneuptimeApi">API Keys</span>
                                </span>
                                <p>
                                    <span>
                                        Access and integrate your apps and
                                        services with API.
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
                                                <label className="bs-Fieldset-label">
                                                    Project ID
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <span
                                                        id="projectId"
                                                        className="value"
                                                        style={{
                                                            marginTop: '6px',
                                                        }}
                                                    >
                                                        {this.props

                                                            .currentProject !==
                                                            null
                                                            ? this.props

                                                                .currentProject
                                                                ._id
                                                            : 'LOADING...'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    API URL
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <span
                                                        id="apiUrl"
                                                        className="value"
                                                        style={{
                                                            marginTop: '6px',
                                                        }}
                                                    >
                                                        {API_URL !== null
                                                            ? API_URL
                                                            : 'LOADING...'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    API Key
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <ShouldRender if={hidden}>
                                                        <span
                                                            id="apiKey"
                                                            className="value"
                                                            style={{
                                                                marginTop:
                                                                    '6px',
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                            onClick={
                                                                this
                                                                    .changeAPIKeyVisualState
                                                            }
                                                        >
                                                            Click here to reveal
                                                            API key
                                                        </span>
                                                    </ShouldRender>
                                                    <ShouldRender if={!hidden}>
                                                        <div className="Flex-flex">
                                                            <span
                                                                id="apiKey"
                                                                className="value"
                                                                style={{
                                                                    marginTop:
                                                                        '6px',
                                                                }}
                                                            >
                                                                {this.props

                                                                    .currentProject !==
                                                                    null
                                                                    ? this.props

                                                                        .currentProject
                                                                        .apiKey
                                                                    : 'LOADING...'}
                                                            </span>
                                                            <div
                                                                onClick={
                                                                    this
                                                                        .changeAPIKeyVisualState
                                                                }
                                                                className="Flex-flex Flex-alignItems--center Padding-left--8"
                                                            >
                                                                <TooltipMini
                                                                    title="Hide API Key"
                                                                    content={
                                                                        <img
                                                                            alt="hide_api_key"
                                                                            src="/dashboard/assets/img/hide.svg"
                                                                            style={{
                                                                                width:
                                                                                    '15px',
                                                                                height:
                                                                                    '15px',
                                                                                cursor:
                                                                                    'pointer',
                                                                            }}
                                                                        />
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    </ShouldRender>
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
                                        id="resetApiKey"
                                        className="bs-Button bs-Button--blue"
                                        onClick={this.apiResetModal}
                                    >
                                        <ShouldRender

                                            if={!this.props.isRequesting}
                                        >
                                            <span>Reset API Key</span>
                                        </ShouldRender>
                                        <ShouldRender

                                            if={this.props.isRequesting}
                                        >
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </RenderIfAdmin>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


APISettings.displayName = 'APISettings';

const mapStateToProps: Function = (state: RootState) => ({
    currentProject: state.project.currentProject,
    isRequesting: state.project.resetToken.requesting
});

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ resetProjectToken, openModal }, dispatch);


APISettings.propTypes = {
    resetProjectToken: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    openModal: PropTypes.func.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(APISettings);
