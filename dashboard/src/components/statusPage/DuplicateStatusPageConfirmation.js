import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ClickOutside from 'react-click-outside';
import { bindActionCreators } from 'redux';
import { history } from '../../store';
import { closeModal } from '../../actions/modal';
import {
    fetchStatusPage,
    duplicateStatusPageReset,
} from '../../actions/statusPage';

class DuplicateStatusPageConfirmation extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleNavigation = () => {
        const { subProjectId, slug, statusPageId, statusPageSlug } = this.props;
        this.props.closeModal({
            id: this.props.duplicateModalId,
        });
        this.props.fetchStatusPage(statusPageId);
        history.push(
            `/dashboard/project/${slug}/sub-project/${subProjectId}/status-page/${statusPageSlug}`
        );
    };

    handleKeyboard = e => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return this.handleNavigation();
            default:
                break;
        }
    };

    handleCloseModal = () => {
        this.props.duplicateStatusPageReset();
        this.props.closeModal({
            id: this.props.duplicateModalId,
        });
    };

    render() {
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside
                                onClickOutside={this.handleCloseModal}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Duplicate Status Page</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Your Status Page has been created.
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className={`bs-Button btn__modal`}
                                            type="button"
                                            onClick={this.handleCloseModal}
                                        >
                                            <span>Close</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="confirmDuplicate"
                                            className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal`}
                                            onClick={this.handleNavigation}
                                            autoFocus={true}
                                        >
                                            <span>
                                                Take me to the Status Page
                                            </span>
                                            <span className="create-btn__keycode">
                                                <span className="keycode__icon keycode__icon--enter" />
                                            </span>
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

DuplicateStatusPageConfirmation.displayName = 'DuplicateStatusPageConfirmation';

const mapStateToProps = state => {
    return {
        duplicateModalId: state.modal.modals[0].id,
        statusPageId: state.modal.modals[0].statusPageId,
        statusPageSlug: state.modal.modals[0].statusPageSlug,
        subProjectId: state.modal.modals[0].subProjectId,
        slug: state.modal.modals[0].slug,
    };
};
const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        { closeModal, fetchStatusPage, duplicateStatusPageReset },
        dispatch
    );
};

DuplicateStatusPageConfirmation.propTypes = {
    closeModal: PropTypes.func,
    duplicateModalId: PropTypes.string.isRequired,
    slug: PropTypes.string.isRequired,
    statusPageId: PropTypes.string.isRequired,
    statusPageSlug: PropTypes.string.isRequired,
    subProjectId: PropTypes.string.isRequired,
    fetchStatusPage: PropTypes.func,
    duplicateStatusPageReset: PropTypes.func,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DuplicateStatusPageConfirmation);
