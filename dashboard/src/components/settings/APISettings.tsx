// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { resetProjectToken } from '../../actions/project';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import RenderIfAdmin from '../../components/basic/RenderIfAdmin';
import ResetAPIKey from '../modals/ResetAPIKey';
import { openModal } from '../../actions/modal';

import { API_URL } from '../../config';
import TooltipMini from '../basic/TooltipMini';

export class APISettings extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.state = {
            hidden: true,
            resetModalId: uuidv4(),
        };
    }

    apiResetModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetModalId' does not exist on type 'Re... Remove this comment to see the full error message
            id: this.state.resetModalId,
            onClose: () => '',
            content: ResetAPIKey,
            onConfirm: () => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetProjectToken' does not exist on typ... Remove this comment to see the full error message
                return this.props.resetProjectToken(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id
                );
            },
        });
    };
    changeAPIKeyVisualState = () => {
        this.setState(state => ({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'hidden' does not exist on type 'Readonly... Remove this comment to see the full error message
            hidden: !state.hidden,
        }));
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'hidden' does not exist on type 'Readonly... Remove this comment to see the full error message
        const { hidden } = this.state;

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
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                            .currentProject !==
                                                        null
                                                            ? this.props
                                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
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
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                                    .currentProject !==
                                                                null
                                                                    ? this.props
                                                                          // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                                            if={!this.props.isRequesting}
                                        >
                                            <span>Reset API Key</span>
                                        </ShouldRender>
                                        <ShouldRender
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
APISettings.displayName = 'APISettings';

const mapStateToProps = (state: $TSFixMe) => ({
    currentProject: state.project.currentProject,
    isRequesting: state.project.resetToken.requesting
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ resetProjectToken, openModal }, dispatch);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
APISettings.propTypes = {
    resetProjectToken: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    openModal: PropTypes.func.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(APISettings);
