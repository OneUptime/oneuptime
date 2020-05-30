import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { history } from '../../store';
import { deleteApplicationSecurity } from '../../actions/security';
import { openModal, closeModal } from '../../actions/modal';
import DeleteApplicationSecurity from '../modals/DeleteApplicationSecurity';
import SecurityDetail from './SecurityDetail';
import Badge from '../common/Badge';
import IssueIndicator from './IssueIndicator';

const ApplicationSecurityView = ({
    name,
    deleteApplicationSecurity,
    isRequesting,
    applicationSecurityId,
    projectId,
    componentId,
    openModal,
    closeModal,
    deleteApplicationError,
}) => {
    const handleDelete = data => {
        const thisObj = this;

        openModal({
            id: data.applicationSecurityId,
            onConfirm: () => {
                return deleteApplicationSecurity(data).then(() => {
                    if (deleteApplicationError) {
                        // prevent dismissal of modal if errored
                        return handleDelete(data);
                    }

                    if (window.location.href.indexOf('localhost') <= -1) {
                        thisObj.context.mixpanel.track('Domain verification');
                    }

                    history.push(
                        `/dashboard/project/${data.projectId}/${data.componentId}/security/application`
                    );
                });
            },
            content: DeleteApplicationSecurity,
            propArr: [],
        });
    };

    const handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return closeModal({
                    id: applicationSecurityId,
                });
            default:
                return false;
        }
    };

    return (
        <div onKeyDown={handleKeyBoard} className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="db-Trends-header">
                        <div className="db-Trends-title">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <span
                                            id="monitor-content-header"
                                            className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                        >
                                            <IssueIndicator status={1} />
                                            <span
                                                id={`application-title-${name}`}
                                            >
                                                {name}
                                            </span>
                                        </span>
                                    </div>
                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                        <div className="Box-root">
                                            <Badge color={'green'}>
                                                Application Security
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bs-u-flex Flex-wrap--wrap bs-u-justify--end">
                            <button
                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--eye"
                                type="button"
                                onClick={() => {}}
                            >
                                <span>Scan</span>
                            </button>
                            <button
                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                type="button"
                                onClick={() => {}}
                            >
                                <span>Edit</span>
                            </button>
                            <button
                                id="deleteApplicationSecurityBtn"
                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete"
                                disabled={isRequesting}
                                onClick={() =>
                                    handleDelete({
                                        projectId,
                                        componentId,
                                        applicationSecurityId,
                                    })
                                }
                            >
                                <span>Delete</span>
                            </button>
                        </div>
                    </div>
                    <div
                        className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                        style={{ boxShadow: 'none' }}
                    >
                        <div>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <SecurityDetail />
                            </div>
                        </div>
                    </div>
                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                        <div className="bs-Tail-copy">
                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

ApplicationSecurityView.displayName = 'Application Security View';

ApplicationSecurityView.propTypes = {
    name: PropTypes.string,
    deleteApplicationSecurity: PropTypes.func,
    isRequesting: PropTypes.bool,
    applicationSecurityId: PropTypes.string,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
    deleteApplicationError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { deleteApplicationSecurity, openModal, closeModal },
        dispatch
    );

const mapStateToProps = state => {
    return {
        isRequesting: state.security.deleteApplication.requesting,
        deleteApplicationError: state.security.deleteApplication.error,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ApplicationSecurityView);
