import React from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';

const DeleteConfirmationModal = ({ deleteRequest, confirmDelete, cancelDelete }) => {
    return (
        <ShouldRender if={confirmDelete}>
            <div className="modal__container" onClick={cancelDelete}>
                <div className="modal__items">
                    <div className="modal__body">
                        <div>Do you want to delete all the logs?</div>
                    </div>
                    <div className="Box-root modal__footer">

                        <button
                            onClick={deleteRequest}
                            className={
                                'Button bs-ButtonLegacy Margin-right--8'
                            }
                            type="button"
                        >
                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                    <span>Yes</span>
                                </span>
                            </div>
                        </button>
                        <button
                            onClick={cancelDelete}
                            className={
                                'Button bs-ButtonLegacy'
                            }
                            type="button"
                        >
                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                    <span>No</span>
                                </span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>

        </ShouldRender>
    )
}

DeleteConfirmationModal.propTypes = {
    deleteRequest: PropTypes.func,
    confirmDelete: PropTypes.bool,
    cancelDelete: PropTypes.func
}

export default DeleteConfirmationModal;