import React, { Component } from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { bindActionCreators } from 'redux'
import moment from 'moment'
import SubProjectForm from './SubProjectForm'
import uuid from 'uuid'
import DataPathHoC from '../DataPathHoC'
import { openModal, closeModal } from '../../actions/modal'
import RemoveSubProject from '../modals/RemoveSubProject'
import SubProjectApiKey from '../modals/SubProjectApiKey'

export class SubProjectTable extends Component {
	constructor(props) {
		super(props)
		this.state = { subProjectModalId: uuid.v4() }
	}
	render() {
		const { subProject, subProjectState } = this.props
		const disabled =
			subProjectState.subProjects.requesting ||
			subProjectState.newSubProject.requesting ||
			subProjectState.renameSubProject.requesting
		return (
			<div className='bs-ObjectList-row db-UserListRow'>
				<div className='bs-ObjectList-cell bs-u-v-middle' style={{ padding: '10px 10px 10px 20px' }}>
					<div className='bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted' id={`sub_project_name_${this.props.loop}`}>
						{subProject.name}
					</div>
				</div>
				<div className='bs-ObjectList-cell bs-u-v-middle' style={{ padding: '10px' }}>
					<div className='bs-ObjectList-cell-row'>
						{subProject.parentProjectId && subProject.parentProjectId._id ? subProject.parentProjectId._id : ''}
					</div>
				</div>
				<div className='bs-ObjectList-cell bs-u-v-middle' style={{ padding: '10px' }}>
					<div className='bs-ObjectList-cell-row'>
						<span>{moment(subProject.createdAt).format('lll')}</span>
					</div>
				</div>
				<div className='bs-ObjectList-cell bs-u-v-middle' style={{ padding: '10px' }}></div>
				<div
					className='bs-ObjectList-cell bs-u-right bs-u-shrink bs-u-v-middle Flex-alignContent--spaceBetween'
					style={{ padding: '10px' }}>
					<div>
						<div className='Flex-flex Flex-alignContent--spaceBetween'>
							<button
								title='apiKey'
								id={`sub_project_api_key_${this.props.loop}`}
								disabled={disabled}
								className='bs-Button bs-DeprecatedButton Margin-left--8'
								type='button'
								onClick={() =>
									this.props.openModal({
										id: this.state.subProjectModalId,
										content: DataPathHoC(SubProjectApiKey, {
											subProjectModalId: this.state.subProjectModalId,
											subProjectId: subProject._id,
											subProjectTitle: subProject.name,
										})
									})
								}>
								<span>Reveal Api Key</span>
							</button>
							<button
								title='edit'
								id={`sub_project_edit_${this.props.loop}`}
								disabled={disabled}
								className='bs-Button bs-DeprecatedButton Margin-left--8'
								type='button'
								onClick={() =>
									this.props.openModal({
										id: this.state.subProjectModalId,
										content: DataPathHoC(SubProjectForm, {
											subProjectModalId: this.state.subProjectModalId,
											editSubProject: true,
											subProjectId: subProject._id,
											subProjectTitle: subProject.name
										})
									})
								}>
								<span>Edit</span>
							</button>
							<button
								title='delete'
								id={`sub_project_delete_${this.props.loop}`}
								disabled={disabled}
								className='bs-Button bs-DeprecatedButton Margin-left--8'
								type='button'
								onClick={() =>
									this.props.openModal({
										id: this.state.subProjectModalId,
										content: DataPathHoC(RemoveSubProject, {
											subProjectModalId: this.state.subProjectModalId,
											subProjectId: subProject._id,
											subProjectTitle: subProject.name
										})
									})
								}>
								<span>Remove</span>
							</button>
						</div>
					</div>
				</div>
			</div>
		)
	}
}

SubProjectTable.displayName = 'SubProjectTable'

SubProjectTable.propTypes = {
  loop: PropTypes.number,
  openModal: PropTypes.func,
  subProject: PropTypes.object,
  subProjectState: PropTypes.object
}

const mapDispatchToProps = dispatch => {
	return bindActionCreators({ openModal, closeModal }, dispatch)
}

const mapStateToProps = state => {
	return {
		currentProject: state.project.currentProject,
		subProjectState: state.subProject
	}
}

SubProjectTable.contextTypes = {
	mixpanel: PropTypes.object.isRequired
}

export default connect(mapStateToProps, mapDispatchToProps)(SubProjectTable)
