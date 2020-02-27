import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

function ExitProjectModal(props) {
    const { isRequesting, error, confirmThisDialog, closeThisDialog } = props;

    return (
        <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
            <div
                className="ModalLayer-contents"
                tabIndex={-1}
                style={{ marginTop: 40 }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
                        <div className="bs-Modal-header">
                            <div className="bs-Modal-header-copy">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Exit Project</span>
                                </span>
                            </div>
                        </div>
                        <div className="bs-Modal-content">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                Are you sure you want to romove yourself from
                                this project?
                            </span>
                        </div>
                        <div className="bs-Modal-footer">
                            <div className="bs-Modal-footer-actions">
                                <ShouldRender if={error}>
                                    <div className="bs-Tail-copy">
                                        <div
                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                            style={{ marginTop: '10px' }}
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div
                                                    className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"
                                                    style={{ marginTop: '2px' }}
                                                ></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {error}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                                <button
                                    className={`bs-Button ${isRequesting &&
                                        'bs-is-disabled'}`}
                                    type="button"
                                    onClick={closeThisDialog}
                                    disabled={isRequesting}
                                >
                                    <span>Cancel</span>
                                </button>
                                <button
                                    className={`bs-Button bs-Button--red Box-background--red ${isRequesting &&
                                        'bs-is-disabled'}`}
                                    onClick={confirmThisDialog}
                                    disabled={isRequesting}
                                >
                                    <ShouldRender if={isRequesting}>
                                        <Spinner />
                                    </ShouldRender>
                                    <span>Exit Project</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

ExitProjectModal.displayName = 'ExitProjectModal';

ExitProjectModal.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapStateToProps = state => ({
    isRequesting:
        state.project &&
        state.project.exitProject &&
        state.project.exitProject.requesting,
    error:
        state.project &&
        state.project.exitProject &&
        state.project.exitProject.error,
});

export default connect(mapStateToProps)(ExitProjectModal);
