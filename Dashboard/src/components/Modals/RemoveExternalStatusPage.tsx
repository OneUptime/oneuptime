import React, { Component } from 'react';
import PropTypes from 'prop-types';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import { deleteExternalStatusPage } from '../../actions/statusPage';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

interface RemoveExternalStatusPageProps {
    confirmThisDialog: Function;
    closeThisDialog: Function;
    deleteExternalStatusPage: Function;
    data?: object;
    requesting?: boolean;
}

class RemoveExternalStatusPage extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
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

    override render() {
        const {

            data,

            closeThisDialog,

            deleteExternalStatusPage,

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


RemoveExternalStatusPage.displayName = 'RemoveFooterLinkFormModal';


RemoveExternalStatusPage.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    deleteExternalStatusPage: PropTypes.func.isRequired,
    data: PropTypes.object,
    requesting: PropTypes.bool,
};
const mapStateToProps: Function = (state: RootState) => {
    return {
        requesting: state.statusPage.externalStatusPages.requesting,
    };
};
const mapDispatchToProps: Function = (dispatch: Dispatch) => {
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
