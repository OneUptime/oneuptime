import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { deleteSlack, updateSlack } from '../../actions/slackWebhook';
import { openModal, closeModal } from 'CommonUI/actions/modal';
import EditSlack from '../modals/EditSlackWebhook';
import RenderIfAdmin from '../basic/RenderIfAdmin';
import DataPathHoC from '../DataPathHoC';
import DeleteSlack from '../modals/DeleteSlackWebhook';

interface SlackItemProps {
    currentProject: object;
    deleteSlack: Function;
    openModal: Function;
    data: object;
    monitorId?: string;
    webhooks?: object;
    monitors?: unknown[];
    updateSlack?: Function;
}

class SlackItem extends React.Component<SlackItemProps> {
    deleteItem = () => {
        const {

            monitors,

            monitorId,

            data,

            updateSlack,

            currentProject,

            deleteSlack,
        } = this.props;

        //check if monitorId is present
        //if the webhook contains more than one monitor just remove the monitor from it
        //if not delete the monitor
        if (monitorId) {
            const newMonitors: $TSFixMe = monitors
                .filter((monitor: $TSFixMe) => monitor.monitorId._id !== monitorId)
                .map((monitor: $TSFixMe) => ({
                    monitorId: monitor.monitorId._id
                }));

            if (newMonitors.length > 0) {
                const postObj: $TSFixMe = {};

                postObj.endpoint = data && data.data.endpoint;

                postObj.webHookName = data && data.webHookName;

                postObj.monitors = newMonitors;

                postObj.type = 'slack';

                postObj.endpointType = data && data.data.endpointType;


                postObj.incidentCreated =
                    data && data.notificationOptions.incidentCreated;

                postObj.incidentResolved =
                    data && data.notificationOptions.incidentResolved;

                postObj.incidentAcknowledged =
                    data && data.notificationOptions.incidentAcknowledged;

                postObj.incidentNoteAdded =
                    data && data.notificationOptions.incidentNoteAdded;

                return updateSlack(currentProject._id, data._id, postObj);
            } else {
                return deleteSlack(currentProject._id, data._id);
            }
        } else {
            return deleteSlack(currentProject._id, data._id);
        }
    };

    getMonitors(monitors: $TSFixMe) {
        const gt: Function = (i: $TSFixMe) => monitors.length > i;

        let temp = gt(0) ? monitors[0].name : 'Not Yet Added';
        temp += gt(1)
            ? ` and ${monitors.length - 1} other${gt(2) ? 's' : ''}`
            : '';

        return temp;
    }

    override render() {

        const { data, monitorId, webhooks, monitors }: $TSFixMe = this.props;
        const { webHookName }: $TSFixMe = data.data;
        let deleting = false;
        const monitorName: $TSFixMe = monitors && monitors[0].monitorId.name;
        const monitorTitle: $TSFixMe =
            monitors && monitors.length > 1
                ? `${monitorName} and ${monitors?.length - 1} other${monitors?.length - 1 === 1 ? '' : 's'
                }`
                : monitorName;
        if (
            webhooks &&
            webhooks.deleteWebHook &&
            webhooks.deleteWebHook.requesting
        ) {
            deleting = true;
        }

        return (
            <tr className="webhook-list-item Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink slack-list">
                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell">
                    <div className="db-ListViewItem-cellContent Box-root Padding-vertical--16 Padding-horizontal--8">
                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <div
                                className="Box-root"
                                style={{
                                    width: '300px',
                                    textOverflow: 'ellipsis',
                                    overflow: 'hidden',
                                }}
                            >
                                <span id={`name_slack_${webHookName}`}>
                                    {webHookName}
                                </span>
                            </div>
                        </span>
                    </div>
                </td>
                {!monitorId && monitorTitle && (
                    <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell">
                        <div className="db-ListViewItem-cellContent Box-root Padding-vertical--16 Padding-horizontal--8">
                            <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <div
                                    className="Box-root"
                                    style={{
                                        width: '300px',
                                        textOverflow: 'ellipsis',
                                        overflow: 'hidden',
                                    }}
                                >
                                    <span>{monitorTitle}</span>
                                </div>
                            </span>
                        </div>
                    </td>
                )}

                <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell">
                    <div
                        className="db-ListViewItem-cellContent Box-root Padding-all--12 Flex-alignContent--flexEnd"
                        style={{ marginLeft: '-5px' }}
                    >
                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <RenderIfAdmin>
                                <div className="Box-root">
                                    <button
                                        id={`edit_slack_${webHookName}`}
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={() =>

                                            this.props.openModal({
                                                id: data._id,
                                                onClose: () => '',
                                                content: DataPathHoC(
                                                    EditSlack,
                                                    {
                                                        ...data,
                                                        currentMonitorId: monitorId,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        <span>Edit</span>
                                    </button>
                                    <button
                                        id={`delete_slack_${webHookName}`}
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={() =>

                                            this.props.openModal({
                                                id: data._id,
                                                onClose: () => '',
                                                onConfirm: () =>
                                                    this.deleteItem(),
                                                content: DataPathHoC(
                                                    DeleteSlack,
                                                    { deleting }
                                                ),
                                            })
                                        }
                                    >
                                        <span>Delete</span>
                                    </button>
                                </div>
                            </RenderIfAdmin>
                        </span>
                    </div>
                </td>
            </tr>
        );
    }
}


SlackItem.displayName = 'SlackItem';

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        deleteSlack,
        openModal,
        closeModal,
        updateSlack,
    },
    dispatch
);

const mapStateToProps: Function = (state: RootState) => ({
    webhooks: state.webHooks,
    team: state.team,
    currentProject: state.project.currentProject
});


SlackItem.propTypes = {
    currentProject: PropTypes.object.isRequired,
    deleteSlack: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    data: PropTypes.object.isRequired,
    monitorId: PropTypes.string,
    webhooks: PropTypes.object,
    monitors: PropTypes.array,
    updateSlack: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(SlackItem);
