import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';

interface ConfirmErrorTrackerIssueActionProps {
    confirmThisDialog: Function;
    closeThisDialog: Function;
    errorTrackerStatus?: object;
    data?: object;
}

class ConfirmErrorTrackerIssueAction extends Component<ConfirmErrorTrackerIssueActionProps> {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':

                return this.props.confirmThisDialog();
            default:
                return false;
        }
    };

    render() {
        let deleting = false;
        if (

            this.props.errorTrackerStatus &&

            (this.props.errorTrackerStatus.requestingResolve ||

                this.props.errorTrackerStatus.requestingIgnore)
        ) {
            deleting = true;
        }

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >

                    <ClickOutside onClickOutside={this.props.closeThisDialog}>
                        <div className="bs-BIM">
                            <div className="bs-Modal bs-Modal--medium">
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                Confirm{' '}

                                                {this.props.data.actionTitle}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to{' '}

                                        {this.props.data.action}

                                        {this.props.data.count > 1
                                            ? ' these Issues'
                                            : ' this Issue'}
                                        ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"

                                            onClick={this.props.closeThisDialog}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="deleteApplicationLog"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            type="button"
                                            onClick={

                                                this.props.confirmThisDialog
                                            }
                                            disabled={deleting}
                                            autoFocus={true}
                                        >
                                            {!deleting && (
                                                <>
                                                    <span>
                                                        Yes,{' '}

                                                        {this.props.data.action}
                                                    </span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {deleting && <FormLoader />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ClickOutside>
                </div>
            </div>
        );
    }
}


ConfirmErrorTrackerIssueAction.displayName = 'ConfirmErrorTrackerIssueAction';


ConfirmErrorTrackerIssueAction.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    errorTrackerStatus: PropTypes.object,
    data: PropTypes.object,
};

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    return {
        errorTrackerStatus:
            state.errorTracker.errorTrackerStatus[ownProps.data.errorTrackerId],
    };
};

export default connect(mapStateToProps)(ConfirmErrorTrackerIssueAction);
