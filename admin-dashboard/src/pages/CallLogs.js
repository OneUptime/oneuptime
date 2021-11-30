import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';

import CallLogsList from '../components/callLogs/CallLogsList';
import {
    fetchCallLogs,
    searchCallLogs,
    fetchCallLogStatus,
} from '../actions/callLogs';

import { Link } from 'react-router-dom';
import AlertPanel from '../components/basic/AlertPanel';
import ShouldRender from '../components/basic/ShouldRender';
class CallLogs extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            searchBox: null,
            page: 1,
        };
    }

    prevClicked = (skip, limit) => {
        const { searchBox } = this.state;
        const { fetchCallLogs, searchCallLogs } = this.props;

        if (searchBox && searchBox !== '') {
            searchCallLogs(
                searchBox,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        } else {
            fetchCallLogs((skip || 0) > (limit || 10) ? skip - limit : 0, 10);
        }
        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip, limit) => {
        const { searchBox } = this.state;
        const { fetchCallLogs, searchCallLogs } = this.props;

        if (searchBox && searchBox !== '') {
            searchCallLogs(searchBox, skip + limit, 10);
        } else {
            fetchCallLogs(skip + limit, 10);
        }
        this.setState({ page: this.state.page + 1 });
    };

    componentDidMount() {
        this.props.fetchCallLogs();
        this.props.fetchCallLogStatus();
    }

    onChange = e => {
        const value = e.target.value;
        const { searchCallLogs } = this.props;

        this.setState({ searchBox: value });
        searchCallLogs(value, 0, 10);
        this.setState({ page: 1 });
    };

    render() {
        const { callLogStatus } = this.props;
        return (
            <div
                id="oneuptimeCallLog"
                onKeyDown={this.handleKeyBoard}
                className="Box-root Margin-vertical--12"
            >
                <div>
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div
                                className="customers-list-view react-view popover-container"
                                style={{
                                    position: 'relative',
                                    overflow: 'visible',
                                }}
                            ></div>
                            <div className="bs-BIM">
                                <div className="Box-root Margin-bottom--12">
                                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                                        <div className="Box-root">
                                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                            <span
                                                                style={{
                                                                    textTransform:
                                                                        'capitalize',
                                                                }}
                                                            >
                                                                Call Logs
                                                            </span>
                                                        </span>
                                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                Here is a
                                                                complete list of
                                                                Call logs.
                                                            </span>
                                                        </span>
                                                    </div>
                                                    {/* <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                            <div className="Box-root">
                                                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                    <div>
                                                                        <input
                                                                            id="searchCallLog"
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            placeholder="Search Logs"
                                                                            onChange={
                                                                                this
                                                                                    .onChange
                                                                            }
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div> */}
                                                </div>
                                            </div>
                                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column">
                                                <ShouldRender
                                                    if={
                                                        callLogStatus.data &&
                                                        !callLogStatus.data
                                                            .value
                                                    }
                                                >
                                                    <AlertPanel
                                                        className=""
                                                        message={
                                                            <span id="callLogDisabled">
                                                                You are
                                                                currently not
                                                                storing any call
                                                                logs at the
                                                                moment. Click{' '}
                                                                <Link
                                                                    className="Border-bottom--white Text-fontWeight--bold Text-color--white"
                                                                    to="/admin/settings/call-logs"
                                                                    id="callLogSetting"
                                                                >
                                                                    here
                                                                </Link>{' '}
                                                                to turn it on.
                                                            </span>
                                                        }
                                                    />
                                                </ShouldRender>
                                            </div>
                                        </div>
                                        <CallLogsList
                                            callLogs={this.props.callLogs || {}}
                                            prevClicked={this.prevClicked}
                                            nextClicked={this.nextClicked}
                                            userId={this.props.userId}
                                            requesting={this.props.requesting}
                                            page={this.state.page}
                                        />
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

CallLogs.displayName = 'CallLogs';

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchCallLogs,
            searchCallLogs,
            fetchCallLogStatus,
        },
        dispatch
    );
};

const mapStateToProps = state => {
    const callLogs = state.callLogs.callLogs;
    const searchCallLogs = state.callLogs.searchCallLogs;
    const requesting =
        callLogs && searchCallLogs
            ? callLogs.requesting || searchCallLogs.requesting
                ? true
                : false
            : false;
    const callLogStatus = state.callLogs.callLogStatus;
    const changeCallLogStatus = state.callLogs.changeCallLogStatus;
    return {
        callLogs,
        requesting,
        callLogStatus,
        changeCallLogStatus,
    };
};
CallLogs.propTypes = {
    fetchCallLogs: PropTypes.func.isRequired,
    searchCallLogs: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    callLogs: PropTypes.object,
    userId: PropTypes.string,
    fetchCallLogStatus: PropTypes.func.isRequired,
    callLogStatus: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(CallLogs);
