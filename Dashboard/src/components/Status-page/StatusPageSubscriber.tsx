import React, { Component, useState } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { fetchStatusPageSubscribers } from '../../actions/statusPage';
import PropTypes from 'prop-types';

import countryTelephoneCode from 'country-telephone-code';
import { RenderIfSubProjectAdmin } from '../basic/RenderIfSubProjectAdmin';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader2, ListLoader } from '../basic/Loader';

import { v4 as uuidv4 } from 'uuid';
import DeleteSubscriber from '../../components/modals/DeleteSubscriber';
import DataPathHoC from '../DataPathHoC';
import { openModal, closeModal } from 'Common-ui/actions/modal';
import { deleteSubscriber } from '../../actions/subscriber';
import CreateSubscriber from '../modals/CreateSubscriber';
import NoMonitorSubscriber from '../modals/NoMonitorSubscriber';

interface StatusPageSubscriberProps {
    fetchStatusPageSubscribers?: Function;
    subscribers?: object;
    projectId?: string;
    openModal?: Function;
    closeModal?: Function;
    deleteSubscriber?: Function;
    currentProject?: object;
    subProjects?: unknown[];
    statusPage?: object;
    monitors?: unknown[];
}

class StatusPageSubscriber extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            createSubscriberModalId: uuidv4(),
            deleteSubscriberModalId: uuidv4(),
            limit: 10,
        };
    }

    deleteSubscriber = async (_projectId: string, _id: $TSFixMe, setLoading: $TSFixMe) => {
        const {

            fetchStatusPageSubscribers,

            statusPage,

            projectId,

            subscribers,
        } = this.props;

        const result = await this.props.deleteSubscriber(_projectId, _id);
        if (result.status === 200) {
            setLoading(false);
            await fetchStatusPageSubscribers(
                projectId,
                statusPage._id,
                parseInt(subscribers.skip, 10),

                this.state.limit
            );
        }
    };

    async override componentDidMount() {
        const {

            fetchStatusPageSubscribers,

            statusPage,

            projectId,
        } = this.props;
        await fetchStatusPageSubscribers(
            projectId,
            statusPage._id,
            0,

            this.state.limit
        );
    }

    nextClicked = async () => {
        const {

            fetchStatusPageSubscribers,

            statusPage,

            projectId,

            subscribers,
        } = this.props;
        await fetchStatusPageSubscribers(
            projectId,
            statusPage._id,

            parseInt(subscribers.skip, 10) + this.state.limit,

            this.state.limit
        );
    };

    prevClicked = async () => {
        const {

            fetchStatusPageSubscribers,

            statusPage,

            projectId,

            subscribers,
        } = this.props;
        await fetchStatusPageSubscribers(
            projectId,
            statusPage._id,

            parseInt(subscribers.skip, 10) - this.state.limit,

            this.state.limit
        );
    };

    override render() {
        const {

            subscribers,

            projectId,

            subProjects,

            currentProject,

            monitors,

            statusPage,
        } = this.props;


        const { createSubscriberModalId, limit } = this.state;

        if (
            subscribers &&
            subscribers.skip &&
            typeof subscribers.skip === 'string'
        ) {
            subscribers.skip = parseInt(subscribers.skip, 10);
        }
        if (
            subscribers &&
            subscribers.limit &&
            typeof subscribers.limit === 'string'
        ) {
            subscribers.limit = parseInt(subscribers.limit, 10);
        }
        if (!subscribers.skip) subscribers.skip = 0;
        if (!subscribers.limit) subscribers.limit = 0;

        let canNext =
            subscribers &&
                subscribers.count &&
                subscribers.count > subscribers.skip + subscribers.limit
                ? true
                : false;
        let canPrev = subscribers && subscribers.skip <= 0 ? false : true;

        if (
            subscribers &&
            (subscribers.requesting || !subscribers.subscribersList)
        ) {
            canNext = false;
            canPrev = false;
        }

        const modal =
            monitors && monitors.length > 0
                ? CreateSubscriber
                : NoMonitorSubscriber;

        return <>
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Status Page Subscribers</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                Subscribers who are subscribed to components
                                on this Status Page.
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <button
                                className="bs-Button bs-ButtonLegacy ActionIconParent"
                                type="button"
                                id="addSubscriberButton"
                                onClick={() =>

                                    this.props.openModal({
                                        id: createSubscriberModalId,
                                        onClose: () =>

                                            this.props.closeModal({
                                                id: createSubscriberModalId,
                                            }),
                                        content: DataPathHoC(modal, {
                                            subProjectId: projectId,
                                            monitorList: monitors,
                                            statusPage,
                                            limit,
                                        }),
                                    })
                                }
                            >
                                <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                    <span>Add New Subscriber</span>
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="div">
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table" id="subscribersList">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        minWidth: '270px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Monitor</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Subscribed From</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    id="placeholder-left"
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        maxWidth: '48px',
                                        minWidth: '48px',
                                        width: '48px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Subscriber</span>
                                        </span>
                                    </div>
                                </td>

                                <td
                                    id="placeholder-right"
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        maxWidth: '48px',
                                        minWidth: '48px',
                                        width: '48px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Alert Via</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    id="overflow"

                                    type="action"
                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                                <RenderIfSubProjectAdmin
                                    subProjectId={projectId}
                                    currentProject={currentProject}
                                    subProjects={subProjects}
                                >
                                    <td
                                        id="overflow"

                                        type="action"
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: '1px' }}
                                    >
                                        <div
                                            className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                            style={{ marginLeft: '43px' }}
                                        >
                                            <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                Action
                                            </span>
                                        </div>
                                    </td>
                                </RenderIfSubProjectAdmin>
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {subscribers &&
                                subscribers.subscribersList &&
                                subscribers.subscribersList.length > 0 ? (
                                subscribers.subscribersList.map(
                                    (subscriber: $TSFixMe, index: $TSFixMe) => (
                                        <tr
                                            className="subscriber-list-item Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink"
                                            key={subscriber._id}
                                        >
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{
                                                    height: '1px',
                                                    minWidth: '270px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root Margin-right--16">
                                                            <span>
                                                                {subscribers.name
                                                                    ? subscribers.name
                                                                    : subscriber.monitorId &&
                                                                        subscriber.monitorName
                                                                        ? subscriber.monitorName
                                                                        : 'Unknown Monitor'}
                                                            </span>
                                                        </div>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root">
                                                                <span>
                                                                    {(subscriber.statusPageId !==
                                                                        undefined &&
                                                                        subscriber.statusPageId !==
                                                                        null &&
                                                                        subscriber.statusPageName) ||
                                                                        'OneUptime Dashboard'}
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                aria-hidden="true"
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                    maxWidth: '48px',
                                                    minWidth: '48px',
                                                    width: '48px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        ⁣
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Flex-flex">
                                                                <div className="Box-root Flex-flex">
                                                                    <div
                                                                        id="subscriber_contact"
                                                                        className="contact db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart"
                                                                    >
                                                                        {(subscriber.contactWebhook && (
                                                                            <div className="db-ListViewItem-link">
                                                                                <div className="Badge Badge--color--yellow Box-background--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2 Margin-right--4">
                                                                                    <span className="Badge-text Text-color--white Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                        <span>
                                                                                            {` ${subscriber.webhookMethod ||
                                                                                                'POST'} `.toUpperCase()}
                                                                                        </span>
                                                                                    </span>
                                                                                </div>
                                                                                {
                                                                                    subscriber.contactWebhook
                                                                                }
                                                                            </div>
                                                                        )) ||
                                                                            subscriber.contactEmail ||
                                                                            (subscriber.contactPhone &&
                                                                                `+${countryTelephoneCode(
                                                                                    subscriber.countryCode.toUpperCase()
                                                                                )}${subscriber.contactPhone
                                                                                }`)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>

                                            <td
                                                aria-hidden="true"
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                    maxWidth: '48px',
                                                    minWidth: '48px',
                                                    width: '48px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        ⁣
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <div className="Badge Badge--color--green Box-background--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                            <span className="Badge-text Text-color--white Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                <span>
                                                                    {
                                                                        subscriber.alertVia
                                                                    }
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                aria-hidden="true"
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                    maxWidth: '48px',
                                                    minWidth: '48px',
                                                    width: '48px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        ⁣
                                                    </div>
                                                </div>
                                            </td>
                                            <RenderIfSubProjectAdmin
                                                subProjectId={projectId}
                                                currentProject={
                                                    currentProject
                                                }
                                                subProjects={subProjects}
                                            >
                                                <td
                                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{
                                                        height: '1px',
                                                    }}
                                                >
                                                    <div className="db-ListViewItem-link">
                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                            <div className="Box-root">
                                                                <span>
                                                                    <RemoveBtn
                                                                        openModal={
                                                                            this
                                                                                .props

                                                                                .openModal
                                                                        }
                                                                        deleteSubscriberModalId={
                                                                            this
                                                                                .state

                                                                                .deleteSubscriberModalId
                                                                        }
                                                                        deleteSubscriber={
                                                                            this
                                                                                .deleteSubscriber
                                                                        }
                                                                        projectId={
                                                                            subscriber.projectId
                                                                        }
                                                                        _id={
                                                                            subscriber._id
                                                                        }

                                                                        loading={
                                                                            this
                                                                                .state

                                                                                .loading
                                                                        }
                                                                        index={
                                                                            index
                                                                        }
                                                                    />
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </RenderIfSubProjectAdmin>
                                        </tr>
                                    )
                                )
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {subscribers.requesting && <ListLoader />}

                <div
                    style={{
                        textAlign: 'center',
                        marginTop: '10px',
                        padding: '0 10px',
                    }}
                >
                    {subscribers &&
                        (!subscribers.subscribersList ||
                            !subscribers.subscribersList.length) &&
                        !subscribers.requesting &&
                        !subscribers.error
                        ? "We don't have any subscribers yet"
                        : null}
                    {subscribers && subscribers.error
                        ? subscribers.error
                        : null}
                </div>

                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <ShouldRender
                                        if={
                                            subscribers && subscribers.count
                                        }
                                    >
                                        <span id="numberOfSubscribers">
                                            {subscribers.count}
                                        </span>{' '}
                                        {subscribers &&
                                            subscribers.count > 1
                                            ? 'Subscribers'
                                            : 'Subscriber'}
                                    </ShouldRender>
                                </span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrevSubscriber"
                                    onClick={this.prevClicked}
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
                                    id="btnNextSubscriber"
                                    onClick={this.nextClicked}
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
        </>;
    }
}


StatusPageSubscriber.displayName = 'StatusPageSubscriber';

const mapStateToProps = (state: RootState) => ({
    subscribers: state.statusPage.subscribers,
    monitors: state.statusPage.status.monitors
});

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    { fetchStatusPageSubscribers, openModal, closeModal, deleteSubscriber },
    dispatch
);


StatusPageSubscriber.propTypes = {
    fetchStatusPageSubscribers: PropTypes.func,
    subscribers: PropTypes.object,
    projectId: PropTypes.string,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
    deleteSubscriber: PropTypes.func,
    currentProject: PropTypes.object,
    subProjects: PropTypes.array,
    statusPage: PropTypes.object,
    monitors: PropTypes.array,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(StatusPageSubscriber);

interface RemoveBtnProps {
    openModal: Function;
    deleteSubscriber: Function;
    deleteSubscriberModalId: string;
    projectId: string;
    _id: string;
    index: number;
}

const RemoveBtn = (props: RemoveBtnProps) => {
    const [loading, setLoading] = useState(false);
    return (
        <>
            <button
                className={
                    loading
                        ? 'bs-Button'
                        : 'bs-Button bs-ButtonLegacy ActionIconParent'
                }
                type="button"
                disabled={loading}
                onClick={() =>
                    props.openModal({
                        id: props.deleteSubscriberModalId,
                        onClose: () => '',
                        onConfirm: () => {
                            setLoading(true);
                            props.deleteSubscriber(
                                props.projectId,
                                props._id,
                                setLoading
                            );
                            return Promise.resolve();
                        },
                        content: DataPathHoC(DeleteSubscriber, {
                            deleting: loading,
                        }),
                    })
                }
                id={`deleteSubscriber_${props.index}`}
            >
                <ShouldRender if={!loading}>
                    <span className="bs-Button--icon bs-Button--trash">
                        <span>Remove</span>
                    </span>
                </ShouldRender>
                <ShouldRender if={loading}>
                    <FormLoader2 />
                </ShouldRender>
            </button>
        </>
    );
};
RemoveBtn.displayName = 'RemoveBtn';

RemoveBtn.propTypes = {
    openModal: PropTypes.func.isRequired,
    deleteSubscriber: PropTypes.func.isRequired,
    deleteSubscriberModalId: PropTypes.string.isRequired,
    projectId: PropTypes.string.isRequired,
    _id: PropTypes.string.isRequired,
    index: PropTypes.number.isRequired,
};
