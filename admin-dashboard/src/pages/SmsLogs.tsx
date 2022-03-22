import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';

import SmsLogsList from '../components/smsLogs/SmsLogsList';
import {
    fetchSmsLogs,
    searchSmsLogs,
    fetchSmsLogStatus,
} from '../actions/smsLogs';


import { Link } from 'react-router-dom';
import AlertPanel from '../components/basic/AlertPanel';
import ShouldRender from '../components/basic/ShouldRender';
class SmsLogs extends React.Component {
    handleKeyBoard: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);

        this.state = {
            searchBox: null,
            page: 1,
        };
    }

    prevClicked = (skip: $TSFixMe, limit: $TSFixMe) => {

        const { searchBox } = this.state;

        const { fetchSmsLogs, searchSmsLogs } = this.props;

        if (searchBox && searchBox !== '') {
            searchSmsLogs(
                searchBox,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        } else {
            fetchSmsLogs((skip || 0) > (limit || 10) ? skip - limit : 0, 10);
        }

        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {

        const { searchBox } = this.state;

        const { fetchSmsLogs, searchSmsLogs } = this.props;

        if (searchBox && searchBox !== '') {
            searchSmsLogs(searchBox, skip + limit, 10);
        } else {
            fetchSmsLogs(skip + limit, 10);
        }

        this.setState({ page: this.state.page + 1 });
    };

    componentDidMount = () => {

        this.props.fetchSmsLogs();

        this.props.fetchSmsLogStatus();
    };

    onChange = (e: $TSFixMe) => {
        const value = e.target.value;

        const { searchSmsLogs } = this.props;

        this.setState({ searchBox: value });
        searchSmsLogs(value, 0, 10);
        this.setState({ page: 1 });
    };

    render() {

        const { smsLogStatus } = this.props;
        return (
            <div
                id="oneuptimeSmsLog"
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
                                                                SMS Logs
                                                            </span>
                                                        </span>
                                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                Here is a
                                                                complete list of
                                                                SMS logs.
                                                            </span>
                                                        </span>
                                                    </div>
                                                    {/* <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                            <div className="Box-root">
                                                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                    <div>
                                                                        <input
                                                                            id="searchSmsLog"
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
                                                        smsLogStatus.data &&
                                                        !smsLogStatus.data.value
                                                    }
                                                >
                                                    <AlertPanel

                                                        className=""
                                                        message={
                                                            <span id="smsLogDisabled">
                                                                You are
                                                                currently not
                                                                storing any sms
                                                                logs at the
                                                                moment. Click{' '}
                                                                <Link
                                                                    className="Border-bottom--white Text-fontWeight--bold Text-color--white"
                                                                    to="/admin/settings/sms-logs"
                                                                    id="smsLogSetting"
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
                                        <SmsLogsList

                                            smsLogs={this.props.smsLogs || {}}
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


SmsLogs.displayName = 'SmsLogs';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            fetchSmsLogs,
            searchSmsLogs,
            fetchSmsLogStatus,
        },
        dispatch
    );
};

const mapStateToProps = (state: $TSFixMe) => {
    const smsLogs = state.smsLogs.smsLogs;
    const searchSmsLogs = state.smsLogs.searchSmsLogs;
    const requesting =
        smsLogs && searchSmsLogs
            ? smsLogs.requesting || searchSmsLogs.requesting
                ? true
                : false
            : false;
    const smsLogStatus = state.smsLogs.smsLogStatus;
    const changeSmsLogStatus = state.smsLogs.changeSmsLogStatus;
    return {
        smsLogs,
        requesting,
        smsLogStatus,
        changeSmsLogStatus,
    };
};


SmsLogs.propTypes = {
    fetchSmsLogs: PropTypes.func.isRequired,
    searchSmsLogs: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    smsLogs: PropTypes.object,
    userId: PropTypes.string,
    fetchSmsLogStatus: PropTypes.func.isRequired,
    smsLogStatus: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(SmsLogs);
