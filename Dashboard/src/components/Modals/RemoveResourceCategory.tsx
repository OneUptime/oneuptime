import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import { closeModal } from 'CommonUI/actions/modal';
import { deleteResourceCategory } from '../../actions/resourceCategories';
import { bindActionCreators, Dispatch } from 'redux';

interface RemoveResourceCategoryProps {
    deleteResourceCategoryObj: object;
    projectId?: string;
    deleteResourceCategory?: Function;
    closeModal?: Function;
    data?: object;
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

                return this.props.closeModal();
            case 'Enter':
                return this.handleDeleteResourceCategory();
            default:
                return false;
        }
    };

    handleDeleteResourceCategory = () => {

        const { resourceCategoryId } = this.props.data;
        this.props

            .deleteResourceCategory(resourceCategoryId, this.props.projectId)
            .finally(() => {

                this.props.closeModal();
            });
    };

    override render() {

        const { deleteResourceCategoryObj, closeModal } = this.props;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeModal}>
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
                                        resource category?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"

                                            onClick={this.props.closeModal}
                                            disabled={
                                                deleteResourceCategoryObj.requesting
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="deleteResourceCategoryObj"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={
                                                this
                                                    .handleDeleteResourceCategory
                                            }
                                            disabled={
                                                deleteResourceCategoryObj.requesting
                                            }
                                            autoFocus={true}
                                        >
                                            {!deleteResourceCategoryObj.requesting && (
                                                <>
                                                    <span>Delete</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {deleteResourceCategoryObj.requesting && (
                                                <FormLoader />
                                            )}
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


RemoveResourceCategory.displayName = 'RemoveResourceCategoryFormModal';


RemoveResourceCategory.propTypes = {
    deleteResourceCategoryObj: PropTypes.object.isRequired,
    projectId: PropTypes.string,
    deleteResourceCategory: PropTypes.func,
    closeModal: PropTypes.func,
    data: PropTypes.object,
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        deleteResourceCategoryObj:
            state.resourceCategories.deletedResourceCategory,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ deleteResourceCategory, closeModal }, dispatch);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RemoveResourceCategory);
