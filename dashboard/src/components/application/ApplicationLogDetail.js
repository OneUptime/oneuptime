import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { history } from '../../store';

class ApplicationLogDetail extends Component {
    render() {
        const { applicationLog, componentId, currentProject } = this.props;
        return (
            <div className="Box-root Card-shadow--medium" tabIndex="0">
                <div className="db-Trends-header">
                    <div className="db-Trends-title">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span
                                        id="monitor-content-header"
                                        className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                        style={{ display: 'flex', justifyContent: 'space-between'}}
                                    >
                                        <span
                                            id={`application-log-title-${applicationLog.name}`}
                                        >
                                            {applicationLog.name}
                                        </span>
                                        <button
                                            id={`more-details-${applicationLog.name}`}
                                            className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--help"
                                            type="button"
                                            onClick={() => {
                                                history.push(
                                                    '/dashboard/project/' +
                                                        currentProject._id +
                                                        '/' +
                                                        componentId +
                                                        '/monitoring/' +
                                                        applicationLog._id
                                                );
                                            }}
                                        >
                                            <span>More</span>
                                        </button>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="db-Trends-controls">
                        <div></div>
                    </div>
                </div>
            </div>
        );
    }
}
ApplicationLogDetail.displayName = 'ApplicationLogDetail';

function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject,
    };
}

ApplicationLogDetail.propTypes = {
    componentId: PropTypes.object.isRequired,
    applicationLog: PropTypes.object.isRequired,
    currentProject: PropTypes.object.isRequired,
};

export default connect(mapStateToProps)(ApplicationLogDetail);
