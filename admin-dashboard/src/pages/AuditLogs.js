import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';

import AuditLogsList from '../components/auditLogs/AuditLogsList';
import {
    fetchAuditLogs,
    searchAuditLogs,
    fetchAuditLogStatus,
    auditLogStatusChange,
} from '../actions/auditLogs';
import Dashboard from '../components/Dashboard';
import { ListLoader } from '../components/basic/Loader';
class AuditLogs extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            searchBox: null,
        };
    }

    prevClicked = (skip, limit) => {
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
    };

    nextClicked = (skip, limit) => {
        const { searchBox } = this.state;
        const { fetchAuditLogs, searchAuditLogs } = this.props;

        if (searchBox && searchBox !== '') {
            searchAuditLogs(searchBox, skip + limit, 10);
        } else {
            fetchAuditLogs(skip + limit, 10);
        }
    };

    ready = () => {
        this.props.fetchAuditLogs();
        this.props.fetchAuditLogStatus();
    };

    onChange = e => {
        const value = e.target.value;
        const { searchAuditLogs } = this.props;

        this.setState({ searchBox: value });
        searchAuditLogs(value, 0, 10);
    };
    handleCheckChange = checked => {
        const { auditLogStatus, auditLogStatusChange } = this.props;
        checked.persist();
        auditLogStatusChange({
            status: !auditLogStatus.data.value,
        });
    };

    render() {
        const { auditLogStatus, changeAuditLogStatus } = this.props;
        return (
            <Dashboard ready={this.ready}>
                <div
                    id="fyipeAuditLog"
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
                                                                    complete
                                                                    list of
                                                                    Fyipe logs.
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
                                                                            onChange={
                                                                                this
                                                                                    .onChange
                                                                            }
                                                                        />
                                                                    </div>
                                                                </div>
                                                                {auditLogStatus.data ? (
                                                                    <div className="Flex-flex Flex-justifyContent--flexEnd Flex-alignItems--center Margin-vertical--8">
                                                                        <label
                                                                            id="toggle-label-title"
                                                                            className="Margin-right--8"
                                                                        >
                                                                            {auditLogStatus
                                                                                .data
                                                                                .value
                                                                                ? `Disable `
                                                                                : 'Enable '}
                                                                            Audit
                                                                            Logs
                                                                        </label>
                                                                        <div>
                                                                            <label className="Toggler-wrap">
                                                                                <input
                                                                                    className="btn-toggler"
                                                                                    type="checkbox"
                                                                                    onChange={
                                                                                        this
                                                                                            .handleCheckChange
                                                                                    }
                                                                                    name="auditStatusToggler"
                                                                                    id="auditStatusToggler"
                                                                                    checked={
                                                                                        auditLogStatus
                                                                                            .data
                                                                                            .value
                                                                                    }
                                                                                    disabled={
                                                                                        changeAuditLogStatus.requesting
                                                                                    }
                                                                                />
                                                                                <span className="TogglerBtn-slider round"></span>
                                                                            </label>
                                                                        </div>
                                                                    </div>
                                                                ) : null}
                                                                {this.props
                                                                    .changeAuditLogStatus
                                                                    .requesting ? (
                                                                    <ListLoader />
                                                                ) : changeAuditLogStatus.error ? (
                                                                    <div className="Flex-flex Flex-justifyContent--flexEnd Flex-alignItems--center Margin-vertical--8">
                                                                        <span
                                                                            style={{
                                                                                color:
                                                                                    'red',
                                                                            }}
                                                                        >
                                                                            {
                                                                                changeAuditLogStatus.error
                                                                            }
                                                                        </span>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                    <div></div>
                                                </div>
                                            </div>
                                            <AuditLogsList
                                                auditLogs={
                                                    this.props.auditLogs || {}
                                                }
                                                prevClicked={this.prevClicked}
                                                nextClicked={this.nextClicked}
                                                userId={this.props.userId}
                                                requesting={
                                                    this.props.requesting
                                                }
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

AuditLogs.displayName = 'AuditLogs';

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchAuditLogs,
            searchAuditLogs,
            fetchAuditLogStatus,
            auditLogStatusChange,
        },
        dispatch
    );
};

const mapStateToProps = state => {
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
    changeAuditLogStatus: PropTypes.object,
    auditLogStatusChange: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(AuditLogs);
