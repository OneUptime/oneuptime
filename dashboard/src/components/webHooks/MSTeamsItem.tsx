import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { deleteMsTeams, updateMsTeams } from '../../actions/msteamsWebhook';
import { openModal, closeModal } from 'common-ui/actions/modal';
import DeleteMsTeams from '../modals/DeleteMsTeamsWebhook';
import EditMsTeams from '../modals/EditMsTeamsWebhook';
import RenderIfAdmin from '../basic/RenderIfAdmin';
import DataPathHoC from '../DataPathHoC';

class MSTeamsItem extends React.Component {
    deleteItem = () => {
        const {

            monitors,

            monitorId,

            data,

            deleteMsTeams,

            updateMsTeams,

            currentProject,
        } = this.props;

        //check if monitorId is present
        //if the webhook contains more than one monitor just remove the monitor from it
        //if not delete the monitor
        if (monitorId) {
            const newMonitors = monitors
                .filter((monitor: $TSFixMe) => monitor.monitorId._id !== monitorId)
                .map((monitor: $TSFixMe) => ({
                    monitorId: monitor.monitorId._id
                }));

            if (newMonitors.length > 0) {
                const postObj = {};

                postObj.endpoint = data && data.data.endpoint;

                postObj.webHookName = data && data.webHookName;

                postObj.monitors = newMonitors;

                postObj.type = 'msteams';

                postObj.endpointType = data && data.data.endpointType;


                postObj.incidentCreated =
                    data && data.notificationOptions.incidentCreated;

                postObj.incidentResolved =
                    data && data.notificationOptions.incidentResolved;

                postObj.incidentAcknowledged =
                    data && data.notificationOptions.incidentAcknowledged;

                postObj.incidentNoteAdded =
                    data && data.notificationOptions.incidentNoteAdded;

                return updateMsTeams(currentProject._id, data._id, postObj);
            } else {
                return deleteMsTeams(currentProject._id, data._id);
            }
        } else {
            return deleteMsTeams(currentProject._id, data._id);
        }
    };

    getMonitors(monitors: $TSFixMe) {
        const gt = (i: $TSFixMe) => monitors.length > i;

        let temp = gt(0) ? monitors[0].name : 'Not Yet Added';
        temp += gt(1)
            ? ` and ${monitors.length - 1} other${gt(2) ? 's' : ''}`
            : '';

        return temp;
    }

    render() {

        const { data, monitorId, webhooks, monitors } = this.props;
        const { webHookName } = data.data;
        let deleting = false;
        const monitorName = monitors && monitors[0].monitorId.name;
        const monitorTitle =
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
            <tr className="webhook-list-item Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink msteam-length">
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
                                <span id={`msteam_${webHookName}`}>
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
                                        id={`edit_msteam_${webHookName}`}
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={() =>

                                            this.props.openModal({
                                                id: data._id,
                                                onClose: () => '',
                                                content: DataPathHoC(
                                                    EditMsTeams,
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
                                        id={`delete_msteam_${webHookName}`}
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={() =>

                                            this.props.openModal({
                                                id: data._id,
                                                onClose: () => '',
                                                onConfirm: () =>
                                                    this.deleteItem(),
                                                content: DataPathHoC(
                                                    DeleteMsTeams,
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


MSTeamsItem.displayName = 'WebHookInput';

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        deleteMsTeams,
        updateMsTeams,
        openModal,
        closeModal,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => ({
    webhooks: state.webHooks,
    team: state.team,
    currentProject: state.project.currentProject
});


MSTeamsItem.propTypes = {
    currentProject: PropTypes.object.isRequired,
    deleteMsTeams: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    data: PropTypes.object.isRequired,
    monitorId: PropTypes.string,
    webhooks: PropTypes.object,
    monitors: PropTypes.array,
    updateMsTeams: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(MSTeamsItem);
