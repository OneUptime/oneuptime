import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { history } from '../../store';
import LogList from './LogList';
import DateRangeWrapper from '../monitor/DateRangeWrapper';
import moment from 'moment';
import { RenderIfOwner } from '../basic/RenderIfOwner';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

class ApplicationLogDetail extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            startDate: moment().subtract(30, 'd'),
            endDate: moment(),
            deleting: false,
        };
    }
    handleDateChange = (startDate, endDate) => {
        this.setState({ startDate, endDate });
    };
    render() {
        const { startDate, endDate, deleting } = this.state;
        const { applicationLog, componentId, currentProject } = this.props;
        if (applicationLog) {
            return (
                <div
                    className="Box-root Card-shadow--medium"
                    style={{ marginTop: '10px', marginBottom: '10px' }}
                    tabIndex="0"
                >
                    <div className="db-Trends-header">
                        <div className="db-Trends-title">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <span
                                            id="monitor-content-header"
                                            className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                        >
                                            <span
                                                id={`application-log-title-${applicationLog.name}`}
                                            >
                                                {applicationLog.name}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="db-Trends-controls">
                            <div className="db-Trends-timeControls">
                                <DateRangeWrapper
                                    selected={startDate}
                                    onChange={this.handleDateChange}
                                    dateRange={30}
                                />
                            </div>
                            <div>
                                {this.props.isDetails ? (
                                    <div>
                                        <button
                                            id={`delete_${applicationLog.name}`}
                                            className={
                                                deleting
                                                    ? 'bs-Button bs-Button--blue'
                                                    : 'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete'
                                            }
                                            type="button"
                                            disabled={deleting}
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
                                        onClick={() => {
                                            history.push(
                                                '/dashboard/project/' +
                                                    currentProject._id +
                                                    '/' +
                                                    componentId +
                                                    '/application-log/' +
                                                    applicationLog._id
                                            );
                                        }}
                                    >
                                        <span>More</span>
                                    </button>
                                )}
                            </div>
                        </div>
                        <div>
                            <div className="db-RadarRulesLists-page">
                                <div className="Box-root Margin-bottom--12">
                                    <div className="">
                                        <div className="Box-root">
                                            <div>
                                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"></span>
                                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Here&apos;s
                                                                    a list of
                                                                    recent logs
                                                                    which belong
                                                                    to this
                                                                    application
                                                                    log.
                                                                </span>
                                                            </span>
                                                        </div>
                                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                            <div></div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <LogList
                                                    logs={applicationLog}
                                                    componentId={componentId}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        } else {
            return null;
        }
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
