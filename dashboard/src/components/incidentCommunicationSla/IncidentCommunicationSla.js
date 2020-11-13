import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from '../../actions/modal';
import { fetchMonitors } from '../../actions/monitor';
import DataPathHoC from '../DataPathHoC';
import { ListLoader } from '../basic/Loader';
import { Link } from 'react-router-dom';
import { fetchCommunicationSlas } from '../../actions/incidentCommunicationSla';
import IncidentCommunicationSlaModal from './IncidentCommunicationSlaModal';
import EditIncidentCommunicationSlaModal from './EditIncidentCommunicationSlaModal';
import DeleteIncidentCommunicationSlaModal from './DeleteIncidentCommunicationSlaModal';

class IncidentCommunicationSla extends Component {
    constructor() {
        super();
        this.limit = 10;
    }

    componentDidMount() {
        const { projectId, fetchCommunicationSlas, fetchMonitors } = this.props;
        fetchCommunicationSlas(projectId, 0, this.limit);
        fetchMonitors(projectId);
    }

    handleMonitorList = monitors => {
        if (monitors.length === 0) {
            return 'No monitor in this event';
        }
        if (monitors.length === 1) {
            return monitors[0].monitorId.name;
        }
        if (monitors.length === 2) {
            return `${monitors[0].monitorId.name} and ${monitors[1].monitorId.name}`;
        }
        if (monitors.length === 3) {
            return `${monitors[0].monitorId.name}, ${monitors[1].monitorId.name} and ${monitors[2].monitorId.name}`;
        }

        return `${monitors[0].monitorId.name}, ${
            monitors[1].monitorId.name
        } and ${monitors.length - 2} others`;
    };

    prevClicked = (skip, limit) => {
        const { projectId, fetchCommunicationSlas } = this.props;

        fetchCommunicationSlas(
            projectId,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            limit
        );
    };

    nextClicked = (skip, limit) => {
        const { projectId, fetchCommunicationSlas } = this.props;

        fetchCommunicationSlas(projectId, skip + limit, limit);
    };

    render() {
        const {
            limit,
            count,
            skip,
            requesting,
            projectId,
            fetchingMonitors,
            fetchSlaError,
            monitors,
            currentProject,
            incidentSlas,
            openModal,
        } = this.props;
        const footerBorderTopStyle = { margin: 0, padding: 0 };

        const canNext = count > Number(skip) + Number(limit) ? true : false;
        const canPrev = Number(skip) <= 0 ? false : true;
        const projectName = currentProject ? currentProject.name : '';

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Incident Communication SLA</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Setup default incident communication SLA for{' '}
                                    {projectName}
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <ShouldRender
                                    if={
                                        !fetchingMonitors && monitors.length > 0
                                    }
                                >
                                    <button
                                        id="addIncidentSlaBtn"
                                        onClick={() => {
                                            this.props.openModal({
                                                id: projectId,
                                                content: DataPathHoC(
                                                    IncidentCommunicationSlaModal,
                                                    {
                                                        projectId,
                                                    }
                                                ),
                                            });
                                        }}
                                        className="Button bs-ButtonLegacy ActionIconParent"
                                        type="button"
                                    >
                                        <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                            <div className="Box-root Margin-right--8">
                                                <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                            </div>
                                            <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                <span>
                                                    Create Communication SLA
                                                </span>
                                            </span>
                                        </div>
                                    </button>
                                </ShouldRender>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection-content Box-root">
                    <div className="bs-ObjectList db-UserList">
                        <div
                            style={{
                                overflow: 'hidden',
                                overflowX: 'auto',
                            }}
                        >
                            <div
                                id="incidentSlaList"
                                className="bs-ObjectList-rows"
                            >
                                <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                    <div className="bs-ObjectList-cell">
                                        Name
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        Monitor(s)
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        Duration (minutes)
                                    </div>
                                    <div
                                        className="bs-ObjectList-cell"
                                        style={{
                                            float: 'right',
                                            marginRight: '10px',
                                        }}
                                    >
                                        Action
                                    </div>
                                </header>
                                {incidentSlas.length > 0 &&
                                    incidentSlas.map((incidentSla, index) => (
                                        <div
                                            key={incidentSla._id}
                                            className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                            style={{
                                                backgroundColor: 'white',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <div
                                                className="bs-ObjectList-cell bs-u-v-middle"
                                                style={{ width: '20vw' }}
                                            >
                                                <div className="bs-ObjectList-cell-row">
                                                    {incidentSla.name}
                                                </div>
                                            </div>
                                            <div
                                                className="bs-ObjectList-cell bs-u-v-middle"
                                                style={{ width: '20vw' }}
                                            >
                                                <div className="bs-ObjectList-cell-row">
                                                    {incidentSla.monitors &&
                                                        this.handleMonitorList(
                                                            incidentSla.monitors
                                                        )}
                                                </div>
                                            </div>
                                            <div
                                                className="bs-ObjectList-cell bs-u-v-middle"
                                                style={{ width: '20vw' }}
                                            >
                                                <div className="bs-ObjectList-cell-row">
                                                    {incidentSla.duration}
                                                </div>
                                            </div>
                                            <div
                                                className="bs-ObjectList-cell bs-u-v-middle"
                                                style={{ width: '20vw' }}
                                            >
                                                <div className="bs-ObjectList-cell-row">
                                                    {incidentSla.isDefault
                                                        ? 'true'
                                                        : 'false'}
                                                </div>
                                            </div>
                                            <div
                                                className="bs-ObjectList-cell bs-u-v-middle"
                                                style={{ width: '20vw' }}
                                            >
                                                <div
                                                    className="bs-ObjectList-cell-row"
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent:
                                                            'flex-end',
                                                        marginRight: 15,
                                                    }}
                                                >
                                                    <button
                                                        id={`editIncidentSlaBtn_${index}`}
                                                        title="edit"
                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                                        style={{
                                                            marginLeft: 20,
                                                        }}
                                                        type="button"
                                                        onClick={() => {
                                                            openModal({
                                                                id:
                                                                    incidentSla._id,
                                                                content: EditIncidentCommunicationSlaModal,
                                                                sla: incidentSla,
                                                                projectId,
                                                            });
                                                        }}
                                                    >
                                                        <span>Edit</span>
                                                    </button>
                                                    <button
                                                        id={`deleteIncidentSlaBtn_${index}`}
                                                        title="delete"
                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete"
                                                        style={{
                                                            marginLeft: 20,
                                                        }}
                                                        type="button"
                                                        onClick={() => {
                                                            openModal({
                                                                id:
                                                                    incidentSla._id,
                                                                content: DataPathHoC(
                                                                    DeleteIncidentCommunicationSlaModal,
                                                                    {
                                                                        projectId,
                                                                        incidentSlaId:
                                                                            incidentSla._id,
                                                                    }
                                                                ),
                                                            });
                                                        }}
                                                    >
                                                        <span>Delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                <ShouldRender
                                    if={
                                        !(
                                            (!incidentSlas ||
                                                incidentSlas.length === 0) &&
                                            !requesting &&
                                            !fetchSlaError
                                        )
                                    }
                                >
                                    <div style={footerBorderTopStyle}></div>
                                </ShouldRender>
                            </div>
                        </div>
                        <ShouldRender if={fetchingMonitors || requesting}>
                            <ListLoader />
                        </ShouldRender>
                        <ShouldRender
                            if={!fetchingMonitors && monitors.length === 0}
                        >
                            <div
                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                style={{
                                    textAlign: 'center',
                                    backgroundColor: 'white',
                                    padding: '20px 10px 0',
                                }}
                            >
                                <span>
                                    No monitors was added to this project.{' '}
                                    <Link
                                        to={`/dashboard/project/${projectId}/components`}
                                        style={{
                                            textDecoration: 'underline',
                                        }}
                                    >
                                        Please create one.
                                    </Link>
                                </span>
                            </div>
                        </ShouldRender>
                        <ShouldRender
                            if={
                                (!incidentSlas || incidentSlas.length === 0) &&
                                !requesting &&
                                !fetchSlaError &&
                                !fetchingMonitors &&
                                monitors.length > 0
                            }
                        >
                            <div
                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                style={{
                                    textAlign: 'center',
                                    backgroundColor: 'white',
                                    padding: '20px 10px 0',
                                }}
                            >
                                <span>
                                    {(!incidentSlas ||
                                        incidentSlas.length === 0) &&
                                    !requesting &&
                                    !fetchSlaError
                                        ? 'You have no incident communication SLA'
                                        : null}
                                    {fetchSlaError ? fetchSlaError : null}
                                </span>
                            </div>
                        </ShouldRender>
                        <div
                            className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween"
                            style={{ backgroundColor: 'white' }}
                        >
                            <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        <span
                                            id="slaCount"
                                            className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                        >
                                            {this.props.count +
                                                (this.props.count > 1
                                                    ? '  SLAs'
                                                    : ' SLA')}
                                        </span>
                                    </span>
                                </span>
                            </div>
                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            id="btnPrevIncidentSla"
                                            onClick={() =>
                                                this.prevClicked(
                                                    projectId,
                                                    skip
                                                )
                                            }
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canPrev ? '' : 'Is--disabled')
                                            }
                                            disabled={!canPrev}
                                            data-db-analytics-name="list_view.pagination.previous"
                                            type="button"
                                        >
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span>Previous</span>
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                    <div className="Box-root">
                                        <button
                                            id="btnNextIncidentSla"
                                            onClick={() =>
                                                this.nextClicked(
                                                    projectId,
                                                    skip
                                                )
                                            }
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canNext ? '' : 'Is--disabled')
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
        );
    }
}

IncidentCommunicationSla.displayName = 'IncidentCommunicationSla';

IncidentCommunicationSla.propTypes = {
    openModal: PropTypes.func.isRequired,
    skip: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    limit: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    count: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    requesting: PropTypes.bool,
    projectId: PropTypes.string,
    fetchingMonitors: PropTypes.bool,
    monitors: PropTypes.array,
    fetchCommunicationSlas: PropTypes.func,
    currentProject: PropTypes.object,
    incidentSlas: PropTypes.array,
    fetchMonitors: PropTypes.func,
    fetchSlaError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal,
            fetchCommunicationSlas,
            fetchMonitors,
        },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const monitorData = state.monitor.monitorsList.monitors.find(
        data => String(data._id) === String(ownProps.projectId)
    );
    const monitors = monitorData ? monitorData.monitors : [];

    return {
        monitors,
        fetchingMonitors: state.monitor.monitorsList.requesting,
        requesting: state.incidentSla.incidentCommunicationSlas.requesting,
        fetchSlaError: state.incidentSla.incidentCommunicationSlas.error,
        skip: state.incidentSla.incidentCommunicationSlas.skip,
        limit: state.incidentSla.incidentCommunicationSlas.limit,
        count: state.incidentSla.incidentCommunicationSlas.count,
        currentProject: state.project.currentProject,
        incidentSlas: state.incidentSla.incidentCommunicationSlas.incidentSlas,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentCommunicationSla);
