import React from 'react';
import { metricsQuickStart } from '../../config';
import PropTypes from 'prop-types';
import AceCodeEditor from '../basic/AceCodeEditor';

const QuickStart = ({ appId, appKey, close }) => {
    const guide = metricsQuickStart(appId, appKey)[0];
    return (
        <div tabIndex="0" className="Box-root Margin-vertical--12">
            <div className="db-Trends bs-ContentSection Card-root Card-shadow--medium">
                <div
                    className="Box-root"
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                    }}
                >
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-lineHeight--28">
                                <span> Quick Start </span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"></span>
                        </div>
                    </div>
                    <div className="bs-ContentSection-content Box-root Padding-horizontal--20 Padding-vertical--16">
                        <span
                            className="incident-close-button"
                            onClick={close}
                        ></span>
                    </div>
                </div>
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-direction--column ">
                        <div>
                            <span className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-lineHeight--28 Padding-horizontal--20">
                                <span>
                                    {' '}
                                    {guide.performanceTracker.installation
                                        ? guide.performanceTracker.installation
                                              .package
                                        : ''}
                                </span>
                            </span>

                            <div>
                                <AceCodeEditor
                                    value={
                                        guide.performanceTracker.installation
                                            ? guide.performanceTracker
                                                  .installation.command
                                            : ''
                                    }
                                    name={`quickstart-command`}
                                    readOnly={true}
                                    language={'markdown'}
                                    height={guide.height.install}
                                />
                            </div>
                            <span className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-lineHeight--28 Padding-horizontal--20">
                                <span>{'Usage'}</span>
                            </span>
                            <div>
                                <AceCodeEditor
                                    value={
                                        guide.performanceTracker.usage
                                            ? guide.performanceTracker.usage
                                            : ''
                                    }
                                    name={`quickstart`}
                                    readOnly={true}
                                    mode="javascript"
                                    height={guide.height.usage}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

QuickStart.displayName = 'QuickStart';
QuickStart.propTypes = {
    close: PropTypes.func,
    appId: PropTypes.string,
    appKey: PropTypes.string,
};
export default QuickStart;
