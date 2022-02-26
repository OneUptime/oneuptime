import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import { deleteExternalStatusPage } from '../../actions/statusPage';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';

class RemoveExternalStatusPage extends Component {
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmThisDialog' does not exist on typ... Remove this comment to see the full error message
                return this.props.confirmThisDialog();
            default:
                return false;
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteExternalStatusPage' does not exist... Remove this comment to see the full error message
            deleteExternalStatusPage,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
        } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div className="ModalLayer-contents" style={{ marginTop: 40 }}>
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Delete</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to delete{' '}
                                        <span
                                            style={{
                                                textDecoration: 'underline',
                                            }}
                                        >
                                            {data.link.url}
                                        </span>{' '}
                                        ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                                            onClick={this.props.closeThisDialog}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="delete"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={() => {
                                                deleteExternalStatusPage(
                                                    data.link.projectId,
                                                    data.link._id
                                                ).then(
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmThisDialog' does not exist on typ... Remove this comment to see the full error message
                                                    this.props.confirmThisDialog
                                                );
                                            }}
                                            autoFocus={true}
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Delete</span>
                                                    <span className="delete-btn__keycode">
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
RemoveExternalStatusPage.displayName = 'RemoveFooterLinkFormModal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
RemoveExternalStatusPage.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    deleteExternalStatusPage: PropTypes.func.isRequired,
    data: PropTypes.object,
    requesting: PropTypes.bool,
};
const mapStateToProps = (state: $TSFixMe) => {
    return {
        requesting: state.statusPage.externalStatusPages.requesting,
    };
};
const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            deleteExternalStatusPage,
        },
        dispatch
    );
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RemoveExternalStatusPage);
