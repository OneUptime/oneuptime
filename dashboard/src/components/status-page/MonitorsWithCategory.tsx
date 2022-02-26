import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    reduxForm,
    FieldArray,
    arrayPush,
    formValueSelector,
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
} from 'redux-form';
import {
    updateStatusPageMonitors,
    updateStatusPageMonitorsRequest,
    updateStatusPageMonitorsSuccess,
    updateStatusPageMonitorsError,
    fetchProjectStatusPage,
} from '../../actions/statusPage';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { RenderMonitors } from './RenderMonitors';
import IsAdminSubProject from '../basic/IsAdminSubProject';
import IsOwnerSubProject from '../basic/IsOwnerSubProject';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { DragDropContext, Droppable } from 'react-beautiful-dnd';

const grid = 0;

const getListStyle = (isDraggingOver: $TSFixMe) => ({
    background: isDraggingOver ? 'lightblue' : 'transparent',
    padding: grid,
    width: '100%',
    height: '90%'
});

class MonitorsWithCategory extends Component {
    renderAddMonitorButton = (subProject: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'category' does not exist on type 'Readon... Remove this comment to see the full error message
        const { category } = this.props;

        return (
            <ShouldRender
                if={
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                    this.props.monitors &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                    this.props.monitors.length > 0 &&
                    (IsAdminSubProject(subProject) ||
                        IsOwnerSubProject(subProject))
                }
            >
                <button
                    id="addMoreMonitors"
                    className="bs-Button bs-Button--icon bs-Button--new"
                    type="button"
                    onClick={() =>
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'pushArray' does not exist on type 'Reado... Remove this comment to see the full error message
                        this.props.pushArray(`${category.name}`, 'monitors', {
                            monitor: null,
                            description: '',
                            uptime: false,
                            memory: false,
                            cpu: false,
                            storage: false,
                            responseTime: false,
                            temperature: false,
                            runtime: false,
                        })
                    }
                >
                    <span>Add Monitor</span>
                </button>
            </ShouldRender>
        );
    };

    onDragEnd = (result: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsInCategory' does not exist on ty... Remove this comment to see the full error message
        const { monitorsInCategory, change } = this.props;
        const { destination, source } = result;

        if (!destination) {
            return;
        }

        if (
            destination.droppableId === source.droppableId &&
            destination.index === source.index
        ) {
            return;
        }

        const start = source.droppableId;
        const finish = destination.droppableId;

        if (start === finish) {
            const result = Array.from(monitorsInCategory);
            const [removed] = result.splice(source.index, 1);
            result.splice(destination.index, 0, removed);

            // update form field
            change('monitors', result);
            return;
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'category' does not exist on type 'Readon... Remove this comment to see the full error message
        const { category, statusPage, subProjects } = this.props;
        const { status } = statusPage;
        const subProject = !status.projectId
            ? null
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            : this.props.currentProject._id === status.projectId._id ||
              // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
              this.props.currentProject._id === status.projectId
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            ? this.props.currentProject
            : subProjects.filter(
                  (subProject: $TSFixMe) => subProject._id === status.projectId._id ||
                  subProject._id === status.projectId
              )[0];

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Status Page Category: {category.name}
                                    </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        What monitors do you want to show on the
                                        status page?
                                    </span>
                                </span>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div className="Box-root">
                                    {this.renderAddMonitorButton(subProject)}
                                </div>
                            </div>
                        </div>
                    </div>
                    <form>
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                this.props.monitors.length > 0 &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                !this.props.monitors.requesting &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsInForm' does not exist on type '... Remove this comment to see the full error message
                                this.props.monitorsInForm
                            }
                        >
                            <DragDropContext onDragEnd={this.onDragEnd}>
                                <div className="bs-ContentSection-content Box-root">
                                    <div>
                                        <div className="bs-Fieldset-wrapper Box-root">
                                            <Droppable
                                                droppableId={category.name}
                                            >
                                                {(provided: $TSFixMe, snapshot: $TSFixMe) => (
                                                    <div
                                                        ref={provided.innerRef}
                                                        style={getListStyle(
                                                            snapshot.isDraggingOver
                                                        )}
                                                        className="layoutContainer"
                                                        {...provided.droppableProps}
                                                    >
                                                        <fieldset
                                                            className="bs-Fieldset"
                                                            style={{
                                                                padding: '0px',
                                                                backgroundColor:
                                                                    'unset',
                                                            }}
                                                        >
                                                            <FieldArray
                                                                name="monitors"
                                                                component={
                                                                    RenderMonitors
                                                                }
                                                                subProject={
                                                                    subProject
                                                                }
                                                                form={
                                                                    category.name
                                                                }
                                                                statusPageCategory={
                                                                    category._id
                                                                }
                                                            />
                                                        </fieldset>
                                                        {provided.placeholder}
                                                    </div>
                                                )}
                                            </Droppable>
                                        </div>
                                    </div>
                                </div>
                            </DragDropContext>
                        </ShouldRender>
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2365) FIXME: Operator '>' cannot be applied to types 'boolean' ... Remove this comment to see the full error message
                                (!this.props.monitors.length > 0 &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                    !this.props.monitors.requesting) ||
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsInForm' does not exist on type '... Remove this comment to see the full error message
                                !this.props.monitorsInForm
                            }
                        >
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <div
                                            id="app-loading"
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'center',
                                                alignItems: 'center',
                                                flexDirection: 'column',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    marginTop: '20px',
                                                    marginBottom: '20px',
                                                }}
                                            >
                                                // @ts-expect-error ts-migrate(2365) FIXME: Operator '>' cannot be applied to types 'boolean' ... Remove this comment to see the full error message
                                                {!this.props.monitors.length >
                                                    0 &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                                !this.props.monitors
                                                    .requesting ? (
                                                    <>
                                                        No monitors are added to
                                                        this project.{' '}
                                                        <Link
                                                            to={
                                                                '/dashboard/project/' +
                                                                this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                                    .currentProject
                                                                    .slug +
                                                                '/components'
                                                            }
                                                        >
                                                            {' '}
                                                            Please create one.{' '}
                                                        </Link>
                                                    </>
                                                ) : !this.props
                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsInForm' does not exist on type '... Remove this comment to see the full error message
                                                      .monitorsInForm ? (
                                                    <>
                                                        No monitors are added to
                                                        this status page
                                                        category.
                                                    </>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </ShouldRender>
                    </form>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
MonitorsWithCategory.displayName = 'MonitorsWithCategory';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
MonitorsWithCategory.propTypes = {
    updateStatusPageMonitors: PropTypes.func.isRequired,
    statusPage: PropTypes.object.isRequired,
    pushArray: PropTypes.func.isRequired,
    currentProject: PropTypes.oneOfType([
        PropTypes.object.isRequired,
        PropTypes.oneOf([null, undefined]),
    ]),
    monitors: PropTypes.array.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
    subProjects: PropTypes.array.isRequired,
    category: PropTypes.object,
    monitorsInForm: PropTypes.array,
    selectedMonitors: PropTypes.array,
    monitorsInCategory: PropTypes.array,
    change: PropTypes.func,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        updateStatusPageMonitors,
        updateStatusPageMonitorsRequest,
        updateStatusPageMonitorsSuccess,
        updateStatusPageMonitorsError,
        fetchProjectStatusPage,
        pushArray: arrayPush,
    },
    dispatch
);

const MonitorsWithCategoryForm = reduxForm({
    enableReinitialize: true,
})(MonitorsWithCategory);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const selector = formValueSelector(ownProps.category.name);
    const monitorsInForm =
        selector(state, 'monitors') && selector(state, 'monitors').length;

    const { currentProject } = state.project;
    const subProjects = state.subProject.subProjects.subProjects;

    const {
        statusPage,
        statusPage: {
            status: { monitors: selectedMonitors },
        },
    } = state;

    const initialValues = {
        monitors: selectedMonitors
            ? selectedMonitors
                  .filter(
                      (monitor: $TSFixMe) => monitor.statusPageCategory &&
                      String(
                          monitor.statusPageCategory._id ||
                              monitor.statusPageCategory
                      ) === String(ownProps.category._id)
                  )
                  .map((monitor: $TSFixMe) => {
                      if (monitor.statusPageCategory) {
                          monitor.statusPageCategory =
                              monitor.statusPageCategory._id ||
                              monitor.statusPageCategory;
                      }
                      return monitor;
                  })
            : [],
    };

    return {
        form: ownProps.category.name, // dynamic redux form name
        monitorsInForm,
        currentProject,
        subProjects,
        statusPage,
        initialValues,
        selectedMonitors,
        monitorsInCategory:
            state.form[ownProps.category.name] &&
            state.form[ownProps.category.name].values &&
            state.form[ownProps.category.name].values.monitors,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(MonitorsWithCategoryForm);
