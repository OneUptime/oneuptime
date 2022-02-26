import React, { Component } from 'react';
import ShouldRender from '../basic/ShouldRender';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import {
    runScript,
    fetchAutomatedScript,
    fetchSingleAutomatedScript,
} from '../../actions/automatedScript';
import { history } from '../../store';

class RunAutomationScript extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            case 'Enter':
                return this.runScript();
            default:
                return false;
        }
    };

    runScript = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data: { automatedScriptId, projectId, automatedSlug, navigate },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'runScript' does not exist on type 'Reado... Remove this comment to see the full error message
            runScript,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAutomatedScript' does not exist on ... Remove this comment to see the full error message
            fetchAutomatedScript,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSingleAutomatedScript' does not exi... Remove this comment to see the full error message
            fetchSingleAutomatedScript,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
        } = this.props;
        runScript(projectId, automatedScriptId).then(() => {
            fetchAutomatedScript(projectId, 0, 10);
            const pathName = history.location.pathname;
            if (navigate) {
                history.push({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    pathname: `${pathName}/${this.props.data.automatedSlug}`,
                });
            } else {
                fetchSingleAutomatedScript(projectId, automatedSlug, 0, 10);
            }
            closeThisDialog();
        });
    };
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scriptRun' does not exist on type 'Reado... Remove this comment to see the full error message
            scriptRun: { error, requesting },
        } = this.props;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Run Script</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Do you want to run this script ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{ width: 280 }}
                                    >
                                        <ShouldRender if={!requesting && error}>
                                            <div
                                                id="error"
                                                className="bs-Tail-copy"
                                            >
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                        display: 'flex',
                                                        justifyContent:
                                                            'center',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {error}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={closeThisDialog}
                                            id="cancelDeleteAnnouncementBtn"
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="deleteAnnouncementModalBtn"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            type="button"
                                            onClick={this.runScript}
                                            disabled={requesting}
                                            autoFocus={true}
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Run</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {requesting && <FormLoader />}
                                        </button>
                                    </div>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
RunAutomationScript.displayName = 'RunAutomationScript';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
RunAutomationScript.propTypes = {
    closeThisDialog: PropTypes.func,
    data: PropTypes.object,
    projectId: PropTypes.string,
    runScript: PropTypes.func,
    fetchAutomatedScript: PropTypes.func,
    scriptRun: PropTypes.object,
    fetchSingleAutomatedScript: PropTypes.func,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        scriptRun: state.automatedScripts.runScript,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { runScript, fetchAutomatedScript, fetchSingleAutomatedScript },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RunAutomationScript);
