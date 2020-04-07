import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';

import AuditLogsList from '../components/auditLogs/AuditLogsList';
import { fetchAuditLogs, searchAuditLogs } from '../actions/auditLogs';
import Dashboard from '../components/Dashboard';

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
    };

    onChange = e => {
        const value = e.target.value;
        const { searchAuditLogs } = this.props;

        this.setState({ searchBox: value });
        searchAuditLogs(value, 0, 10);
    };

    render() {
        return (
            <Dashboard ready={this.ready}>
                <div
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
                                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
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
    return bindActionCreators({ fetchAuditLogs, searchAuditLogs }, dispatch);
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

    return {
        auditLogs,
        requesting,
    };
};

AuditLogs.propTypes = {
    fetchAuditLogs: PropTypes.func.isRequired,
    searchAuditLogs: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    auditLogs: PropTypes.object,
    userId: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(AuditLogs);
