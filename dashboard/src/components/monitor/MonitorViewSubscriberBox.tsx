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
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { exportCSV } from '../../actions/subscriber';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';

import { history } from '../../store';
import UploadFileForm from '../modals/UploadFile';

export class MonitorViewSubscriberBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            createSubscriberModalId: uuidv4(),
            uploadSubscriberModalId: uuidv4(),
        };
    }

    prevClicked = () => {
        const subProjectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor.projectId._id || this.props.monitor.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsSubscribers' does not exist... Remove this comment to see the full error message
        this.props.fetchMonitorsSubscribers(
            subProjectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor._id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor.subscribers.skip
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                ? parseInt(this.props.monitor.subscribers.skip, 10) - 5
                : 5,
            5
        );
    };

    nextClicked = () => {
        const subProjectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor.projectId._id || this.props.monitor.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsSubscribers' does not exist... Remove this comment to see the full error message
        this.props.fetchMonitorsSubscribers(
            subProjectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor._id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor.subscribers.skip
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                ? parseInt(this.props.monitor.subscribers.skip, 10) + 5
                : 5,
            5
        );
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSubscriberModalId' does not exist ... Remove this comment to see the full error message
        const { createSubscriberModalId, uploadSubscriberModalId } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'create' does not exist on type 'Readonly... Remove this comment to see the full error message
        const creating = this.props.create ? this.props.create : false;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'export' does not exist on type 'Readonly... Remove this comment to see the full error message
        const exporting = this.props.export ? this.props.export : false;
        const subProjectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor.projectId._id || this.props.monitor.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Reado... Remove this comment to see the full error message
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                            `/dashboard/project/${this.props.currentProject.slug}/on-call`
                                        )
                                    }
                                    style={{
                                        cursor: 'pointer',
                                        textDecoration: 'underline',
                                    }}
                                >
                                    on-call duties
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                    this.props.openModal({
                                        id: createSubscriberModalId,
                                        onClose: () =>
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                                            this.props.closeModal({
                                                id: this.state
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSubscriberModalId' does not exist ... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                        this.props.openModal({
                                            id: uploadSubscriberModalId,
                                            onClose: () =>
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'exportCSV' does not exist on type 'Reado... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ monitorId: any; subProjectId: any; prevCli... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
MonitorViewSubscriberBox.displayName = 'MonitorViewSubscriberBox';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        fetchMonitorsSubscribers,
        closeModal,
        openModal,
        exportCSV,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const monitor = state.monitor.monitorsList.monitors
        .map((monitor: $TSFixMe) => monitor.monitors.find((monitor: $TSFixMe) => monitor._id === props.monitorId)
        )
        .filter((monitor: $TSFixMe) => monitor)[0];
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
