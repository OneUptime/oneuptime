import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import GroupForm from './GroupForm';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import { openModal, closeModal } from '../../actions/modal';
import removeGroup from '../modals/removeGroup';

export class GroupTable extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { groupModalId: uuidv4() };
    }

    handleEdit = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        const { openModal, group, projectId } = this.props;
        openModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'groupModalId' does not exist on type 'Re... Remove this comment to see the full error message
            id: this.state.groupModalId,
            content: DataPathHoC(GroupForm, {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'groupModalId' does not exist on type 'Re... Remove this comment to see the full error message
                groupModalId: this.state.groupModalId,
                editGroup: true,
                projectId: projectId,
                groupName: group.name,
                teams: group.teams,
                groupId: group._id,
            }),
        });
    };

    handleRemove = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        const { openModal, group, projectId } = this.props;
        openModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'groupModalId' does not exist on type 'Re... Remove this comment to see the full error message
            id: this.state.groupModalId,
            content: DataPathHoC(removeGroup, {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'groupModalId' does not exist on type 'Re... Remove this comment to see the full error message
                groupModalId: this.state.groupModalId,
                projectId: projectId,
                groupName: group.name,
                groupId: group._id,
            }),
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'group' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { group, disabled, deleteDisable } = this.props;
        return (
            <div className="bs-ObjectList-row db-UserListRow">
                <div
                    className="bs-ObjectList-cell bs-u-v-middle"
                    style={{ padding: '10px 10px 10px 20px' }}
                >
                    <div
                        className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted"
                        id={`sub_project_name_${group.name}`}
                    >
                        {group.name}
                    </div>
                </div>
                <div
                    className="bs-ObjectList-cell bs-u-v-middle"
                    style={{ padding: '10px' }}
                >
                    <div className="bs-ObjectList-cell-row">
                        {group.teams.length > 0
                            ? group.teams.length === 1
                                ? group.teams[0].name
                                    ? group.teams[0].name
                                    : group.teams[0].email
                                : `${
                                      group.teams[0].name
                                          ? group.teams[0].name
                                          : group.teams[0].email
                                  } and ${group.teams.length - 1} other${
                                      group.teams.length - 1 === 1 ? '' : 's'
                                  }`
                            : `No Team member added yet`}
                    </div>
                </div>
                <div
                    className="bs-ObjectList-cell bs-u-right bs-u-shrink bs-u-v-middle Flex-alignContent--spaceBetween"
                    style={{ padding: '10px' }}
                >
                    <div>
                        <div className="Flex-flex Flex-alignContent--spaceBetween">
                            <button
                                title="edit"
                                id={`group_edit_${group.name}`}
                                disabled={disabled[group._id]}
                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                type="button"
                                onClick={() => this.handleEdit()}
                            >
                                <span>Edit</span>
                            </button>
                            <button
                                title="delete"
                                id={`group_delete_${group.name}`}
                                disabled={deleteDisable}
                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                type="button"
                                onClick={() => this.handleRemove()}
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
GroupTable.displayName = 'GroupTable';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
GroupTable.propTypes = {
    openModal: PropTypes.func,
    group: PropTypes.object,
    disabled: PropTypes.bool,
    projectId: PropTypes.string,
    deleteDisable: PropTypes.bool,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ openModal, closeModal }, dispatch);
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        disabled: state.groups.updateGroup.requesting,
        deleteDisable: state.groups.deleteGroup.requesting,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(GroupTable);
