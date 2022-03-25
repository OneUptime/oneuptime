import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from 'common-ui/actions/modal';
import DataPathHoC from '../DataPathHoC';
import { ListLoader } from '../basic/Loader';
import {
    fetchCommunicationSlas,
    updateCommunicationSla,
    setActiveSla,
} from '../../actions/incidentCommunicationSla';
import IncidentCommunicationSlaModal from './IncidentCommunicationSlaModal';
import EditIncidentCommunicationSlaModal from './EditIncidentCommunicationSlaModal';
import DeleteIncidentCommunicationSlaModal from './DeleteIncidentCommunicationSlaModal';
import secondsToHms from '../../utils/secondsToHms';

interface IncidentCommunicationSlaProps {
    openModal: Function;
    skip?: string | number;
    limit?: string | number;
    count?: string | number;
    requesting?: boolean;
    projectId?: string;
    fetchCommunicationSlas?: Function;
    currentProject?: object;
    incidentSlas?: unknown[];
    fetchSlaError?: string;
    updateCommunicationSla?: Function;
    setActiveSla?: Function;
    activeSla?: string;
    monitors?: unknown[];
}

class IncidentCommunicationSla extends Component<IncidentCommunicationSlaProps> {
    limit: $TSFixMe;
    constructor() {

        super();
        this.limit = 10;
        this.state = {
            flag: false,
            page: 1,
        };
    }

    override componentDidMount() {

        const { projectId, fetchCommunicationSlas } = this.props;
        fetchCommunicationSlas(projectId, 0, this.limit);
    }

    prevClicked = (skip: $TSFixMe, limit: $TSFixMe) => {

        const { projectId, fetchCommunicationSlas } = this.props;
        this.setState({
            flag: false,
        });

        fetchCommunicationSlas(
            projectId,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            limit
        );

        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {

        const { projectId, fetchCommunicationSlas } = this.props;
        this.setState({
            flag: false,
        });
        fetchCommunicationSlas(projectId, skip + limit, 10);
        this.setState({
            page:

                this.state.page < this.props.count

                    ? this.state.page + 1

                    : this.props.count,
        });
    };

    setAsDefault = ({
        projectId,
        incidentSlaId
    }: $TSFixMe) => {

        const { updateCommunicationSla, setActiveSla } = this.props;
        const data = { isDefault: true };
        setActiveSla(incidentSlaId);
        updateCommunicationSla(projectId, incidentSlaId, data, true);
    };

    handleMonitorList = (monitors: $TSFixMe) => {
        if (monitors.length === 0) {
            return 'No monitor in this event';
        }
        if (monitors.length === 1) {
            return monitors[0].name;
        }
        if (monitors.length === 2) {
            return `${monitors[0].name} and ${monitors[1].name}`;
        }
        if (monitors.length === 3) {
            return `${monitors[0].name}, ${monitors[1].name} and ${monitors[2].name}`;
        }

        return `${monitors[0].name}, ${monitors[1].name} and ${monitors.length -
            2} others`;
    };

    handleIncidentSlas = () => {
        const {

            requesting,

            projectId,

            incidentSlas,

            openModal,

            activeSla,

            monitors,
        } = this.props;

        return incidentSlas &&
            incidentSlas.length > 0 &&
            incidentSlas.map((incidentSla: $TSFixMe) => {
                const slaMonitors = monitors.filter(
                    (monitor: $TSFixMe) => monitor.incidentCommunicationSla &&
                        String(monitor.incidentCommunicationSla._id) ===
                        String(incidentSla._id)
                );
                return (
                    <div
                        key={incidentSla._id}
                        id={`incidentSla_${incidentSla.name}`}
                        className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                        style={{
                            backgroundColor: 'white',
                            cursor: 'pointer',
                        }}
                    >
                        {incidentSla.isDefault ? (
                            <div
                                className="bs-ObjectList-cell bs-u-v-middle"
                                style={{
                                    display: 'flex',
                                    width: '20vw',
                                }}
                            >
                                <div className="bs-ObjectList-cell-row">
                                    {incidentSla.name}
                                </div>
                                <div
                                    style={{
                                        marginLeft: 5,
                                    }}
                                    className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                >
                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                        <span>Default</span>
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div
                                className="bs-ObjectList-cell bs-u-v-middle"
                                style={{
                                    display: 'flex',
                                    width: '20vw',
                                }}
                            >
                                <div className="bs-ObjectList-cell-row">
                                    {incidentSla.name}
                                </div>
                            </div>
                        )}
                        <div
                            className="bs-ObjectList-cell bs-u-v-middle"
                            style={{ width: '20vw' }}
                        >
                            <div className="bs-ObjectList-cell-row">
                                {secondsToHms(incidentSla.duration * 60)}
                            </div>
                        </div>
                        <div
                            className="bs-ObjectList-cell bs-u-v-middle"
                            style={{ width: '20vw' }}
                        >
                            <div className="bs-ObjectList-cell-row">
                                {secondsToHms(incidentSla.alertTime * 60)}
                            </div>
                        </div>
                        {incidentSla.isDefault ? (
                            <div
                                className="bs-ObjectList-cell bs-u-v-middle"
                                style={{ width: '20vw' }}
                            >
                                <div className="bs-ObjectList-cell-row">
                                    All monitors without SLA
                                </div>
                            </div>
                        ) : (
                            <div
                                className="bs-ObjectList-cell bs-u-v-middle"
                                style={{ width: '20vw' }}
                            >
                                <div className="bs-ObjectList-cell-row">
                                    {this.handleMonitorList(slaMonitors)}
                                </div>
                            </div>
                        )}

                        <div
                            className="bs-ObjectList-cell bs-u-v-middle"
                            style={{ width: '20vw' }}
                        >
                            <div
                                className="bs-ObjectList-cell-row"
                                style={{
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    marginRight: 15,
                                }}
                            >
                                <ShouldRender if={!incidentSla.isDefault}>
                                    <button
                                        id={`defaultIncidentSlaBtn_${incidentSla.name}`}
                                        title="set default"
                                        className="bs-Button bs-DeprecatedButton"
                                        style={{
                                            marginLeft: 20,
                                            minWidth: 100,
                                        }}
                                        type="button"
                                        onClick={() => {
                                            this.setAsDefault({
                                                projectId,
                                                incidentSlaId: incidentSla._id,
                                            });
                                            this.setState({
                                                flag: true,
                                            });
                                        }}
                                        disabled={requesting}
                                    >
                                        <ShouldRender
                                            if={
                                                !requesting ||
                                                String(activeSla) !==
                                                String(incidentSla._id)
                                            }
                                        >
                                            <span>Set as Default</span>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                requesting &&
                                                String(activeSla) ===
                                                String(incidentSla._id)
                                            }
                                        >
                                            <ListLoader
                                                style={{
                                                    marginTop: 0,
                                                }}
                                            />
                                        </ShouldRender>
                                    </button>
                                </ShouldRender>
                                <button
                                    id={`editIncidentSlaBtn_${incidentSla.name}`}
                                    title="edit"
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                    style={{
                                        marginLeft: 20,
                                    }}
                                    type="button"
                                    onClick={() => {
                                        openModal({
                                            id: incidentSla._id,
                                            content: EditIncidentCommunicationSlaModal,
                                            sla: incidentSla,
                                            projectId,
                                        });
                                    }}
                                >
                                    <span>Edit</span>
                                </button>
                                <button
                                    id={`deleteIncidentSlaBtn_${incidentSla.name}`}
                                    title="delete"
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete"
                                    style={{
                                        marginLeft: 20,
                                    }}
                                    type="button"
                                    onClick={() => {
                                        openModal({
                                            id: incidentSla._id,
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
                );
            });
    };

    override render() {
        const {

            limit,

            count,

            skip,

            requesting,

            projectId,

            fetchSlaError,

            currentProject,

            incidentSlas,
        } = this.props;
        const footerBorderTopStyle = { margin: 0, padding: 0 };

        const canNext = count > Number(skip) + Number(limit) ? true : false;
        const canPrev = Number(skip) <= 0 ? false : true;
        const projectName = currentProject ? currentProject.name : '';

        const numberOfPages = Math.ceil(parseInt(this.props.count) / 10);
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
                                    Setup incident communication SLA for{' '}
                                    {projectName}
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
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
                                        Duration
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        Alert Time
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        Monitor(s)
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
                                {this.handleIncidentSlas()}
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

                        <ShouldRender if={requesting && !this.state.flag}>
                            <ListLoader />
                        </ShouldRender>
                        <ShouldRender
                            if={
                                (!incidentSlas || incidentSlas.length === 0) &&
                                !requesting &&
                                !fetchSlaError
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
                                            {numberOfPages > 0
                                                ? `Page ${this.state.page
                                                } of ${numberOfPages} (${this.props.count
                                                } SLA${this.props.count === 1
                                                    ? ''
                                                    : 's'
                                                })`

                                                : `${this.props.count} SLA${this.props.count === 1
                                                    ? ''
                                                    : 's'
                                                }`}
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
                                                this.prevClicked(skip, limit)
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
                                                this.nextClicked(skip, limit)
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
    fetchCommunicationSlas: PropTypes.func,
    currentProject: PropTypes.object,
    incidentSlas: PropTypes.array,
    fetchSlaError: PropTypes.string,
    updateCommunicationSla: PropTypes.func,
    setActiveSla: PropTypes.func,
    activeSla: PropTypes.string,
    monitors: PropTypes.array,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
        fetchCommunicationSlas,
        updateCommunicationSla,
        setActiveSla,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const monitorData = state.monitor.monitorsList.monitors.find(
        (data: $TSFixMe) => String(data._id) === String(ownProps.projectId)
    );
    const monitors = monitorData ? monitorData.monitors : [];

    return {
        requesting: state.incidentSla.incidentCommunicationSlas.requesting,
        fetchSlaError: state.incidentSla.incidentCommunicationSlas.error,
        skip: state.incidentSla.incidentCommunicationSlas.skip,
        limit: state.incidentSla.incidentCommunicationSlas.limit,
        count: state.incidentSla.incidentCommunicationSlas.count,
        currentProject: state.project.currentProject,
        incidentSlas: state.incidentSla.incidentCommunicationSlas.incidentSlas,
        activeSla: state.incidentSla.activeSla,
        monitors,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentCommunicationSla);
