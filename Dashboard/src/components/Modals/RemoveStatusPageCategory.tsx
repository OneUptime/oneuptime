import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import { closeModal } from 'CommonUI/actions/modal';
import {
    deleteStatusPageCategory,
    fetchStatusPageCategories,
} from '../../actions/statusPageCategory';

interface RemoveResourceCategoryProps {
    closeModal: Function;
    deleteStatusPageCategory?: Function;
    deletingCategory?: boolean;
    deleteError?: string;
    data?: object;
    skip?: number;
    limit?: number;
    fetchStatusPageCategories?: Function;
}

class RemoveResourceCategory extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return this.handleDeleteCategory();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({});
    };

    handleDeleteCategory = () => {
        const {

            data,

            deleteStatusPageCategory,

            skip,

            limit,

            fetchStatusPageCategories,
        } = this.props;
        const { projectId, statusPageCategoryId, statusPageId } = data;
        deleteStatusPageCategory({ projectId, statusPageCategoryId }).then(
            () => {

                if (!this.props.deleteError) {
                    fetchStatusPageCategories({
                        projectId,
                        statusPageId,
                        skip,
                        limit,
                    });
                    this.handleCloseModal();
                }
            }
        );
    };

    override render() {

        const { deletingCategory } = this.props;

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
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Delete</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to delete this
                                        status page category?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={this.handleCloseModal}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="deleteResourceCategory"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={this.handleDeleteCategory}
                                            disabled={deletingCategory}
                                            autoFocus={true}
                                        >
                                            {!deletingCategory && (
                                                <>
                                                    <span>Delete</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {deletingCategory && <FormLoader />}
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


RemoveResourceCategory.displayName = 'RemoveResourceCategory';


RemoveResourceCategory.propTypes = {
    closeModal: PropTypes.func.isRequired,
    deleteStatusPageCategory: PropTypes.func,
    deletingCategory: PropTypes.bool,
    deleteError: PropTypes.string,
    data: PropTypes.object,
    skip: PropTypes.number,
    limit: PropTypes.number,
    fetchStatusPageCategories: PropTypes.func,
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        deletingCategory:
            state.statusPageCategory.deleteStatusPageCategory.requesting,
        deleteError: state.statusPageCategory.deleteStatusPageCategory.error,
        skip: state.statusPageCategory.fetchStatusPageCategories.skip,
        limit: state.statusPageCategory.fetchStatusPageCategories.limit,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    { closeModal, deleteStatusPageCategory, fetchStatusPageCategories },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RemoveResourceCategory);
