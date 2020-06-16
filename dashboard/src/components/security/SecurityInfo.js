import React, { Fragment } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import { history } from '../../store';
import SecurityDetail from './SecurityDetail';
import IssueIndicator from './IssueIndicator';
import Badge from '../common/Badge';
import {
    scanApplicationSecurity,
    scanContainerSecurity,
} from '../../actions/security';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

const SecurityInfo = ({
    name,
    projectId,
    componentId,
    type,
    applicationSecurityId,
    applicationSecurityLog,
    scanApplicationSecurity,
    scanningApplication,
    containerSecurityId,
    containerSecurityLog,
    scanContainerSecurity,
    scanningContainer,
    applicationSecurities,
    containerSecurities,
}) => {
    const scanSecurity = () => {
        if (applicationSecurityId) {
            scanApplicationSecurity({
                projectId,
                applicationSecurityId,
            });
        }

        if (containerSecurityId) {
            scanContainerSecurity({ projectId, containerSecurityId });
        }
    };

    const more = () => {
        const securityId = containerSecurityId || applicationSecurityId;

        type =
            (type === 'container' && 'container') ||
            (type === 'application' && 'application');

        history.push(
            `/dashboard/project/${projectId}/${componentId}/security/${type}/${securityId}`
        );
    };

    const getSecurityInfo = () => {
        let security = null;
        if (applicationSecurityId) {
            applicationSecurities.map(applicationSecurity => {
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
            containerSecurities.map(containerSecurity => {
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

    return (
        <Fragment>
            <div className="Box-root">
                <div className="db-Trends-header">
                    <div className="db-Trends-title">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span
                                        id="monitor-content-header"
                                        className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                    >
                                        <IssueIndicator status={1} />
                                        <span
                                            id={`monitor-title-${name}`}
                                            style={{
                                                textTransform: 'capitalize',
                                            }}
                                        >
                                            {name}
                                        </span>
                                    </span>
                                </div>
                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
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
                        <div className="bs-Fieldset-row" style={{ padding: 0 }}>
                            <label className="Text-fontWeight--medium">
                                Last Scan:
                            </label>
                            <ShouldRender if={getSecurityInfo().lastScan}>
                                <div className="Margin-left--2">
                                    <span className="value">{`${moment(
                                        getSecurityInfo().lastScan
                                    ).fromNow()} (${moment(
                                        getSecurityInfo().lastScan
                                    ).format(
                                        'MMMM Do YYYY, h:mm:ss a'
                                    )})`}</span>
                                </div>
                            </ShouldRender>
                            <ShouldRender if={!getSecurityInfo().lastScan}>
                                <div className="Margin-left--2">
                                    <span>will display soon</span>
                                </div>
                            </ShouldRender>
                        </div>
                        <div>
                            <ShouldRender
                                if={
                                    (applicationSecurityId &&
                                        scanningApplication) ||
                                    (containerSecurityId && scanningContainer)
                                }
                            >
                                <button
                                    className="bs-Button bs-DeprecatedButton"
                                    disabled={
                                        (applicationSecurityId &&
                                            scanningApplication) ||
                                        (containerSecurityId &&
                                            scanningContainer)
                                    }
                                >
                                    <Spinner style={{ stroke: '#8898aa' }} />
                                    <span>Scanning</span>
                                </button>
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    (applicationSecurityId &&
                                        !scanningApplication) ||
                                    (containerSecurityId && !scanningContainer)
                                }
                            >
                                <button
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--eye"
                                    type="button"
                                    onClick={scanSecurity}
                                >
                                    <span>Scan</span>
                                </button>
                            </ShouldRender>
                            <button
                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--help"
                                type="button"
                                onClick={more}
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
                            />
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                    <div className="bs-Tail-copy">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"></div>
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
    componentId: PropTypes.string,
    type: PropTypes.string.isRequired,
    applicationSecurityId: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    applicationSecurityLog: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    scanApplicationSecurity: PropTypes.func,
    scanningApplication: PropTypes.bool,
    containerSecurityId: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    containerSecurityLog: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    scanContainerSecurity: PropTypes.func,
    scanningContainer: PropTypes.bool,
    containerSecurities: PropTypes.array,
    applicationSecurities: PropTypes.array,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { scanApplicationSecurity, scanContainerSecurity },
        dispatch
    );

const mapStateToProps = state => {
    return {
        scanningApplication: state.security.scanApplicationSecurity.requesting,
        scanningContainer: state.security.scanContainerSecurity.requesting,
        applicationSecurities: state.security.applicationSecurities,
        containerSecurities: state.security.containerSecurities,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(SecurityInfo);
