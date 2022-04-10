/*eslint-disable*/
import React, { Fragment } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import { history, RootState } from '../../store';
import ConfirmScanModal from '../modals/ConfirmScanModal';
import SecurityDetail from './SecurityDetail';
import IssueIndicator from './IssueIndicator';
import Badge from '../common/Badge';
import { openModal } from 'Common-ui/actions/modal';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import threatLevel from '../../utils/threatLevel';

interface SecurityInfoProps {
    name?: string;
    projectId?: string;
    componentSlug?: string;
    type: string;
    applicationSecurityId?: string;
    applicationSecuritySlug?: string;
    applicationSecurityLog?: object;
    openModal?: Function;
    scanningApplication?: boolean;
    containerSecuritySlug?: string;
    containerSecurityId?: string;
    containerSecurityLog?: object;
    scanningContainer?: boolean;
    containerSecurities?: unknown[];
    applicationSecurities?: unknown[];
    scanApplicationError?: string;
    activeApplicationSecurity?: string;
    activeContainerSecurity?: string;
    slug?: string;
    scannedStatus?: unknown[];
}

const SecurityInfo = ({
    name,
    projectId,
    componentSlug,
    type,
    applicationSecurityId,
    applicationSecuritySlug,
    applicationSecurityLog,
    scanningApplication,
    containerSecurityId,
    containerSecuritySlug,
    containerSecurityLog,
    openModal,
    scanningContainer,
    applicationSecurities,
    containerSecurities,
    scanApplicationError,
    scanContainerError,
    activeApplicationSecurity,
    activeContainerSecurity,
    slug,
    scannedStatus,
    containerScannedStatus
}: SecurityInfoProps) => {
    let currentScannedStatus = true;
    scannedStatus.forEach((scan: $TSFixMe) => {
        if (applicationSecurityId === scan._id) {
            currentScannedStatus = scan.scanned;
        }
    });

    let currentContainerScannedStatus = true;
    containerScannedStatus.forEach((scan: $TSFixMe) => {
        if (containerSecurityId === scan._id) {
            currentContainerScannedStatus = scan.scanned;
        }
    });

    const scanSecurity = () => {
        if (applicationSecurityId) {
            openModal({
                id: applicationSecurityId,
                content: ConfirmScanModal,
                propArr: [
                    {
                        projectId,
                        applicationSecurityId,
                        name: ' Application Security',
                    },
                ],
            });
        }

        if (containerSecurityId) {
            openModal({
                id: containerSecurityId,
                content: ConfirmScanModal,
                propArr: [
                    {
                        projectId,
                        containerSecurityId,
                        name: ' Container Security',
                    },
                ],
            });
        }
    };

    const more = () => {
        const securitySlug = containerSecuritySlug || applicationSecuritySlug;

        type =
            (type === 'container' && 'container') ||
            (type === 'application' && 'application');

        history.push(
            `/dashboard/project/${slug}/component/${componentSlug}/security/${type}/${securitySlug}`
        );
    };

    const getSecurityInfo = () => {
        let security = null;
        if (applicationSecurityId) {
            applicationSecurities.map((applicationSecurity: $TSFixMe) => {
                if (
                    String(applicationSecurity._id) ===
                    String(applicationSecurityId)
                ) {
                    security = applicationSecurity;
                }
                return applicationSecurity;
            });
        }

        if (containerSecurityId) {
            containerSecurities.map((containerSecurity: $TSFixMe) => {
                if (
                    String(containerSecurity._id) ===
                    String(containerSecurityId)
                ) {
                    security = containerSecurity;
                }
                return containerSecurity;
            });
        }

        return security;
    };

    const security = getSecurityInfo();

    const status =
        type === 'application'
            ? applicationSecurityLog.data
                ? threatLevel(applicationSecurityLog.data.vulnerabilities)
                : 'no data'
            : type === 'container' &&
            (containerSecurityLog.data
                ? threatLevel(containerSecurityLog.data.vulnerabilityInfo)
                : 'no data');

    return (
        <Fragment>
            <div className="Box-root">
                <div className="db-Trends-header">
                    <div className="db-Trends-title">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span
                                        id={
                                            (applicationSecurityId &&
                                                `applicationSecurityHeader_${name}`) ||
                                            (containerSecurityId &&
                                                `containerSecurityHeader_${name}`)
                                        }
                                        className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                    >

                                        <IssueIndicator status={status} />
                                        <span
                                            id={
                                                (applicationSecurityId &&
                                                    `applicationSecurityTitle_${name}`) ||
                                                (containerSecurityId &&
                                                    `containerSecurityTitle_${name}`)
                                            }
                                            style={{
                                                textTransform: 'capitalize',
                                            }}
                                        >
                                            {name}
                                        </span>
                                    </span>
                                </div>
                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                    <ShouldRender
                                        if={
                                            security &&

                                            security.resourceCategory
                                        }
                                    >
                                        <div className="Box-root Padding-right--8">
                                            <Badge color={'slate5'}>
                                                {security &&

                                                    security.resourceCategory

                                                    ? security.resourceCategory
                                                        .name
                                                    : ''}
                                            </Badge>
                                        </div>
                                    </ShouldRender>
                                    <div className="Box-root">
                                        <Badge color={'green'}>
                                            {type} Security
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

                                <ShouldRender if={security.lastScan}>
                                    <label className="Text-fontWeight--medium">
                                        Last Scan:
                                    </label>
                                    <div className="Margin-left--2">
                                        <span className="value">{`${moment(

                                            security.lastScan
                                        ).fromNow()} (${moment(

                                            security.lastScan
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

                                <ShouldRender if={security.lastScan}>
                                    <label className="Text-fontWeight--medium">
                                        Next Scan:
                                    </label>
                                    <div className="Margin-left--2">
                                        <span className="value">{`${moment(

                                            security.lastScan
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
                            {(applicationSecurityId &&
                                scanningApplication &&
                                String(applicationSecurityId) ===
                                String(activeApplicationSecurity)) ||
                                (containerSecurityId &&
                                    scanningContainer &&
                                    String(containerSecurityId) ===
                                    String(activeContainerSecurity)) ||

                                security.scanning ||

                                !security.lastScan ||

                                currentScannedStatus === false ||

                                currentContainerScannedStatus === false ? (
                                <button
                                    className="bs-Button bs-DeprecatedButton"
                                    disabled={
                                        (applicationSecurityId &&
                                            scanningApplication) ||
                                        (containerSecurityId &&
                                            scanningContainer) ||

                                        security.scanning ||

                                        !security.lastScan ||

                                        currentScannedStatus === false ||

                                        currentContainerScannedStatus === false
                                    }
                                    id={
                                        (applicationSecurityId &&
                                            `scanningApplicationSecurity_${name}`) ||
                                        (containerSecurityId &&
                                            `scanningContainerSecurity_${name}`)
                                    }
                                >
                                    <Spinner style={{ stroke: '#8898aa' }} />
                                    <span>Scanning</span>
                                </button>
                            ) : (
                                <button
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--security-scan"
                                    type="button"
                                    onClick={scanSecurity}
                                    id={
                                        (applicationSecurityId &&
                                            `scanApplicationSecurity_${name}`) ||
                                        (containerSecurityId &&
                                            `scanContainerSecurity_${name}`)
                                    }
                                >
                                    <span>Scan</span>
                                </button>
                            )}
                            <button
                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--more"
                                type="button"
                                onClick={more}
                                id={
                                    (applicationSecurityId &&
                                        `moreApplicationSecurity_${name}`) ||
                                    (containerSecurityId &&
                                        `moreContainerSecurity_${name}`)
                                }
                            >
                                <span>More</span>
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
                                applicationSecurityLog={applicationSecurityLog}
                                containerSecurityLog={containerSecurityLog}
                                type={type}
                                more={more}
                            />
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                    <div className="bs-Tail-copy">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <ShouldRender
                                if={
                                    applicationSecurityId &&
                                    !scanningApplication &&
                                    scanApplicationError &&
                                    String(activeApplicationSecurity) ===
                                    String(applicationSecurityId)
                                }
                            >
                                <div className="Box-root Margin-right--8">
                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                </div>
                                <div className="Box-root">
                                    <span style={{ color: 'red' }}>
                                        {scanApplicationError}
                                    </span>
                                </div>
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    containerSecurityId &&
                                    !scanningContainer &&
                                    scanContainerError &&
                                    String(activeContainerSecurity) ===
                                    String(containerSecurityId)
                                }
                            >
                                <div className="Box-root Margin-right--8">
                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                </div>
                                <div className="Box-root">
                                    <span style={{ color: 'red' }}>
                                        {scanContainerError}
                                    </span>
                                </div>
                            </ShouldRender>
                        </div>
                    </div>
                </div>
            </div>
        </Fragment>
    );
};

SecurityInfo.displayName = 'SecurityInfo';

SecurityInfo.propTypes = {
    name: PropTypes.string,
    projectId: PropTypes.string,
    componentSlug: PropTypes.string,
    type: PropTypes.string.isRequired,
    applicationSecurityId: PropTypes.string,
    applicationSecuritySlug: PropTypes.string,
    applicationSecurityLog: PropTypes.object,
    openModal: PropTypes.func,
    scanningApplication: PropTypes.bool,
    containerSecuritySlug: PropTypes.string,
    containerSecurityId: PropTypes.string,
    containerSecurityLog: PropTypes.object,
    scanningContainer: PropTypes.bool,
    containerSecurities: PropTypes.array,
    applicationSecurities: PropTypes.array,
    scanApplicationError: PropTypes.string,
    activeApplicationSecurity: PropTypes.string,
    activeContainerSecurity: PropTypes.string,
    slug: PropTypes.string,
    scannedStatus: PropTypes.array,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ openModal }, dispatch);

const mapStateToProps = (state: RootState) => {
    return {
        scanningApplication: state.security.scanApplicationSecurity.requesting,
        scanningContainer: state.security.scanContainerSecurity.requesting,
        applicationSecurities: state.security.applicationSecurities.securities,
        containerSecurities: state.security.containerSecurities.securities,
        scanApplicationError: state.security.scanApplicationSecurity.error,
        scanContainerError: state.security.scanContainerSecurity.error,
        activeApplicationSecurity: state.security.activeApplicationSecurity,
        activeContainerSecurity: state.security.activeContainerSecurity,
        slug: state.project.currentProject && state.project.currentProject.slug,
        scannedStatus: state.security.applicationSecurities.securities,
        containerScannedStatus: state.security.containerSecurities.securities,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(SecurityInfo);
