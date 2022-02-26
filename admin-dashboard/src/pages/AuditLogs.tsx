import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'loda... Remove this comment to see the full error message
import * as _ from 'lodash';

import AuditLogsList from '../components/auditLogs/AuditLogsList';
import {
    fetchAuditLogs,
    searchAuditLogs,
    fetchAuditLogStatus,
} from '../actions/auditLogs';

// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';
import AlertPanel from '../components/basic/AlertPanel';
import ShouldRender from '../components/basic/ShouldRender';
class AuditLogs extends React.Component {
    handleKeyBoard: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);

        this.state = {
            searchBox: null,
            page: 1,
        };
    }

    prevClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searchBox' does not exist on type 'Reado... Remove this comment to see the full error message
        const { searchBox } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAuditLogs' does not exist on type '... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searchBox' does not exist on type 'Reado... Remove this comment to see the full error message
        const { searchBox } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAuditLogs' does not exist on type '... Remove this comment to see the full error message
        const { fetchAuditLogs, searchAuditLogs } = this.props;

        if (searchBox && searchBox !== '') {
            searchAuditLogs(searchBox, skip + limit, 10);
        } else {
            fetchAuditLogs(skip + limit, 10);
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page + 1 });
    };

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAuditLogs' does not exist on type '... Remove this comment to see the full error message
        this.props.fetchAuditLogs();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAuditLogStatus' does not exist on t... Remove this comment to see the full error message
        this.props.fetchAuditLogStatus();
    }

    onChange = (e: $TSFixMe) => {
        const value = e.target.value;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searchAuditLogs' does not exist on type ... Remove this comment to see the full error message
        const { searchAuditLogs } = this.props;

        this.setState({ searchBox: value });
        searchAuditLogs(value, 0, 10);
        this.setState({ page: 1 });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'auditLogStatus' does not exist on type '... Remove this comment to see the full error message
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
                                                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
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
                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ auditLogs: any; prevClicked: (skip: any, l... Remove this comment to see the full error message
                                            auditLogs={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'auditLogs' does not exist on type 'Reado... Remove this comment to see the full error message
                                                this.props.auditLogs || {}
                                            }
                                            prevClicked={this.prevClicked}
                                            nextClicked={this.nextClicked}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
                                            userId={this.props.userId}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
                                            requesting={this.props.requesting}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AuditLogs.displayName = 'AuditLogs';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
