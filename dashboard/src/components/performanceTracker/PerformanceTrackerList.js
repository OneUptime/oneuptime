import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { history } from '../../store';

class PerformanceTrackerList extends Component {
    viewMore = () => {
        const { componentSlug, projectSlug, performanceTracker } = this.props;
        history.push(
            `/dashboard/project/${projectSlug}/${componentSlug}/performance-tracker/${performanceTracker.slug}`
        );
    };

    render() {
        const { performanceTracker } = this.props;

        return (
            <div>
                <div
                    className="Box-root Card-shadow--medium"
                    style={{ marginTop: '10px', marginBottom: '10px' }}
                    tabIndex="0"
                >
                    <div>
                        <div className="db-Trends-header">
                            <div className="db-Trends-title">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <div></div>
                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                            <span
                                                id="performance-tracker-content-header"
                                                className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                            >
                                                <span
                                                    id={`performance-tracker-title-${performanceTracker.name}`}
                                                >
                                                    {performanceTracker.name}
                                                </span>
                                            </span>
                                        </div>
                                        <div className="db-Trends-control Flex-justifyContent--flexEnd Flex-flex">
                                            <div>
                                                <button
                                                    id={`more-details-${performanceTracker.name}`}
                                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--more"
                                                    type="button"
                                                    onClick={this.viewMore}
                                                >
                                                    <span>More</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

PerformanceTrackerList.displayName = 'PerformanceTrackerList';

PerformanceTrackerList.propTypes = {
    performanceTracker: PropTypes.object,
    componentSlug: PropTypes.string,
    projectSlug: PropTypes.string,
};
export default connect(null)(PerformanceTrackerList);
