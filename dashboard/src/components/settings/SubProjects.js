import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import SubProjectTable from './SubProjectTable';
import SubProjectForm from './SubProjectForm';
import uuid from 'uuid';
import DataPathHoC from '../DataPathHoC';
import { openModal, closeModal } from '../../actions/modal';
import { getSubProjects } from '../../actions/subProject';
import PricingPlan from '../basic/PricingPlan';

export class SubProjects extends Component {
    constructor(props) {
        super(props);
        this.state = { subProjectModalId: uuid.v4() };
    }

    paginatePrev = () => {
        const { skip, getSubProjects, currentProject } = this.props;
        getSubProjects(currentProject._id, skip ? skip - 10 : 10, 10);
    };

    paginateNext = () => {
        const { skip, getSubProjects, currentProject } = this.props;
        getSubProjects(currentProject._id, skip ? skip + 10 : 10, 10);
    };

    render() {
        const { limit, skip, count, subProjectState } = this.props;
        const { subProjects } = subProjectState;
        const canNext = count > skip + limit ? false : true;
        const canPrev = skip <= 0 ? true : false;
        const _this = this;
        return (
            <div className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                            <span>Sub Projects</span>
                                        </span>
                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                Subprojects let’s you have
                                                flexible access controls between
                                                Fyipe resources and your team.
                                            </span>
                                        </span>
                                    </div>
                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                        <div className="Box-root">
                                            <button
                                                id="btn_Add_SubProjects"
                                                disabled={
                                                    subProjectState.requesting
                                                }
                                                onClick={() =>
                                                    this.props.openModal({
                                                        id: this.state
                                                            .subProjectModalId,
                                                        content: DataPathHoC(
                                                            SubProjectForm,
                                                            {
                                                                subProjectModalId: this
                                                                    .state
                                                                    .subProjectModalId,
                                                                editSubProject: false,
                                                                subProjectId: null,
                                                                subProjectTitle: null,
                                                            }
                                                        ),
                                                    })
                                                }
                                                className="Button bs-ButtonLegacy ActionIconParent"
                                                type="button"
                                            >
                                                <PricingPlan
                                                    plan="Growth"
                                                    hideChildren={false}
                                                >
                                                    <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                        <div className="Box-root Margin-right--8">
                                                            <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                                        </div>
                                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                            <span>
                                                                Add Subproject
                                                            </span>
                                                        </span>
                                                    </div>
                                                </PricingPlan>
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
                                                    Project Id
                                                </div>
                                                <div className="bs-ObjectList-cell">
                                                    Created
                                                </div>
                                                <div className="bs-ObjectList-cell">
                                                    Actions
                                                </div>
                                            </header>
                                            {subProjects &&
                                            subProjects.length > 0
                                                ? subProjects.map(
                                                      (subProject, i) => {
                                                          return (
                                                              <SubProjectTable
                                                                  subProject={
                                                                      subProject
                                                                  }
                                                                  key={
                                                                      subProject._id
                                                                  }
                                                                  loop={i}
                                                              />
                                                          );
                                                      }
                                                  )
                                                : ''}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <ShouldRender
                                if={subProjects && subProjects.length <= 0}
                            >
                                <div
                                    className="Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                    style={{
                                        textAlign: 'center',
                                        marginTop: '20px',
                                        padding: '0 10px',
                                    }}
                                >
                                    You don&#39;t have any sub project at this
                                    time!
                                </div>
                            </ShouldRender>
                            <div
                                className={`bs-Tail ${
                                    subProjects && subProjects.length <= 0
                                        ? ''
                                        : 'bs-Tail--separated'
                                } bs-Tail--short`}
                                style={{
                                    marginTop: '0px',
                                    marginBottom: '0px',
                                }}
                            >
                                <ShouldRender if={subProjects.error}>
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
                                                    {subProjects.error}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                                <ShouldRender if={!subProjects.error}>
                                    <div className="bs-Tail-copy">
                                        <span>
                                            {count} Sub Project
                                            {count > 1 ? 's' : ''}
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

SubProjects.displayName = 'SubProjects';

SubProjects.propTypes = {
    count: PropTypes.number,
    currentProject: PropTypes.object,
    getSubProjects: PropTypes.func,
    limit: PropTypes.number,
    openModal: PropTypes.func,
    skip: PropTypes.number,
    subProjectState: PropTypes.object,
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        { openModal, closeModal, getSubProjects },
        dispatch
    );
};

const mapStateToProps = state => {
    let skip =
        state.subProject.subProjects && state.subProject.subProjects.skip
            ? state.subProject.subProjects.skip
            : 0;
    let limit =
        state.subProject.subProjects && state.subProject.subProjects.limit
            ? state.subProject.subProjects.limit
            : 10;
    let count =
        state.subProject.subProjects && state.subProject.subProjects.count
            ? state.subProject.subProjects.count
            : 0;

    if (skip && typeof skip === 'string') {
        skip = parseInt(skip, 10);
    }
    if (limit && typeof limit === 'string') {
        limit = parseInt(limit, 10);
    }
    if (count && typeof count === 'string') {
        count = parseInt(count, 10);
    }
    return {
        subProjectState: state.subProject.subProjects,
        currentProject: state.project.currentProject,
        skip,
        limit,
        count,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(SubProjects);
