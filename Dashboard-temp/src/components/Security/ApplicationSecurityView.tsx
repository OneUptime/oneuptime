import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import ConfirmScanModal from '../modals/ConfirmScanModal';
import { openModal } from 'common-ui/actions/modal';
import SecurityDetail from './SecurityDetail';
import Badge from '../common/Badge';
import IssueIndicator from './IssueIndicator';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import EditApplicationSecurity from '../modals/EditApplicationSecurity';
import threatLevel from '../../utils/threatLevel';

interface ApplicationSecurityViewProps {
    isRequesting?: boolean;
    applicationSecurityId?: string;
    applicationSecuritySlug?: string;
    projectId?: string;
    componentId?: string;
    componentSlug?: string;
    openModal?: Function;
    securityLog?: object;
    scanning?: boolean;
    applicationSecurity?: object;
    scanError?: string;
    activeApplicationSecurity?: string;
    scannedStatus?: string;
}

const ApplicationSecurityView = ({
    isRequesting,
    applicationSecurityId,
    applicationSecuritySlug,
    projectId,
    componentId,
    componentSlug,
    openModal,
    securityLog,
    scanning,
    applicationSecurity,
    scanError,
    activeApplicationSecurity,
    scannedStatus
}: ApplicationSecurityViewProps) => {
    const handleSubmit = ({
        projectId,
        applicationSecurityId
    }: $TSFixMe) => {
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
    };

    const handleEdit = ({
        projectId,
        componentId,
        applicationSecurityId,
        applicationSecuritySlug,
        componentSlug
    }: $TSFixMe) => {
        openModal({
            id: applicationSecurityId,
            content: EditApplicationSecurity,
            propArr: [
                {
                    projectId,
                    componentId,
                    applicationSecurityId,
                    applicationSecuritySlug,
                    componentSlug,
                },
            ],
        });
    };

    const status = securityLog.data
        ? threatLevel(securityLog.data.vulnerabilities)
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
                                            id={`applicationSecurityHeader_${applicationSecurity.name}`}
                                            className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                        >
                                            <IssueIndicator status={status} />
                                            <span
                                                id={`applicationSecurityTitle_${applicationSecurity.name}`}
                                                style={{
                                                    textTransform: 'capitalize',
                                                }}
                                            >
                                                {applicationSecurity.name}
                                            </span>
                                        </span>
                                    </div>
                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                        <ShouldRender
                                            if={
                                                applicationSecurity &&
                                                applicationSecurity.resourceCategory
                                            }
                                        >
                                            <div className="Box-root Padding-right--8">
                                                <Badge
                                                    id={`${applicationSecurity.name}-badge`}
                                                    color={'slate5'}
                                                >
                                                    {applicationSecurity &&
                                                        applicationSecurity.resourceCategory
                                                        ? applicationSecurity
                                                            .resourceCategory
                                                            .name
                                                        : ''}
                                                </Badge>
                                            </div>
                                        </ShouldRender>
                                        <div className="Box-root">
                                            <Badge color={'green'}>
                                                Application Security
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
                                        if={applicationSecurity.lastScan}
                                    >
                                        <label className="Text-fontWeight--medium">
                                            Last Scan:
                                        </label>
                                        <div className="Margin-left--2">
                                            <span className="value">{`${moment(
                                                applicationSecurity.lastScan
                                            ).fromNow()} (${moment(
                                                applicationSecurity.lastScan
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
                                        if={applicationSecurity.lastScan}
                                    >
                                        <label className="Text-fontWeight--medium">
                                            Next Scan:
                                        </label>
                                        <div className="Margin-left--2">
                                            <span className="value">{`${moment(
                                                applicationSecurity.lastScan
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
                                            String(applicationSecurityId) ===
                                            String(
                                                activeApplicationSecurity
                                            )) ||
                                        applicationSecurity.scanning ||
                                        !applicationSecurity.lastScan ||
                                        scannedStatus === false
                                    }
                                >
                                    <button
                                        className="bs-Button bs-DeprecatedButton"
                                        disabled={
                                            scanning ||
                                            applicationSecurity.scanning ||
                                            !applicationSecurity.lastScan ||
                                            scannedStatus === false
                                        }
                                        id={`scanning_${applicationSecurity.name}`}
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
                                            String(applicationSecurityId) !==
                                            String(
                                                activeApplicationSecurity
                                            )) &&
                                        !applicationSecurity.scanning &&
                                        applicationSecurity.lastScan &&
                                        scannedStatus === true
                                    }
                                >
                                    <button
                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--security-scan"
                                        type="button"
                                        onClick={() =>
                                            handleSubmit({
                                                projectId,
                                                applicationSecurityId,
                                            })
                                        }
                                        disabled={
                                            scanning &&
                                            String(applicationSecurityId) ===
                                            String(
                                                activeApplicationSecurity
                                            )
                                        }
                                        id={`scan_${applicationSecurity.name}`}
                                    >
                                        <span>Scan</span>
                                    </button>
                                </ShouldRender>
                                <button
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                    type="button"
                                    onClick={() =>
                                        handleEdit({
                                            projectId,
                                            componentId,
                                            applicationSecurityId,
                                            applicationSecuritySlug,
                                            componentSlug,
                                        })
                                    }
                                    id={`edit_${applicationSecurity.name}`}
                                >
                                    <span>Edit</span>
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
                                    applicationSecurityLog={securityLog}
                                    type="application"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                        <div className="bs-Tail-copy">
                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                <ShouldRender
                                    if={
                                        !isRequesting &&
                                        scanError &&
                                        String(applicationSecurityId) ===
                                        String(activeApplicationSecurity)
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

ApplicationSecurityView.displayName = 'Application Security View';

ApplicationSecurityView.propTypes = {
    isRequesting: PropTypes.bool,
    applicationSecurityId: PropTypes.string,
    applicationSecuritySlug: PropTypes.string,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    openModal: PropTypes.func,
    securityLog: PropTypes.object,
    scanning: PropTypes.bool,
    applicationSecurity: PropTypes.object,
    scanError: PropTypes.string,
    activeApplicationSecurity: PropTypes.string,
    scannedStatus: PropTypes.string,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
    },
    dispatch
);

const mapStateToProps = (state: RootState) => {
    return {
        isRequesting: state.security.deleteApplication.requesting,
        securityLog: state.security.applicationSecurityLog || {},
        scanning: state.security.scanApplicationSecurity.requesting,
        scanError: state.security.scanApplicationSecurity.error,
        activeApplicationSecurity: state.security.activeApplicationSecurity,
        scannedStatus: state.security.applicationSecurity.scanned,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ApplicationSecurityView);
