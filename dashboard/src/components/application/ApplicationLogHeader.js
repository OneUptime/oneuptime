import React, { Component } from 'react';
import DataPathHoC from '../DataPathHoC';
import ViewApplicationLogKey from '../modals/ViewApplicationLogKey';
import DeleteApplicationLog from '../modals/DeleteApplicationLog';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';

class ApplicationLogHeader extends Component {
    render() {
        const {
            applicationLog,
            isDetails,
            openModal,
            openApplicationLogKeyModalId,
            editApplicationLog,
            deleteModalId,
            deleteApplicationLog,
            deleting,
            viewMore,
            resetApplicationLogKey,
        } = this.props;
        return (
            <div className="db-Trends-header">
                <div className="db-Trends-title">
                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span
                                    id="application-content-header"
                                    className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                >
                                    <span
                                        id={`application-log-title-${applicationLog.name}`}
                                    >
                                        {applicationLog.name}
                                    </span>
                                </span>
                            </div>
                            <div className="db-Trends-control Flex-justifyContent--flexEnd Flex-flex">
                                <div>
                                    {isDetails ? (
                                        <div>
                                            <button
                                                id={`key_${applicationLog.name}`}
                                                className={
                                                    'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--key'
                                                }
                                                type="button"
                                                onClick={() =>
                                                    openModal({
                                                        id: openApplicationLogKeyModalId,
                                                        onClose: () => '',
                                                        onConfirm: () =>
                                                            resetApplicationLogKey(),
                                                        content: DataPathHoC(
                                                            ViewApplicationLogKey,
                                                            {
                                                                applicationLog,
                                                            }
                                                        ),
                                                    })
                                                }
                                            >
                                                <span>Application Log Key</span>
                                            </button>
                                            <button
                                                id={`edit_${applicationLog.name}`}
                                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--settings"
                                                type="button"
                                                onClick={editApplicationLog}
                                            >
                                                <span>Edit</span>
                                            </button>
                                            <button
                                                id={`delete_${applicationLog.name}`}
                                                className={
                                                    deleting
                                                        ? 'bs-Button bs-Button--blue'
                                                        : 'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete'
                                                }
                                                type="button"
                                                disabled={deleting}
                                                onClick={() =>
                                                    openModal({
                                                        id: deleteModalId,
                                                        onClose: () => '',
                                                        onConfirm: () =>
                                                            deleteApplicationLog(),
                                                        content: DataPathHoC(
                                                            DeleteApplicationLog,
                                                            {
                                                                applicationLog,
                                                            }
                                                        ),
                                                    })
                                                }
                                            >
                                                <ShouldRender if={!deleting}>
                                                    <span>Delete</span>
                                                </ShouldRender>
                                                <ShouldRender if={deleting}>
                                                    <FormLoader />
                                                </ShouldRender>
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            id={`more-details-${applicationLog.name}`}
                                            className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--help"
                                            type="button"
                                            onClick={viewMore}
                                        >
                                            <span>More</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

ApplicationLogHeader.displayName = 'ApplicationLogHeader';

ApplicationLogHeader.propTypes = {
    openApplicationLogKeyModalId: PropTypes.string,
    applicationLog: PropTypes.object,
    openModal: PropTypes.func,
    editApplicationLog: PropTypes.func,
    deleteApplicationLog: PropTypes.func,
    isDetails: PropTypes.bool,
    deleteModalId: PropTypes.string,
    deleting: PropTypes.bool,
    viewMore: PropTypes.func,
    resetApplicationLogKey: PropTypes.func,
};

export default ApplicationLogHeader;
