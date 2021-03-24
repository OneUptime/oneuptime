import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import { scanContainerSecurity } from '../../actions/security';
import { openModal } from '../../actions/modal';
import DeleteContainerSecurity from '../modals/DeleteContainerSecurity';
import SecurityDetail from './SecurityDetail';
import Badge from '../common/Badge';
import IssueIndicator from './IssueIndicator';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import EditContainerSecurity from '../modals/EditContainerSecurity';
import threatLevel from '../../utils/threatLevel';

const ContainerSecurityView = ({
    isRequesting,
    containerSecurityId,
    containerSecuritySlug,
    projectId,
    componentId,
    componentSlug,
    openModal,
    scanContainerSecurity,
    securityLog,
    scanning,
    containerSecurity,
    scanError,
    activeContainerSecurity,
}) => {
    const handleDelete = ({
        projectId,
        componentId,
        containerSecurityId,
        containerSecuritySlug,
    }) => {
        openModal({
            id: containerSecurityId,
            content: DeleteContainerSecurity,
            propArr: [
                {
                    projectId,
                    componentId,
                    containerSecurityId,
                    containerSecuritySlug,
                    componentSlug,
                },
            ],
        });
    };

    const handleEdit = ({
        projectId,
        componentId,
        containerSecurityId,
        containerSecuritySlug,
    }) => {
        openModal({
            id: containerSecurityId,
            content: EditContainerSecurity,
            propArr: [
                {
                    projectId,
                    componentId,
                    containerSecurityId,
                    containerSecuritySlug,
                },
            ],
        });
    };

    const status = securityLog.data
        ? threatLevel(securityLog.data.vulnerabilityInfo)
        : 'no data';

    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="db-Trends-header">
                        <div className="db-Trends-title">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <span
                                            id={`containerSecurityHeader_${containerSecurity.name}`}
                                            className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                        >
                                            <IssueIndicator status={status} />
                                            <span
                                                id={`containerSecurityTitle_${containerSecurity.name}`}
                                                style={{
                                                    textTransform: 'capitalize',
                                                }}
                                            >
                                                {containerSecurity.name}
                                            </span>
                                        </span>
                                    </div>
                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                        <ShouldRender
                                            if={
                                                containerSecurity &&
                                                containerSecurity.resourceCategory
                                            }
                                        >
                                            <div className="Box-root Padding-right--8">
                                                <Badge
                                                    id={`${containerSecurity.name}-badge`}
                                                    color={'slate5'}
                                                >
                                                    {containerSecurity &&
                                                    containerSecurity.resourceCategory
                                                        ? containerSecurity
                                                              .resourceCategory
                                                              .name
                                                        : ''}
                                                </Badge>
                                            </div>
                                        </ShouldRender>
                                        <div className="Box-root">
                                            <Badge color={'green'}>
                                                Container Security
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bs-u-flex Flex-wrap--wrap bs-u-justify--between">
                            <div>
                                <div
                                    className="bs-Fieldset-row"
                                    style={{ padding: 0 }}
                                >
                                    <ShouldRender
                                        if={containerSecurity.lastScan}
                                    >
                                        <label className="Text-fontWeight--medium">
                                            Last Scan:
                                        </label>
                                        <div className="Margin-left--2">
                                            <span className="value">{`${moment(
                                                containerSecurity.lastScan
                                            ).fromNow()} (${moment(
                                                containerSecurity.lastScan
                                            ).format(
                                                'MMMM Do YYYY, h:mm:ss a'
                                            )})`}</span>
                                        </div>
                                    </ShouldRender>
                                </div>
                                <div
                                    className="bs-Fieldset-row"
                                    style={{ padding: 0 }}
                                >
                                    <ShouldRender
                                        if={containerSecurity.lastScan}
                                    >
                                        <label className="Text-fontWeight--medium">
                                            Next Scan:
                                        </label>
                                        <div className="Margin-left--2">
                                            <span className="value">{`${moment(
                                                containerSecurity.lastScan
                                            )
                                                .add(24, 'hours')
                                                .format(
                                                    'MMMM Do YYYY, h:mm:ss a'
                                                )}`}</span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                <ShouldRender
                                    if={
                                        (scanning &&
                                            String(containerSecurityId) ===
                                                String(
                                                    activeContainerSecurity
                                                )) ||
                                        containerSecurity.scanning ||
                                        !containerSecurity.lastScan
                                    }
                                >
                                    <button
                                        className="bs-Button bs-DeprecatedButton"
                                        disabled={
                                            scanning ||
                                            containerSecurity.scanning ||
                                            !containerSecurity.lastScan
                                        }
                                        id={`scanning_${containerSecurity.name}`}
                                    >
                                        <Spinner
                                            style={{ stroke: '#8898aa' }}
                                        />
                                        <span>Scanning</span>
                                    </button>
                                </ShouldRender>
                                <ShouldRender
                                    if={
                                        (!scanning ||
                                            String(containerSecurityId) !==
                                                String(
                                                    activeContainerSecurity
                                                )) &&
                                        !containerSecurity.scanning &&
                                        containerSecurity.lastScan
                                    }
                                >
                                    <button
                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--security-scan"
                                        type="button"
                                        onClick={() =>
                                            scanContainerSecurity({
                                                projectId,
                                                containerSecurityId,
                                            })
                                        }
                                        disabled={
                                            scanning &&
                                            String(containerSecurityId) ===
                                                String(activeContainerSecurity)
                                        }
                                        id={`scan_${containerSecurity.name}`}
                                    >
                                        <span>Scan</span>
                                    </button>
                                </ShouldRender>
                                <button
                                    id={`edit_${containerSecurity.name}`}
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                    type="button"
                                    onClick={() =>
                                        handleEdit({
                                            projectId,
                                            componentId,
                                            containerSecurityId,
                                            containerSecuritySlug,
                                        })
                                    }
                                >
                                    <span>Edit</span>
                                </button>
                                <button
                                    id="deleteContainerSecurityBtn"
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete"
                                    disabled={isRequesting}
                                    onClick={() =>
                                        handleDelete({
                                            projectId,
                                            componentId,
                                            containerSecurityId,
                                            containerSecuritySlug,
                                        })
                                    }
                                >
                                    <span>Delete</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div
                        className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                        style={{ boxShadow: 'none' }}
                    >
                        <div>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <SecurityDetail
                                    containerSecurityLog={securityLog}
                                    type="container"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                        <div className="bs-Tail-copy">
                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                <ShouldRender
                                    if={
                                        !scanning &&
                                        scanError &&
                                        String(containerSecurityId) ===
                                            String(activeContainerSecurity)
                                    }
                                >
                                    <div className="Box-root Margin-right--8">
                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                    </div>
                                    <div className="Box-root">
                                        <span style={{ color: 'red' }}>
                                            {scanError}
                                        </span>
                                    </div>
                                </ShouldRender>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

ContainerSecurityView.displayName = 'Container Security View';

ContainerSecurityView.propTypes = {
    isRequesting: PropTypes.bool,
    containerSecurityId: PropTypes.string,
    containerSecuritySlug: PropTypes.string,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    openModal: PropTypes.func,
    scanContainerSecurity: PropTypes.func,
    scanning: PropTypes.bool,
    securityLog: PropTypes.object,
    containerSecurity: PropTypes.object,
    scanError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    activeContainerSecurity: PropTypes.string,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal,
            scanContainerSecurity,
        },
        dispatch
    );

const mapStateToProps = state => {
    return {
        isRequesting: state.security.deleteContainer.requesting,
        scanning: state.security.scanContainerSecurity.requesting,
        securityLog: state.security.containerSecurityLog || {},
        scanError: state.security.scanContainerSecurity.error,
        activeContainerSecurity: state.security.activeContainerSecurity,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ContainerSecurityView);
