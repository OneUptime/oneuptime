import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import moment from 'moment';
import SubProjectForm from './SubProjectForm';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import { openModal, closeModal } from '../../actions/modal';
import RemoveSubProject from '../modals/RemoveSubProject';
import SubProjectApiKey from '../modals/SubProjectApiKey';
import { User } from '../../config';
import isOwnerOrAdmin from '../../utils/isOwnerOrAdmin';
import Unauthorised from '../modals/Unauthorised';
import isSubProjectViewer from '../../utils/isSubProjectViewer';

export class SubProjectTable extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { subProjectModalId: uuidv4() };
    }

    handleRevealAPIKey = (userId: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        const { openModal, subProject, currentProject } = this.props;
        isOwnerOrAdmin(userId, currentProject) &&
        !isSubProjectViewer(userId, subProject)
            ? openModal({
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
                  id: this.state.subProjectModalId,
                  content: DataPathHoC(SubProjectApiKey, {
                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
                      subProjectModalId: this.state.subProjectModalId,
                      subProjectId: subProject._id,
                      subProjectTitle: subProject.name,
                  }),
              })
            : openModal({
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
                  id: this.state.subProjectModalId,
                  // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
                  content: DataPathHoC(Unauthorised),
              });
    };

    handleEdit = (userId: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        const { openModal, subProject, currentProject } = this.props;
        isOwnerOrAdmin(userId, currentProject) &&
        !isSubProjectViewer(userId, subProject)
            ? openModal({
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
                  id: this.state.subProjectModalId,
                  content: DataPathHoC(SubProjectForm, {
                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
                      subProjectModalId: this.state.subProjectModalId,
                      editSubProject: true,
                      subProjectId: subProject._id,
                      subProjectTitle: subProject.name,
                  }),
              })
            : openModal({
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
                  id: this.state.subProjectModalId,
                  // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
                  content: DataPathHoC(Unauthorised),
              });
    };

    handleRemove = (userId: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        const { openModal, subProject, currentProject } = this.props;
        isOwnerOrAdmin(userId, currentProject) &&
        !isSubProjectViewer(userId, subProject)
            ? openModal({
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
                  id: this.state.subProjectModalId,
                  content: DataPathHoC(RemoveSubProject, {
                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
                      subProjectModalId: this.state.subProjectModalId,
                      subProjectId: subProject._id,
                      subProjectTitle: subProject.name,
                  }),
              })
            : openModal({
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
                  id: this.state.subProjectModalId,
                  // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
                  content: DataPathHoC(Unauthorised),
              });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProject' does not exist on type 'Read... Remove this comment to see the full error message
        const { subProject, subProjectState } = this.props;
        const disabled =
            subProjectState.subProjects.requesting ||
            subProjectState.newSubProject.requesting ||
            subProjectState.renameSubProject.requesting;
        const userId = User.getUserId();

        return (
            <div className="bs-ObjectList-row db-UserListRow">
                <div
                    className="bs-ObjectList-cell bs-u-v-middle"
                    style={{ padding: '10px 10px 10px 20px' }}
                >
                    <div
                        className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted"
                        id={`sub_project_name_${subProject.name}`}
                    >
                        {subProject.name}
                    </div>
                </div>
                <div
                    className="bs-ObjectList-cell bs-u-v-middle"
                    style={{ padding: '10px' }}
                >
                    <div className="bs-ObjectList-cell-row">
                        {subProject.parentProjectId
                            ? subProject.parentProjectId._id ||
                              subProject.parentProjectId
                            : ''}
                    </div>
                </div>
                <div
                    className="bs-ObjectList-cell bs-u-v-middle"
                    style={{ padding: '10px' }}
                >
                    <div className="bs-ObjectList-cell-row">
                        <span>
                            {moment(subProject.createdAt).format('lll')}
                        </span>
                    </div>
                </div>
                <div
                    className="bs-ObjectList-cell bs-u-right bs-u-shrink bs-u-v-middle Flex-alignContent--spaceBetween"
                    style={{ padding: '10px' }}
                >
                    <div>
                        <div className="Flex-flex Flex-alignContent--spaceBetween">
                            <button
                                title="apiKey"
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'loop' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                id={`sub_project_api_key_${this.props.loop}`}
                                disabled={disabled}
                                className="bs-Button bs-DeprecatedButton"
                                type="button"
                                onClick={() => this.handleRevealAPIKey(userId)}
                            >
                                <span>Reveal API Key</span>
                            </button>
                            <button
                                title="edit"
                                id={`sub_project_edit_${subProject.name}`}
                                disabled={disabled}
                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                type="button"
                                onClick={() => this.handleEdit(userId)}
                            >
                                <span>Edit</span>
                            </button>
                            <button
                                title="delete"
                                id={`sub_project_delete_${subProject.name}`}
                                disabled={disabled}
                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                type="button"
                                onClick={() => this.handleRemove(userId)}
                            >
                                <span>Remove</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SubProjectTable.displayName = 'SubProjectTable';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SubProjectTable.propTypes = {
    loop: PropTypes.number,
    openModal: PropTypes.func,
    subProject: PropTypes.object,
    subProjectState: PropTypes.object,
    currentProject: PropTypes.object,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ openModal, closeModal }, dispatch);
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        subProjectState: state.subProject,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(SubProjectTable);
