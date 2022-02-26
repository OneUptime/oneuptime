import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import { AlertTableRows, AlertTableHeader } from '../alert/AlertTable';
import { ListLoader } from '../basic/Loader';

export class IncidentAlert extends Component {
    render() {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.alerts &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
            this.props.count &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
            typeof this.props.count === 'string'
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
            this.props.count = parseInt(this.props.count, 10);
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            this.props.skip &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            typeof this.props.skip === 'string'
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            this.props.skip = parseInt(this.props.skip, 10);
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'limit' does not exist on type 'Readonly<... Remove this comment to see the full error message
            this.props.limit &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'limit' does not exist on type 'Readonly<... Remove this comment to see the full error message
            typeof this.props.limit === 'string'
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'limit' does not exist on type 'Readonly<... Remove this comment to see the full error message
            this.props.limit = parseInt(this.props.limit, 10);
        }
        let canNext =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.alerts &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
            this.props.count &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
            this.props.count > this.props.skip + this.props.limit
                ? true
                : false;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
        let canPrev = this.props.alerts && this.props.skip <= 0 ? false : true;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
        if (this.props.alerts && this.props.isRequesting) {
            canNext = false;
            canPrev = false;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const numberOfPages = Math.ceil(parseInt(this.props.count) / 10);
        return (
            <div className="db-RadarRulesLists-page">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root" id="TeamAlertLogBox">
                            <div>
                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                <span>Team Alert Log</span>
                                            </span>
                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    Here&#39;s a log of all the
                                                    alerts that were sent to
                                                    your team for this incident.
                                                </span>
                                            </span>
                                        </div>
                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                            <div></div>
                                        </div>
                                    </div>
                                </div>
                                <div
                                    style={{
                                        overflow: 'hidden',
                                        overflowX: 'auto',
                                    }}
                                >
                                    <table className="Table">
                                        <thead className="Table-body">
                                            <AlertTableHeader />
                                        </thead>
                                        <tbody className="Table-body">
                                            <AlertTableRows
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
                                                alerts={this.props.alerts}
                                                isRequesting={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.isRequesting
                                                }
                                            />
                                        </tbody>
                                    </table>
                                </div>
                                <ShouldRender
                                    if={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                                        !this.props.isRequesting &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
                                        this.props.alerts.length === 0
                                    }
                                >
                                    <div
                                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                        style={{
                                            textAlign: 'center',
                                            marginTop: '20px',
                                            padding: '0 10px',
                                        }}
                                    >
                                        There are no alerts at this time!
                                    </div>
                                </ShouldRender>

                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                                <ShouldRender if={this.props.isRequesting}>
                                    <ListLoader />
                                </ShouldRender>

                                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                    <ShouldRender if={!this.props.error}>
                                        <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        {numberOfPages > 0
                                                            ? `Page ${
                                                                  this.props
                                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                      .page
                                                              } of ${numberOfPages} 
                                                        (${
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                            this.props.count
                                                        } Alert${
                                                                  this.props
                                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
                                                                      .alerts
                                                                      .length ===
                                                                  1
                                                                      ? ''
                                                                      : 's'
                                                              })`
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                            : this.props.count +
                                                              ' Alert' +
                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
                                                              (this.props.alerts
                                                                  .length === 1
                                                                  ? ''
                                                                  : 's')}
                                                    </span>
                                                </span>
                                            </span>
                                        </div>
                                    </ShouldRender>
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                    <ShouldRender if={this.props.error}>
                                        <div
                                            className="bs-Tail-copy"
                                            style={{ padding: '10px' }}
                                        >
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{
                                                    textAlign: 'center',
                                                    marginTop: '10px',
                                                    padding: '0 10px',
                                                }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                        {this.props.error}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                            <div className="Box-root Margin-right--8">
                                                <button
                                                    onClick={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'previous' does not exist on type 'Readon... Remove this comment to see the full error message
                                                        this.props.previous
                                                    }
                                                    className={
                                                        'Button bs-ButtonLegacy' +
                                                        (canPrev
                                                            ? ''
                                                            : 'Is--disabled')
                                                    }
                                                    disabled={!canPrev}
                                                    data-db-analytics-name="list_view.pagination.previous"
                                                    type="button"
                                                >
                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                            <span>
                                                                Previous
                                                            </span>
                                                        </span>
                                                    </div>
                                                </button>
                                            </div>
                                            <div className="Box-root">
                                                <button
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'next' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                    onClick={this.props.next}
                                                    className={
                                                        'Button bs-ButtonLegacy' +
                                                        (canNext
                                                            ? ''
                                                            : 'Is--disabled')
                                                    }
                                                    disabled={!canNext}
                                                    data-db-analytics-name="list_view.pagination.next"
                                                    type="button"
                                                >
                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                            <span>Next</span>
                                                        </span>
                                                    </div>
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
IncidentAlert.displayName = 'IncidentAlert';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({}, dispatch);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        alerts: state.alert.incidentalerts.data,
        isRequesting: state.alert.incidentalerts.requesting,
        count: state.alert.incidentalerts.count,
        skip: state.alert.incidentalerts.skip,
        limit: state.alert.incidentalerts.limit,
        error: state.alert.incidentalerts.error,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
IncidentAlert.propTypes = {
    page: PropTypes.number,
    previous: PropTypes.func.isRequired,
    isRequesting: PropTypes.bool,
    alerts: PropTypes.array,
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'PropTypes' does not exist on type 'typeo... Remove this comment to see the full error message
    count: PropTypes.PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired,
    ]),
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'PropTypes' does not exist on type 'typeo... Remove this comment to see the full error message
    skip: PropTypes.PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired,
    ]),
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'PropTypes' does not exist on type 'typeo... Remove this comment to see the full error message
    limit: PropTypes.PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired,
    ]),
    incidents: PropTypes.array,
    next: PropTypes.func.isRequired,
    error: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentAlert);
