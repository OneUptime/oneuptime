import React from 'react';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { deleteSlackLink } from '../../actions/slack';
import { openModal, closeModal } from '../../actions/modal';
import DeleteSlackTeam from '../modals/deleteSlackTeam';

class SlackTeamItem extends React.Component {

    constructor(props) {
        super(props);

        this.state = {
            deleteModalId: uuid.v4()
        };
        this.unLink = this.unLink;
    }

    unLink = () => {
        return this.props.deleteSlackLink(this.props.projectId, this.props.team._id);
    }

    render(){
        const { deleteModalId } = this.state;
        const { team, deleteTeam: { requesting } } = this.props;

        if(!team) return null;

        return(
            <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink">
                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell">
                    <div className="db-ListViewItem-cellContent Box-root Padding-all--16">
                        <div className="bs-Fieldset-fields--wide Flex-flex Flex-direction--row Flex-alignItems--center">
                            <img
                                src="data:image/png;base64,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"
                                height="46"
                                width="47"
                                alt="slack team default icon"
                                className="Margin-right--4 Margin-right--20"
                            />
                            <div className=" Flex-alignContent--stretch">
                                <h3 className="Text-fontWeight--bold">
                                    {team.data.teamName && team.data.teamName}
                                </h3>
                                <p>
                                    This project is linked to the
                                    <b> {team.data.teamName && team.data.teamName.toLowerCase()}.slack.com</b> Slack workspace
                                </p>
                            </div>
                        </div>
                    </div>
                </td>
                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell">
                    <div className="db-ListViewItem-cellContent Box-root Padding-all--16"  style={{ position: 'absolute', right: 29, paddingTop: 23 }}>
                        <div className="Box-root">
                            <button
                                className="bs-Button bs-Button--block"
                                disabled={requesting}
                                onClick={ () =>
                                    this.props.openModal({
                                        id: deleteModalId,
                                        onClose: () => '',
                                        onConfirm: () => this.unLink(),
                                        content: DeleteSlackTeam
                                    })
                                }
                            >
                                { requesting ? 'Processing...' : 'Unlink workspace'}
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        )
    }
}

SlackTeamItem.displayName = 'SlackTeamItem';

const mapStateToProps = state => ({
    currentProject: state.project.currentProject,
    deleteTeam: state.slack.deleteTeam,
});

const mapDispatchToProps = dispatch => (
    bindActionCreators({
            openModal,
            closeModal,
            deleteSlackLink
        },
        dispatch
    )
);

SlackTeamItem.propTypes = {
    deleteSlackLink: PropTypes.func,
    deleteTeam: PropTypes.object.isRequired,
    team: PropTypes.object,
    projectId: PropTypes.string,
    openModal: PropTypes.func,
};

SlackTeamItem.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(SlackTeamItem);