import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import DeleteCaution from './DeleteCaution';
import { hideDeleteModal, markProjectForDelete, switchProject } from '../../actions/project';
import { history } from '../../store'
import DeleteRequestModal from './DeleteRequesModal';

export class DeleteProjectModal extends Component {

	constructor(props) {
		super(props);
		this.state = {
			deleted: false
		}

		this.deleteProject = this.deleteProject.bind(this);
		this.closeNotice = this.closeNotice.bind(this);
	}

	deleteProject(values) {
		const { projectId, markProjectForDelete } = this.props;

		markProjectForDelete(projectId, values.feedback).then(() => {
			this.setState({deleted: true});
		});
		if(window.location.href.indexOf('localhost') <= -1){
			this.context.mixpanel.track('Project Marked for Deleted', {projectId});
		}
	}

	closeNotice() {
		const { switchProject, nextProject } = this.props;
		this.props.hideDeleteModal()
		if(nextProject)switchProject(nextProject);
		else history.push('/')
		this.props.hideDeleteModal()
	}

	handleKeyBoard = (e)=>{
		switch(e.key){
			case 'Escape':
			return this.props.hideDeleteModal()
			default:
			return false;
		}
    }

	render() {
		const { deleted } = this.state;
		return this.props.visible ? (
			<div onKeyDown={this.handleKeyBoard} className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
				<div
					className="ModalLayer-contents"
					tabIndex={-1}
					style={{ marginTop: 40 }}
				>
					{deleted ?
						<div className="bs-BIM">
							<DeleteRequestModal
								closeNotice={this.closeNotice}
								requesting={this.props.isRequesting}
							/>
						</div>
						:
						<div className="bs-BIM">
							<DeleteCaution
								hide={this.props.hideDeleteModal}
								deleteProject={this.deleteProject}
								requesting={this.props.isRequesting}
							/>
						</div>
					}
				</div>
			</div>
		) : null;
	}
}

DeleteProjectModal.displayName = 'DeleteProjectModal'

const mapDispatchToProps = dispatch => (
	bindActionCreators({
		markProjectForDelete,
		hideDeleteModal,
		switchProject: project => switchProject(dispatch, project)
	}, dispatch)
)

const mapStateToProps = (state, props) => {
	const { projectId } = props.match.params;

	const { projects } = state.project.projects;

	const project = projects !== undefined && projects.length > 0 ? projects.filter(
		project => project._id === projectId
	)[0] : [];

	const nextProject = projects !== undefined && projects.length > 0 ? projects.filter(
		project => project._id !== projectId
	)[0] : {};

	const projectName = project && project.name;

	return {
		projectName,
		projectId,
		nextProject,
		visible: state.project.showDeleteModal,
		isRequesting: state.project.deleteProject.requesting
	}
}

DeleteProjectModal.propTypes = {
	markProjectForDelete: PropTypes.func.isRequired,
	switchProject: PropTypes.func.isRequired,
	hideDeleteModal: PropTypes.func.isRequired,
	nextProject: PropTypes.oneOfType([
		PropTypes.oneOf([null,undefined]),
		PropTypes.object
	]),
	projectId: PropTypes.string,
	visible: PropTypes.bool,
	isRequesting:PropTypes.bool
}

DeleteProjectModal.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(DeleteProjectModal));