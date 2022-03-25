import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import * as _ from 'lodash';

import AuditLogsList from '../components/auditLogs/AuditLogsList';
import {
    fetchAuditLogs,
    searchAuditLogs,
    fetchAuditLogStatus,
} from '../actions/auditLogs';


import { Link } from 'react-router-dom';
import AlertPanel from '../components/basic/AlertPanel';
import ShouldRender from '../components/basic/ShouldRender';
class AuditLogs extends Component<ComponentProps> {
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

        const { fetchAuditLogs, searchAuditLogs } = this.props;

        if (searchBox && searchBox !== '') {
            searchAuditLogs(
                searchBox,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        } else {
            fetchAuditLogs((skip || 0) > (limit || 10) ? skip - limit : 0, 10);
        }

        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {

        const { searchBox } = this.state;

        const { fetchAuditLogs, searchAuditLogs } = this.props;

        if (searchBox && searchBox !== '') {
            searchAuditLogs(searchBox, skip + limit, 10);
        } else {
            fetchAuditLogs(skip + limit, 10);
        }

        this.setState({ page: this.state.page + 1 });
    };

    override componentDidMount() {

        this.props.fetchAuditLogs();

        this.props.fetchAuditLogStatus();
    }

    onChange = (e: $TSFixMe) => {
        const value = e.target.value;

        const { searchAuditLogs } = this.props;

        this.setState({ searchBox: value });
        searchAuditLogs(value, 0, 10);
        this.setState({ page: 1 });
    };

    override render() {

        const { auditLogStatus } = this.props;
        return (
            <div
                id="oneuptimeAuditLog"
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
                                                                Audit Logs
                                                            </span>
                                                        </span>
                                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                Here is a
                                                                complete list of
                                                                OneUptime logs.
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                        <div className="Box-root">
                                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                <div>
                                                                    <input
                                                                        id="searchAuditLog"
                                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                        placeholder="Search Logs"
                                                                        onChange={_.debounce(
                                                                            this
                                                                                .onChange,
                                                                            500
                                                                        )}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column">
                                                <ShouldRender
                                                    if={
                                                        auditLogStatus.data &&
                                                        !auditLogStatus.data
                                                            .value
                                                    }
                                                >
                                                    <AlertPanel

                                                        className=""
                                                        message={
                                                            <span id="auditLogDisabled">
                                                                You are
                                                                currently not
                                                                storing any
                                                                audit logs at
                                                                the moment.
                                                                Click{' '}
                                                                <Link
                                                                    className="Border-bottom--white Text-fontWeight--bold Text-color--white"
                                                                    to="/admin/settings/audit-logs"
                                                                    id="auditLogSetting"
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
                                        <AuditLogsList

                                            auditLogs={

                                                this.props.auditLogs || {}
                                            }
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


AuditLogs.displayName = 'AuditLogs';

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchAuditLogs,
            searchAuditLogs,
            fetchAuditLogStatus,
        },
        dispatch
    );
};

const mapStateToProps = (state: $TSFixMe) => {
    const auditLogs = state.auditLogs.auditLogs;
    const searchAuditLogs = state.auditLogs.searchAuditLogs;
    const requesting =
        auditLogs && searchAuditLogs
            ? auditLogs.requesting || searchAuditLogs.requesting
                ? true
                : false
            : false;
    const auditLogStatus = state.auditLogs.auditLogStatus;
    const changeAuditLogStatus = state.auditLogs.changeAuditLogStatus;
    return {
        auditLogs,
        requesting,
        auditLogStatus,
        changeAuditLogStatus,
    };
};


AuditLogs.propTypes = {
    fetchAuditLogs: PropTypes.func.isRequired,
    searchAuditLogs: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    auditLogs: PropTypes.object,
    userId: PropTypes.string,
    fetchAuditLogStatus: PropTypes.func.isRequired,
    auditLogStatus: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(AuditLogs);
