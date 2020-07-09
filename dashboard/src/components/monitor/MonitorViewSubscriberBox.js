import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import SubscriberList from '../subscriber/subscriberList';
import { fetchMonitorsSubscribers } from '../../actions/monitor';
import { openModal, closeModal } from '../../actions/modal';
import CreateSubscriber from '../../components/modals/CreateSubscriber';
import DataPathHoC from '../DataPathHoC';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import uuid from 'uuid';
import { exportCSV } from '../../actions/subscriber';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { history } from '../../store';
import UploadFileForm from '../modals/UploadFile';

export class MonitorViewSubscriberBox extends Component {
    constructor(props) {
        super(props);
        this.state = {
            createSubscriberModalId: uuid.v4(),
            uploadSubscriberModalId: uuid.v4(),
        };
    }

    prevClicked = () => {
        const subProjectId =
            this.props.monitor.projectId._id || this.props.monitor.projectId;
        this.props.fetchMonitorsSubscribers(
            subProjectId,
            this.props.monitor._id,
            this.props.monitor.subscribers.skip
                ? parseInt(this.props.monitor.subscribers.skip, 10) - 5
                : 5,
            5
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > PREVIOUS SUBSCRIBER CLICKED',
                {
                    projectId: subProjectId,
                }
            );
        }
    };

    nextClicked = () => {
        const subProjectId =
            this.props.monitor.projectId._id || this.props.monitor.projectId;
        this.props.fetchMonitorsSubscribers(
            subProjectId,
            this.props.monitor._id,
            this.props.monitor.subscribers.skip
                ? parseInt(this.props.monitor.subscribers.skip, 10) + 5
                : 5,
            5
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > NEXT SUBSCRIBER CLICKED',
                {
                    projectId: this.props.currentProject._id,
                }
            );
        }
    };

    render() {
        const { createSubscriberModalId, uploadSubscriberModalId } = this.state;
        const creating = this.props.create ? this.props.create : false;
        const exporting = this.props.export ? this.props.export : false;
        const subProjectId =
            this.props.monitor.projectId._id || this.props.monitor.projectId;
        const { monitorId } = this.props;

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>External Subscribers</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                These are your external customers who needs to
                                be notified, and not your team members. If you
                                like to send notification to team members - use{' '}
                                <span
                                    onClick={() =>
                                        history.push(
                                            `/dashboard/project/${this.props.currentProject._id}/on-call`
                                        )
                                    }
                                    style={{
                                        cursor: 'pointer',
                                        textDecoration: 'underline',
                                    }}
                                >
                                    call schedules
                                </span>{' '}
                                instead.
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <button
                                className={
                                    creating
                                        ? 'bs-Button bs-Button--blue'
                                        : 'bs-Button bs-ButtonLegacy ActionIconParent'
                                }
                                type="button"
                                disabled={creating}
                                id="addSubscriberButton"
                                onClick={() =>
                                    this.props.openModal({
                                        id: createSubscriberModalId,
                                        onClose: () =>
                                            this.props.closeModal({
                                                id: this.state
                                                    .createSubscriberModalId,
                                            }),
                                        content: DataPathHoC(CreateSubscriber, {
                                            monitorId,
                                            subProjectId,
                                        }),
                                    })
                                }
                            >
                                <ShouldRender if={!creating}>
                                    <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                        <span>Add New Subscriber</span>
                                    </span>
                                </ShouldRender>
                                <ShouldRender if={creating}>
                                    <FormLoader />
                                </ShouldRender>
                            </button>
                            <RenderIfSubProjectAdmin
                                subProjectId={subProjectId}
                            >
                                <button
                                    id="importFromCsv"
                                    className={
                                        exporting
                                            ? 'bs-Button bs-Button--blue'
                                            : 'bs-Button bs-ButtonLegacy ActionIconParent'
                                    }
                                    type="button"
                                    disabled={exporting}
                                    onClick={() => {
                                        this.props.openModal({
                                            id: uploadSubscriberModalId,
                                            onClose: () =>
                                                this.props.closeModal({
                                                    id: uploadSubscriberModalId,
                                                }),
                                            content: DataPathHoC(
                                                UploadFileForm,
                                                {
                                                    monitorId,
                                                    subProjectId,
                                                }
                                            ),
                                        });
                                    }}
                                >
                                    <ShouldRender if={!exporting}>
                                        <span className="bs-Button--icon bs-Button--upload">
                                            <span>Import CSV</span>
                                        </span>
                                    </ShouldRender>
                                    <ShouldRender if={exporting}>
                                        <FormLoader />
                                    </ShouldRender>
                                </button>
                                <button
                                    className={
                                        exporting
                                            ? 'bs-Button bs-Button--blue'
                                            : 'bs-Button bs-ButtonLegacy ActionIconParent'
                                    }
                                    type="button"
                                    disabled={exporting}
                                    onClick={() =>
                                        this.props.exportCSV(
                                            subProjectId,
                                            monitorId,
                                            0,
                                            100,
                                            'csv'
                                        )
                                    }
                                >
                                    <ShouldRender if={!exporting}>
                                        <span className="bs-Button--icon bs-Button--download">
                                            <span>Export to CSV</span>
                                        </span>
                                    </ShouldRender>
                                    <ShouldRender if={exporting}>
                                        <FormLoader />
                                    </ShouldRender>
                                </button>
                            </RenderIfSubProjectAdmin>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <SubscriberList
                        monitorId={monitorId}
                        subProjectId={subProjectId}
                        prevClicked={this.prevClicked}
                        nextClicked={this.nextClicked}
                    />
                </div>
            </div>
        );
    }
}

MonitorViewSubscriberBox.displayName = 'MonitorViewSubscriberBox';

MonitorViewSubscriberBox.propTypes = {
    monitor: PropTypes.object.isRequired,
    currentProject: PropTypes.object.isRequired,
    fetchMonitorsSubscribers: PropTypes.func.isRequired,
    monitorId: PropTypes.string.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func,
    create: PropTypes.bool,
    export: PropTypes.bool,
    exportCSV: PropTypes.func.isRequired,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchMonitorsSubscribers,
            closeModal,
            openModal,
            exportCSV,
        },
        dispatch
    );

const mapStateToProps = (state, props) => {
    const monitor = state.monitor.monitorsList.monitors
        .map(monitor =>
            monitor.monitors.find(monitor => monitor._id === props.monitorId)
        )
        .filter(monitor => monitor)[0];
    return {
        monitor,
        currentProject: state.project.currentProject,
        create: state.subscriber.newSubscriber.requesting,
        export: state.subscriber.csvExport.requesting,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(MonitorViewSubscriberBox);
