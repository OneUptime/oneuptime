import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import IncidentList from '../incident/IncidentList';
import { fetchMonitorsIncidents } from '../../actions/monitor';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import DataPathHoC from '../DataPathHoC';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../../actions/modal';
import { createNewIncident } from '../../actions/incident';
import CreateManualIncident from '../modals/CreateManualIncident';

import DropDownMenu from '../basic/DropDownMenu';

export class MonitorViewIncidentBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            createIncidentModalId: uuidv4(),
            filteredIncidents: [],
            isFiltered: false,
            filterOption: 'Filter By',
            page: 1,
        };
    }

    prevClicked = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsIncidents' does not exist o... Remove this comment to see the full error message
        this.props.fetchMonitorsIncidents(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor.projectId._id || this.props.monitor.projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor._id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor.skip
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                ? parseInt(this.props.monitor.skip, 10) - 10
                : 10,
            10
        );
        this.setState({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            page: this.state.page === 1 ? 1 : this.state.page - 1,
        });
    };

    nextClicked = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsIncidents' does not exist o... Remove this comment to see the full error message
        this.props.fetchMonitorsIncidents(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor.projectId._id || this.props.monitor.projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor._id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor.skip
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                ? parseInt(this.props.monitor.skip, 10) + 10
                : 10,
            10
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page + 1 });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                return this.props.closeModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentModalId' does not exist on... Remove this comment to see the full error message
                    id: this.state.createIncidentModalId,
                });
            default:
                return false;
        }
    };

    filterIncidentLogs = (status: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { monitor } = this.props;
        const filteredIncidents: $TSFixMe = [];
        switch (status) {
            case 'unacknowledged':
                monitor.incidents.forEach((incident: $TSFixMe) => {
                    if (!incident.acknowledged) {
                        filteredIncidents.push(incident);
                    }
                });
                this.setState(() => ({ filteredIncidents, isFiltered: true }));
                break;
            case 'unresolved':
                monitor.incidents.forEach((incident: $TSFixMe) => {
                    if (!incident.resolved) {
                        filteredIncidents.push(incident);
                    }
                });
                this.setState(() => ({ filteredIncidents, isFiltered: true }));
                break;
            default:
                this.setState(() => ({
                    filteredIncidents: [],
                    isFiltered: false,
                }));
                break;
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentModalId' does not exist on... Remove this comment to see the full error message
            createIncidentModalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'filteredIncidents' does not exist on typ... Remove this comment to see the full error message
            filteredIncidents,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isFiltered' does not exist on type 'Read... Remove this comment to see the full error message
            isFiltered,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'filterOption' does not exist on type 'Re... Remove this comment to see the full error message
            filterOption,
        } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'create' does not exist on type 'Readonly... Remove this comment to see the full error message
        const creating = this.props.create ? this.props.create : false;
        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="bs-ContentSection Card-root Card-shadow--medium"
            >
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Incidents</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Here&#39;s a log of all of your incidents
                                    created for this monitor.
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <span className="Margin-right--8">
                                <DropDownMenu
                                    options={[
                                        {
                                            value: 'Clear Filters',
                                            show: true,
                                        },
                                        {
                                            value: 'Unacknowledged',
                                            show: true,
                                        },
                                        {
                                            value: 'Unresolved',
                                            show: true,
                                        },
                                    ]}
                                    value={filterOption}
                                    updateState={(val: $TSFixMe) => {
                                        switch (val) {
                                            case 'Unacknowledged':
                                                this.setState({
                                                    filterOption:
                                                        'Unacknowledged',
                                                });
                                                this.filterIncidentLogs(
                                                    'unacknowledged'
                                                );
                                                break;
                                            case 'Unresolved':
                                                this.setState({
                                                    filterOption: 'Unresolved',
                                                });
                                                this.filterIncidentLogs(
                                                    'unresolved'
                                                );
                                                break;
                                            default:
                                                this.setState({
                                                    filterOption: 'Filter By',
                                                });
                                                this.filterIncidentLogs(
                                                    'clear'
                                                );
                                                break;
                                        }
                                    }}
                                />
                            </span>
                            <button
                                className={
                                    creating
                                        ? 'bs-Button bs-Button--blue'
                                        : 'bs-Button bs-ButtonLegacy ActionIconParent'
                                }
                                type="button"
                                disabled={creating}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                id={`createIncident_${this.props.monitor.name}`}
                                onClick={() =>
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                    this.props.openModal({
                                        id: createIncidentModalId,
                                        content: DataPathHoC(
                                            CreateManualIncident,
                                            {
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                monitorId: this.props.monitor
                                                    ._id,
                                                projectId:
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.monitor.projectId
                                                        ._id ||
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.monitor
                                                        .projectId,
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                monitor: this.props.monitor,
                                            }
                                        ),
                                    })
                                }
                            >
                                <ShouldRender if={!creating}>
                                    <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                        <span>Create New Incident</span>
                                    </span>
                                </ShouldRender>
                                <ShouldRender if={creating}>
                                    <FormLoader />
                                </ShouldRender>
                            </button>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <IncidentList
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                        componentId={this.props.componentId}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                        incidents={this.props.monitor}
                        prevClicked={this.prevClicked}
                        nextClicked={this.nextClicked}
                        filteredIncidents={filteredIncidents}
                        isFiltered={isFiltered}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        page={this.state.page}
                    />
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
MonitorViewIncidentBox.displayName = 'MonitorViewIncidentBox';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
MonitorViewIncidentBox.propTypes = {
    componentId: PropTypes.string.isRequired,
    monitor: PropTypes.object.isRequired,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    create: PropTypes.bool,
    closeModal: PropTypes.func,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { fetchMonitorsIncidents, openModal, closeModal, createNewIncident },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        create: state.incident.newIncident.requesting,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(MonitorViewIncidentBox);
