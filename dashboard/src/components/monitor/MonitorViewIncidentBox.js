import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import IncidentList from '../incident/IncidentList';
import { fetchMonitorsIncidents } from '../../actions/monitor';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import DataPathHoC from '../DataPathHoC';
import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../../actions/modal';
import { createNewIncident } from '../../actions/incident';
import CreateManualIncident from '../modals/CreateManualIncident';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';

export class MonitorViewIncidentBox extends Component {
    constructor(props) {
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
        this.props.fetchMonitorsIncidents(
            this.props.monitor.projectId._id,
            this.props.monitor._id,
            this.props.monitor.skip
                ? parseInt(this.props.monitor.skip, 10) - 10
                : 10,
            10
        );
        this.setState({
            page: this.state.page === 1 ? 1 : this.state.page - 1,
        });
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > PREVIOUS INCIDENT CLICKED',
                {
                    projectId: this.props.monitor.projectId._id,
                }
            );
        }
    };

    nextClicked = () => {
        this.props.fetchMonitorsIncidents(
            this.props.monitor.projectId._id,
            this.props.monitor._id,
            this.props.monitor.skip
                ? parseInt(this.props.monitor.skip, 10) + 10
                : 10,
            10
        );
        this.setState({ page: this.state.page + 1 });
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > NEXT INCIDENT CLICKED',
                {
                    projectId: this.props.monitor.projectId._id,
                }
            );
        }
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.state.createIncidentModalId,
                });
            default:
                return false;
        }
    };

    filterIncidentLogs = status => {
        const { monitor } = this.props;
        const filteredIncidents = [];
        switch (status) {
            case 'unacknowledged':
                monitor.incidents.forEach(incident => {
                    if (!incident.acknowledged) {
                        filteredIncidents.push(incident);
                    }
                });
                this.setState(() => ({ filteredIncidents, isFiltered: true }));
                break;
            case 'unresolved':
                monitor.incidents.forEach(incident => {
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
            createIncidentModalId,
            filteredIncidents,
            isFiltered,
            filterOption,
        } = this.state;
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
                                <Dropdown>
                                    <Dropdown.Toggle
                                        id="filterToggle"
                                        title={filterOption}
                                        className="bs-Button bs-DeprecatedButton"
                                    />
                                    <Dropdown.Menu>
                                        <MenuItem
                                            title="clear"
                                            onClick={() => {
                                                this.setState({
                                                    filterOption: 'Filter By',
                                                });
                                                this.filterIncidentLogs(
                                                    'clear'
                                                );
                                            }}
                                        >
                                            Clear Filters
                                        </MenuItem>
                                        <MenuItem
                                            title="unacknowledged"
                                            onClick={() => {
                                                this.setState({
                                                    filterOption:
                                                        'Unacknowledged',
                                                });
                                                this.filterIncidentLogs(
                                                    'unacknowledged'
                                                );
                                            }}
                                        >
                                            Unacknowledged
                                        </MenuItem>
                                        <MenuItem
                                            title="unresolved"
                                            onClick={() => {
                                                this.setState({
                                                    filterOption: 'Unresolved',
                                                });
                                                this.filterIncidentLogs(
                                                    'unresolved'
                                                );
                                            }}
                                        >
                                            Unresolved
                                        </MenuItem>
                                    </Dropdown.Menu>
                                </Dropdown>
                            </span>
                            <button
                                className={
                                    creating
                                        ? 'bs-Button bs-Button--blue'
                                        : 'bs-Button bs-ButtonLegacy ActionIconParent'
                                }
                                type="button"
                                disabled={creating}
                                id={`createIncident_${this.props.monitor.name}`}
                                onClick={() =>
                                    this.props.openModal({
                                        id: createIncidentModalId,
                                        content: DataPathHoC(
                                            CreateManualIncident,
                                            {
                                                monitorId: this.props.monitor
                                                    ._id,
                                                projectId: this.props.monitor
                                                    .projectId._id,
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
                        componentId={this.props.componentId}
                        incidents={this.props.monitor}
                        prevClicked={this.prevClicked}
                        nextClicked={this.nextClicked}
                        filteredIncidents={filteredIncidents}
                        isFiltered={isFiltered}
                        page={this.state.page}
                    />
                </div>
            </div>
        );
    }
}

MonitorViewIncidentBox.displayName = 'MonitorViewIncidentBox';

MonitorViewIncidentBox.propTypes = {
    componentId: PropTypes.string.isRequired,
    monitor: PropTypes.object.isRequired,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    create: PropTypes.bool,
    closeModal: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { fetchMonitorsIncidents, openModal, closeModal, createNewIncident },
        dispatch
    );

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
        create: state.incident.newIncident.requesting,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(MonitorViewIncidentBox);
