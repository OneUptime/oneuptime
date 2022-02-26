import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import GroupTable from './GroupTable';
import GroupForm from './GroupForm';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import { openModal, closeModal } from '../../actions/modal';
import { getProjectGroups } from '../../actions/group';
import isOwnerOrAdmin from '../../utils/isOwnerOrAdmin';
import { User } from '../../config';
import Unauthorised from '../modals/Unauthorised';
import Badge from '../common/Badge';

export class GroupList extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { groupModalId: uuidv4() };
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (e: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'modalId' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { modalId, modalList } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectModalId' does not exist on typ... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { skip, getProjectGroups } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
        getProjectGroups(this.props.project.id, skip ? skip - 10 : 10, 10);
        this.setState({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            page: this.state.page === 1 ? 1 : this.state.page - 1,
        });
    };

    paginateNext = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { skip, getProjectGroups } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
        getProjectGroups(this.props.project.id, skip ? skip + 10 : 10, 10);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page + 1 });
    };

    handleAddSubProject = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, openModal } = this.props;
        const userId = User.getUserId();
        isOwnerOrAdmin(userId, currentProject)
            ? openModal({
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'groupModalId' does not exist on type 'Re... Remove this comment to see the full error message
                  id: this.state.groupModalId,
                  content: DataPathHoC(GroupForm, {
                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'groupModalId' does not exist on type 'Re... Remove this comment to see the full error message
                      groupModalId: this.state.groupModalId,
                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                      projectModa: this.props.project,
                      editGroup: false,
                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                      subProjectId: this.props.project,
                      subProjectTitle: null,
                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                      projectId: this.props.project.id,
                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'parentProject' does not exist on type 'R... Remove this comment to see the full error message
                      parentProject: this.props.parentProject,
                  }),
              })
            : openModal({
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'groupModalId' does not exist on type 'Re... Remove this comment to see the full error message
                  id: this.state.groupModalId,
                  // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
                  content: DataPathHoC(Unauthorised),
              });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'limit' does not exist on type 'Readonly<... Remove this comment to see the full error message
            limit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            skip,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
            count,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'groupError' does not exist on type 'Read... Remove this comment to see the full error message
            groupError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'groups' does not exist on type 'Readonly... Remove this comment to see the full error message
            groups,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            project,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'parentProject' does not exist on type 'R... Remove this comment to see the full error message
            parentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createGroupRequest' does not exist on ty... Remove this comment to see the full error message
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
                                <div className="Box-root">
                                    {
                                        <Badge
                                            color={
                                                parentProject ? 'red' : 'blue'
                                            }
                                        >
                                            {parentProject
                                                ? 'Project'
                                                : project.name}
                                        </Badge>
                                    }
                                </div>
                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                {parentProject
                                                    ? 'Project'
                                                    : project.name}{' '}
                                                Team Member Groups
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
                                                        <span>
                                                            Add New Group
                                                        </span>
                                                        {parentProject ? (
                                                            <span className="new-btn__keycode">
                                                                N
                                                            </span>
                                                        ) : null}
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
                                                ? groups.map((group: $TSFixMe) => {
                                                      return (
                                                          <GroupTable
                                                              // @ts-expect-error ts-migrate(2322) FIXME: Type '{ group: any; projectId: any; key: any; }' i... Remove this comment to see the full error message
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
                                                ? `Page ${skip / 10 +
                                                      1} of ${numbersOfPage} (${count} Group${
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
GroupList.displayName = 'GroupList';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        { openModal, closeModal, getProjectGroups },
        dispatch
    );
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        groupError: state.groups.getGroups,
        currentProject: state.project.currentProject,
        createGroupRequest: state.groups.createGroup,
        modalId: state.modal.modals[0] ? state.modal.modals[0].id : '',
        modalList: state.modal.modals,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(GroupList);
