import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import GroupTable from './GroupTable';
import GroupForm from './addGroupModal';
import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import { openModal, closeModal } from '../../actions/modal';
import { getProjectGroups } from '../../actions/group';
import isOwnerOrAdmin from '../../utils/isOwnerOrAdmin';
import { User } from '../../config';
import Unauthorised from '../modals/Unauthorised';
import Badge from '../common/Badge';

export class GroupList extends Component {
    constructor(props) {
        super(props);
        this.state = { groupModalId: uuidv4(), page: 1 };
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = e => {
        const { modalId, modalList } = this.props;
        const { subProjectModalId } = this.state;

        if (e.target.localName === 'body' && e.key) {
            switch (e.key) {
                case 'N':
                case 'n':
                    if (
                        modalList.length === 0 &&
                        modalId !== subProjectModalId
                    ) {
                        e.preventDefault();
                        return this.handleAddSubProject();
                    }
                    return false;
                default:
                    return false;
            }
        }
    };

    paginatePrev = () => {
        const { skip, getProjectGroups } = this.props;
        getProjectGroups(this.props.project.id, skip ? skip - 10 : 10, 10);
        this.setState({
            page: this.state.page === 1 ? 1 : this.state.page - 1,
        });
    };

    paginateNext = () => {
        const { skip, getProjectGroups } = this.props;
        getProjectGroups(this.props.project.id, skip ? skip + 10 : 10, 10);
        this.setState({ page: this.state.page + 1 });
    };

    handleAddSubProject = () => {
        const { currentProject, openModal } = this.props;
        const userId = User.getUserId();
        isOwnerOrAdmin(userId, currentProject)
            ? openModal({
                  id: this.state.groupModalId,
                  content: DataPathHoC(GroupForm, {
                      groupModalId: this.state.groupModalId,
                      projectModa: this.props.project,
                      editGroup: false,
                      subProjectId: this.props.project,
                      subProjectTitle: null,
                      projectId: this.props.project.id,
                      parentProject: this.props.parentProject,
                  }),
              })
            : openModal({
                  id: this.state.groupModalId,
                  content: DataPathHoC(Unauthorised),
              });
    };

    render() {
        const {
            limit,
            skip,
            count,
            groupError,
            groups,
            project,
            parentProject,
            createGroupRequest,
        } = this.props;
        const canNext = count > skip + limit ? false : true;
        const canPrev = skip <= 0 ? true : false;
        const _this = this;
        const numbersOfPage = Math.ceil(parseInt(count) / 10);

        return (
            <div className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div
                                className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16"
                                style={{ paddingRight: '0' }}
                            >
                                <div className="Box-root Padding-top--20">
                                    <Badge
                                        color={parentProject ? 'red' : 'blue'}
                                    >
                                        {parentProject
                                            ? 'Project'
                                            : project.name}
                                    </Badge>
                                </div>
                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                {parentProject
                                                    ? 'Project'
                                                    : project.name}{' '}
                                                Groups
                                            </span>
                                        </span>
                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                Here are all the Groups which
                                                belong to {` ${project.name} `}{' '}
                                                Project
                                            </span>
                                        </span>
                                    </div>
                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                        <div className="Box-root">
                                            <button
                                                id="btn_Add_SubProjects"
                                                disabled={
                                                    createGroupRequest.requesting
                                                }
                                                onClick={
                                                    this.handleAddSubProject
                                                }
                                                className="Button bs-ButtonLegacy ActionIconParent"
                                                type="button"
                                            >
                                                <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                                    </div>
                                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                                        <span>Add Group</span>
                                                        <span className="new-btn__keycode">
                                                            N
                                                        </span>
                                                    </span>
                                                </div>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-content Box-root">
                                <div className="bs-ObjectList db-UserList">
                                    <div
                                        style={{
                                            overflow: 'hidden',
                                            overflowX: 'auto',
                                        }}
                                    >
                                        <div className="bs-ObjectList-rows">
                                            <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                                <div className="bs-ObjectList-cell">
                                                    Name
                                                </div>
                                                <div className="bs-ObjectList-cell">
                                                    Members
                                                </div>
                                                <div
                                                    className="bs-ObjectList-cell"
                                                    style={{
                                                        float: 'right',
                                                        paddingRight: '12px',
                                                    }}
                                                >
                                                    Actions
                                                </div>
                                            </header>
                                            {groups && groups.length > 0
                                                ? groups.map(group => {
                                                      return (
                                                          <GroupTable
                                                              group={group}
                                                              projectId={
                                                                  group
                                                                      .projectId
                                                                      ._id
                                                              }
                                                              key={group._id}
                                                          />
                                                      );
                                                  })
                                                : ''}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <ShouldRender if={groups && groups.length <= 0}>
                                <div
                                    className="Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                    style={{
                                        textAlign: 'center',
                                        marginTop: '20px',
                                        padding: '0 10px',
                                    }}
                                >
                                    You don&#39;t have any group at this time!
                                </div>
                            </ShouldRender>
                            <div
                                className={`bs-Tail bs-Tail--separated bs-Tail--short`}
                                style={{
                                    marginTop: '0px',
                                    marginBottom: '0px',
                                }}
                            >
                                <ShouldRender if={groupError.error}>
                                    <div className="bs-Tail-copy">
                                        <div
                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                            style={{ marginTop: '10px' }}
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {groupError.error}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                                <ShouldRender if={!groupError.error}>
                                    <div className="bs-Tail-copy Text-fontWeight--medium">
                                        <span>
                                            {numbersOfPage > 0
                                                ? `Page ${
                                                      this.state.page
                                                  } of ${numbersOfPage} (${count} Group${
                                                      count === 1 ? '' : 's'
                                                  })`
                                                : `${count} Group${
                                                      count === 1 ? '' : 's'
                                                  }`}
                                        </span>
                                    </div>
                                </ShouldRender>
                                <div className="bs-Tail-actions">
                                    <div className="ButtonGroup Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                        <div className="Box-root Margin-right--8">
                                            <button
                                                data-test="SubProjects-paginationButton"
                                                className={
                                                    'Button bs-ButtonLegacy'
                                                }
                                                type="button"
                                                disabled={canPrev}
                                                onClick={() =>
                                                    _this.paginatePrev()
                                                }
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
                                                data-test="SubProjects-paginationButton"
                                                className={
                                                    'Button bs-ButtonLegacy'
                                                }
                                                type="button"
                                                disabled={canNext}
                                                onClick={() =>
                                                    _this.paginateNext()
                                                }
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
                    </div>
                </div>
            </div>
        );
    }
}

GroupList.displayName = 'GroupList';

GroupList.propTypes = {
    count: PropTypes.number,
    currentProject: PropTypes.object,
    limit: PropTypes.number,
    openModal: PropTypes.func,
    skip: PropTypes.number,
    groupError: PropTypes.object,
    modalId: PropTypes.string,
    modalList: PropTypes.array,
    project: PropTypes.object,
    parentProject: PropTypes.bool,
    groups: PropTypes.array,
    getProjectGroups: PropTypes.func,
    createGroupRequest: PropTypes.object,
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        { openModal, closeModal, getProjectGroups },
        dispatch
    );
};

const mapStateToProps = state => {
    return {
        groupError: state.groups.getGroups,
        currentProject: state.project.currentProject,
        createGroupRequest: state.groups.createGroup,
        modalId: state.modal.modals[0] ? state.modal.modals[0].id : '',
        modalList: state.modal.modals,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(GroupList);
