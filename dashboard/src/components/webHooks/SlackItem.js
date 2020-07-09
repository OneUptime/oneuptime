import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { deleteSlack } from '../../actions/slackWebhook';
import { openModal, closeModal } from '../../actions/modal';
import EditSlack from '../modals/EditSlackWebhook';
import RenderIfAdmin from '../basic/RenderIfAdmin';
import DataPathHoC from '../DataPathHoC';
import DeleteSlack from '../modals/DeleteSlackWebhook';

class SlackItem extends React.Component {
    deleteItem = () => {
        return this.props.deleteSlack(
            this.props.currentProject._id,
            this.props.data._id
        );
    };

    getMonitors(monitors) {
        const gt = i => monitors.length > i;

        let temp = gt(0) ? monitors[0].name : 'Not Yet Added';
        temp += gt(1)
            ? ` and ${monitors.length - 1} other${gt(2) ? 's' : ''}`
            : '';

        return temp;
    }

    render() {
        const { data, monitorId, webhooks } = this.props;
        const { endpoint } = data.data;
        let deleting = false;

        if (
            webhooks &&
            webhooks.deleteWebHook &&
            webhooks.deleteWebHook.requesting
        ) {
            deleting = true;
        }

        return (
            <tr className="webhook-list-item Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink">
                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell">
                    <div className="db-ListViewItem-cellContent Box-root Padding-vertical--16 Padding-horizontal--8">
                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <div
                                className="Box-root"
                                style={{ width: '200px', overflow: 'hidden' }}
                            >
                                <span>{endpoint}</span>
                            </div>
                        </span>
                    </div>
                </td>

                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell">
                    <div
                        className="db-ListViewItem-cellContent Box-root Padding-all--12 Flex-alignContent--flexEnd"
                        style={{ marginLeft: '-5px' }}
                    >
                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <RenderIfAdmin>
                                <div className="Box-root">
                                    <button
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

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            deleteSlack,
            openModal,
            closeModal,
        },
        dispatch
    );

const mapStateToProps = state => ({
    webhooks: state.webHooks,
    team: state.team,
    currentProject: state.project.currentProject,
});

SlackItem.propTypes = {
    currentProject: PropTypes.object.isRequired,
    deleteSlack: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    data: PropTypes.object.isRequired,
    monitorId: PropTypes.string,
    webhooks: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(SlackItem);
