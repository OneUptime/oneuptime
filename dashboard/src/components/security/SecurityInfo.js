import React, { Fragment } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { history } from '../../store';
import SecurityDetail from './SecurityDetail';
import IssueIndicator from './IssueIndicator';
import Badge from '../common/Badge';

const SecurityInfo = ({
    name,
    projectId,
    componentId,
    type,
    containerSecurityId,
    applicationSecurityId,
}) => {
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
                                        className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                    >
                                        <IssueIndicator status={1} />
                                        <span id={`monitor-title-${name}`}>
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
                    <div className="bs-u-flex Flex-wrap--wrap bs-u-justify--end">
                        <div>
                            <button
                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--eye"
                                type="button"
                                onClick={() => {}}
                            >
                                <span>Scan</span>
                            </button>
                            <button
                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--help"
                                type="button"
                                onClick={() => {
                                    const securityId =
                                        containerSecurityId ||
                                        applicationSecurityId;

                                    type =
                                        (type === 'container' && 'container') ||
                                        (type === 'application' &&
                                            'application');

                                    history.push(
                                        `/dashboard/project/${projectId}/${componentId}/security/${type}/${securityId}`
                                    );
                                }}
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
        </Fragment>
    );
};

SecurityInfo.displayName = 'SecurityInfo';

SecurityInfo.propTypes = {
    name: PropTypes.string,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    type: PropTypes.string.isRequired,
    containerSecurityId: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    applicationSecurityId: PropTypes.string,
};

export default connect(null, null)(SecurityInfo);
