import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import { AlertTableRows, AlertTableHeader } from '../alert/AlertTable';
import { ListLoader } from '../basic/Loader';

export class IncidentAlert extends Component {
    render() {
        if (
            this.props.alerts &&
            this.props.count &&
            typeof this.props.count === 'string'
        ) {
            this.props.count = parseInt(this.props.count, 10);
        }
        if (
            this.props.incidents &&
            this.props.skip &&
            typeof this.props.skip === 'string'
        ) {
            this.props.skip = parseInt(this.props.skip, 10);
        }
        if (
            this.props.incidents &&
            this.props.limit &&
            typeof this.props.limit === 'string'
        ) {
            this.props.limit = parseInt(this.props.limit, 10);
        }
        let canNext =
            this.props.alerts &&
            this.props.count &&
            this.props.count > this.props.skip + this.props.limit
                ? true
                : false;
        let canPrev = this.props.alerts && this.props.skip <= 0 ? false : true;
        if (this.props.alerts && this.props.isRequesting) {
            canNext = false;
            canPrev = false;
        }
        return (
            <div className="db-RadarRulesLists-page">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div>
                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                <span>Alert Log</span>
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
                                <table className="Table">
                                    <thead className="Table-body">
                                        <AlertTableHeader />
                                    </thead>
                                    <tbody className="Table-body">
                                        <AlertTableRows
                                            alerts={this.props.alerts}
                                            isRequesting={
                                                this.props.isRequesting
                                            }
                                        />
                                    </tbody>
                                </table>

                                <ShouldRender
                                    if={
                                        !this.props.isRequesting &&
                                        this.props.alerts.length === 0
                                    }
                                >
                                    <div
                                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                        style={{ marginTop: '20px' }}
                                    >
                                        There are no alerts at this time!
                                    </div>
                                </ShouldRender>

                                <ShouldRender if={this.props.isRequesting}>
                                    <ListLoader />
                                </ShouldRender>

                                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                    <ShouldRender if={!this.props.error}>
                                        <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        {this.props.count} Alert
                                                        {this.props.alerts
                                                            .length === 1
                                                            ? ''
                                                            : 's'}
                                                    </span>
                                                </span>
                                            </span>
                                        </div>
                                    </ShouldRender>
                                    <ShouldRender if={this.props.error}>
                                        <div
                                            className="bs-Tail-copy"
                                            style={{ padding: '10px' }}
                                        >
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{ marginTop: '10px' }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
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

IncidentAlert.displayName = 'IncidentAlert';

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch);

const mapStateToProps = state => {
    return {
        alerts: state.alert.incidentalerts.data,
        isRequesting: state.alert.incidentalerts.requesting,
        count: state.alert.incidentalerts.count,
        skip: state.alert.incidentalerts.skip,
        limit: state.alert.incidentalerts.limit,
        error: state.alert.incidentalerts.error,
    };
};

IncidentAlert.propTypes = {
    previous: PropTypes.func.isRequired,
    isRequesting: PropTypes.bool,
    alerts: PropTypes.array,
    count: PropTypes.PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired,
    ]),
    skip: PropTypes.PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired,
    ]),
    limit: PropTypes.PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired,
    ]),
    incidents: PropTypes.array,
    next: PropTypes.func.isRequired,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(IncidentAlert)
);
