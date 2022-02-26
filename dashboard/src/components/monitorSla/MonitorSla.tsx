import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from '../../actions/modal';
import DataPathHoC from '../DataPathHoC';
import { ListLoader } from '../basic/Loader';
import {
    fetchMonitorSlas,
    updateMonitorSla,
    setActiveMonitorSla,
    paginateNext,
    paginatePrev,
} from '../../actions/monitorSla';
import MonitorSlaModal from './MonitorSlaModal';
import EditMonitorSlaModal from './EditMonitorSlaModal';
import DeleteMonitorSlaModal from './DeleteMonitorSlaModal';

class MonitorSla extends Component {
    limit: $TSFixMe;
    constructor() {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1-2 arguments, but got 0.
        super();
        this.limit = 10;
        this.state = {
            flag: false,
            page: 1,
        };
    }

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { projectId, fetchMonitorSlas } = this.props;
        if (projectId) {
            fetchMonitorSlas(projectId, 0, this.limit);
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (prevProps.currentProject !== this.props.currentProject) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            const { currentProject, fetchMonitorSlas } = this.props;
            if (currentProject) {
                fetchMonitorSlas(currentProject._id, 0, this.limit);
            }
        }
    }

    prevClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { projectId, fetchMonitorSlas } = this.props;
        this.setState({
            flag: false,
        });

        fetchMonitorSlas(
            projectId,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            limit
        );
        this.setState({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            page: this.state.page === 1 ? 1 : this.state.page - 1,
        });
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { projectId, fetchMonitorSlas } = this.props;
        this.setState({
            flag: false,
        });

        fetchMonitorSlas(projectId, skip + limit, limit);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page + 1 });
    };

    setAsDefault = ({
        projectId,
        monitorSlaId
    }: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateMonitorSla' does not exist on type... Remove this comment to see the full error message
        const { updateMonitorSla, setActiveMonitorSla } = this.props;
        const data = { isDefault: true };
        setActiveMonitorSla(monitorSlaId);
        updateMonitorSla(projectId, monitorSlaId, data, true);
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

    handleMonitorSlas = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorSlas' does not exist on type 'Rea... Remove this comment to see the full error message
            monitorSlas,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
            openModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeSla' does not exist on type 'Reado... Remove this comment to see the full error message
            activeSla,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
            monitors,
        } = this.props;

        return (
            <tbody id="monitorSettings">
                {monitorSlas &&
                    monitorSlas.length > 0 &&
                    monitorSlas.map((monitorSla: $TSFixMe, index: $TSFixMe) => {
                        const slaMonitors = monitors.filter(
                            (monitor: $TSFixMe) => monitor.monitorSla &&
                            String(monitor.monitorSla._id) ===
                                String(monitorSla._id)
                        );
                        return (
                            <tr
                                key={monitorSla._id}
                                className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                style={{
                                    backgroundColor: 'white',
                                    cursor: 'pointer',
                                }}
                                id={`monitorSla_${monitorSla.name}`}
                            >
                                {monitorSla.isDefault ? (
                                    <td
                                        className="bs-ObjectList-cell bs-u-v-middle"
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            width: '20vw',
                                            flexWrap: 'wrap',
                                            minWidth: 160,
                                            marginTop: 10,
                                        }}
                                    >
                                        <div className="bs-ObjectList-cell-row">
                                            {monitorSla.name}
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
                                    </td>
                                ) : (
                                    <td
                                        className="bs-ObjectList-cell bs-u-v-middle"
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            width: '20vw',
                                            flexWrap: 'wrap',
                                            minWidth: 160,
                                            marginTop: 10,
                                        }}
                                    >
                                        <div className="bs-ObjectList-cell-row">
                                            {monitorSla.name}
                                        </div>
                                    </td>
                                )}
                                <td
                                    className="bs-ObjectList-cell bs-u-v-middle"
                                    style={{ width: '20vw' }}
                                >
                                    <div className="bs-ObjectList-cell-row">
                                        {monitorSla.frequency}
                                    </div>
                                </td>
                                <td
                                    className="bs-ObjectList-cell bs-u-v-middle"
                                    style={{ width: '20vw' }}
                                >
                                    <div className="bs-ObjectList-cell-row">
                                        {monitorSla.monitorUptime}
                                    </div>
                                </td>
                                <td
                                    className="bs-ObjectList-cell bs-u-v-middle"
                                    style={{ width: '20vw' }}
                                >
                                    {monitorSla.isDefault ? (
                                        <div className="bs-ObjectList-cell-row">
                                            All monitors without SLA
                                        </div>
                                    ) : (
                                        <div className="bs-ObjectList-cell-row">
                                            {this.handleMonitorList(
                                                slaMonitors
                                            )}
                                        </div>
                                    )}
                                </td>
                                <td
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
                                        <ShouldRender
                                            if={!monitorSla.isDefault}
                                        >
                                            <button
                                                id={`defaultMonitorSlaBtn_${index}`}
                                                title="edit"
                                                className="bs-Button bs-DeprecatedButton"
                                                style={{
                                                    marginLeft: 20,
                                                    minWidth: 100,
                                                }}
                                                type="button"
                                                onClick={() => {
                                                    this.setAsDefault({
                                                        projectId,
                                                        monitorSlaId:
                                                            monitorSla._id,
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
                                                            String(
                                                                monitorSla._id
                                                            )
                                                    }
                                                >
                                                    <span>Set as Default</span>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        requesting &&
                                                        String(activeSla) ===
                                                            String(
                                                                monitorSla._id
                                                            )
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
                                            id={`editMonitorSlaBtn_${index}`}
                                            title="edit"
                                            className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                            style={{
                                                marginLeft: 20,
                                            }}
                                            type="button"
                                            onClick={() => {
                                                openModal({
                                                    id: monitorSla._id,
                                                    content: EditMonitorSlaModal,
                                                    sla: monitorSla,
                                                    projectId,
                                                });
                                            }}
                                        >
                                            <span>Edit</span>
                                        </button>
                                        <button
                                            id={`deleteMonitorSlaBtn_${index}`}
                                            title="delete"
                                            className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete"
                                            style={{
                                                marginLeft: 20,
                                            }}
                                            type="button"
                                            onClick={() => {
                                                openModal({
                                                    id: monitorSla._id,
                                                    content: DataPathHoC(
                                                        DeleteMonitorSlaModal,
                                                        {
                                                            projectId,
                                                            monitorSlaId:
                                                                monitorSla._id,
                                                        }
                                                    ),
                                                });
                                            }}
                                        >
                                            <span>Delete</span>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
            </tbody>
        );
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'limit' does not exist on type 'Readonly<... Remove this comment to see the full error message
            limit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
            count,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            skip,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSlaError' does not exist on type 'R... Remove this comment to see the full error message
            fetchSlaError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorSlas' does not exist on type 'Rea... Remove this comment to see the full error message
            monitorSlas,
        } = this.props;
        const footerBorderTopStyle = { margin: 0, padding: 0 };

        const canNext = count > Number(skip) + Number(limit) ? true : false;
        const canPrev = Number(skip) <= 0 ? false : true;
        const projectName = currentProject ? currentProject.name : '';
        const numberOfPage = Math.ceil(parseInt(count) / 10);

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Monitor Service Level Agreement</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>Setup monitor SLA for {projectName}</span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <button
                                    id="addMonitorSlaBtn"
                                    onClick={() => {
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                        this.props.openModal({
                                            id: projectId,
                                            content: DataPathHoC(
                                                MonitorSlaModal,
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
                                            <span>Create Monitor SLA</span>
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
                                id="monitorSlaList"
                                className="bs-ObjectList-rows"
                            >
                                <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                    <div className="bs-ObjectList-cell">
                                        Name
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        Frequency (days)
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        Monitor Uptime (%)
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
                                {this.handleMonitorSlas()}
                                <ShouldRender
                                    if={
                                        !(
                                            (!monitorSlas ||
                                                monitorSlas.length === 0) &&
                                            !requesting &&
                                            !fetchSlaError
                                        )
                                    }
                                >
                                    <div style={footerBorderTopStyle}></div>
                                </ShouldRender>
                            </div>
                        </div>
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'flag' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        <ShouldRender if={requesting && !this.state.flag}>
                            <ListLoader />
                        </ShouldRender>
                        <ShouldRender
                            if={
                                (!monitorSlas || monitorSlas.length === 0) &&
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
                                    {(!monitorSlas ||
                                        monitorSlas.length === 0) &&
                                    !requesting &&
                                    !fetchSlaError
                                        ? 'You have no monitor SLA'
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
                                            {numberOfPage > 0
                                                ? `Page ${
                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                      this.state.page
                                                  } of ${numberOfPage} (${
                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                      this.props.count
                                                  } SLA${
                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                      this.props.count > 1
                                                          ? 's'
                                                          : ''
                                                  })`
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                : `${this.props.count} SLA${
                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                      this.props.count > 1
                                                          ? 's'
                                                          : ''
                                                  }`}
                                        </span>
                                    </span>
                                </span>
                            </div>
                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            id="btnPrevMonitorSla"
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
                                            id="btnNextMonitorSla"
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
MonitorSla.displayName = 'MonitorSla';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
MonitorSla.propTypes = {
    openModal: PropTypes.func.isRequired,
    skip: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    limit: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    count: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    requesting: PropTypes.bool,
    projectId: PropTypes.string,
    fetchMonitorSlas: PropTypes.func,
    currentProject: PropTypes.object,
    monitorSlas: PropTypes.array,
    fetchSlaError: PropTypes.string,
    updateMonitorSla: PropTypes.func,
    setActiveMonitorSla: PropTypes.func,
    activeSla: PropTypes.string,
    monitors: PropTypes.array,
    // page: PropTypes.number,
    // paginatePrev: PropTypes.func, imported and dispatched but not used in the code
    // paginateNext: PropTypes.func, imported and dispatched but not used in the code
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        openModal,
        fetchMonitorSlas,
        updateMonitorSla,
        setActiveMonitorSla,
        paginateNext,
        paginatePrev,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const monitorData = state.monitor.monitorsList.monitors.find(
        (data: $TSFixMe) => String(data._id) === String(ownProps.projectId)
    );
    const monitors = monitorData ? monitorData.monitors : [];
    return {
        requesting: state.monitorSla.monitorSlas.requesting,
        fetchSlaError: state.monitorSla.monitorSlas.error,
        skip: state.monitorSla.monitorSlas.skip,
        limit: state.monitorSla.monitorSlas.limit,
        count: state.monitorSla.monitorSlas.count,
        currentProject: state.project.currentProject,
        monitorSlas: state.monitorSla.monitorSlas.slas,
        activeSla: state.monitorSla.activeSla,
        monitors,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorSla);
