import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { updateStatusPageLayout } from '../../actions/statusPage';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';

const grid = 8;

const getItemStyle = (isDragging, draggableStyle) => ({
    userSelect: 'none',
    padding: grid * 2,
    display: 'flex',
    alignItems: 'center',
    margin: `0 0 ${grid}px 0`,
    borderRadius: '5px',
    boxShadow:
        'rgb(50 50 93 / 10%) 0px 7px 14px 0px, rgb(0 0 0 / 7%) 0px 3px 6px 0px',
    background: isDragging ? 'lightgreen' : '#f7f7f7',
    ...draggableStyle,
    ...(isDragging && { pointerEvents: 'auto' }),
});

const getListStyle = isDraggingOver => ({
    background: isDraggingOver ? 'lightblue' : 'transparent',
    padding: grid,
    width: '30rem',
    height: '90%',
});
export class StatusPageLayout extends Component {
    state = {
        visible: [
            {
                name: 'Active Announcement',
                key: 'anouncement',
            },
            {
                name: 'Ongoing Schedule Events',
                key: 'ongoingSchedule',
            },
            { name: 'Overall Status', key: 'resources' },
            { name: 'Resource List', key: 'services' },
            { name: 'Incidents', key: 'incidents' },
            {
                name: 'Scheduled Maintenance Events',
                key: 'maintenance',
            },
        ],
        invisible: [],
    };

    componentDidMount() {
        const { statusPage } = this.props;
        const { layout } = statusPage.status;

        const visible = (layout && layout.visible) || [];
        const invisible = (layout && layout.invisible) || [];

        if (visible.length > 0 || invisible.length > 0) {
            this.setState({
                visible,
                invisible,
            });
        }
    }
    handleSubmit = () => {
        const { statusPage } = this.props;
        const { _id, projectId } = statusPage.status;
        const layout = {
            visible: this.state.visible,
            invisible: this.state.invisible,
        };
        this.props.updateStatusPageLayout(projectId._id, {
            _id,
            projectId,
            layout,
        });
    };

    onDragEnd = result => {
        // dropped outside the list
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
            const result = Array.from(this.state[start]);
            const [removed] = result.splice(source.index, 1);
            result.splice(destination.index, 0, removed);

            this.setState({
                [start]: result,
            });
            return;
        }

        // Moving from one list to another
        const startTask = Array.from(this.state[start]);
        const [removed] = startTask.splice(source.index, 1);

        const finishTask = Array.from(this.state[finish]);
        finishTask.splice(destination.index, 0, removed);

        this.setState({
            [start]: startTask,
            [finish]: finishTask,
        });
    };

    getDescription(type) {
        switch (type) {
            case 'anouncement':
                return 'This is the announment section of the status page';
            case 'resources':
                return 'This section contains information of the resources status';
            case 'services':
                return 'This section displays the resources that are on the status page';
            case 'pastIncidents':
            case 'incidents':
                return 'This section displays the incidents belonging to the resources on the status page';
            case 'maintenance':
                return 'This section displays the scheduled maintenance of the resources on the status page';
            case 'futureSchedule':
                return 'This section contains the schedule events that are yet to start';
            case 'ongoingSchedule':
                return 'This section contains the schedule events that are on going';
            default:
                return '';
        }
    }

    render() {
        const { statusPage } = this.props;
        const pageLayout = statusPage && statusPage.updateLayout;
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span
                                        style={{ textTransform: 'capitalize' }}
                                    >
                                        Status Page Layout
                                    </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Order your status page layout by
                                        dragging and dropping components.You can
                                        even hide or show components.
                                    </span>
                                </span>
                            </div>
                        </div>
                    </div>
                    <div
                        className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1"
                        style={{ overflow: 'hidden', overflowX: 'auto' }}
                    >
                        <div>
                            <div
                                className="bs-Fieldset-wrapper Box-root"
                                style={{
                                    background: '#f7f7f7',
                                }}
                            >
                                <DragDropContext onDragEnd={this.onDragEnd}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            marginBottom: '36px',
                                        }}
                                    >
                                        <div
                                            style={{
                                                marginRight: '20px',
                                                boxShadow:
                                                    ' 0 7px 14px 0 rgb(50 50 93 / 10%), 0 3px 6px 0 rgb(0 0 0 / 7%)',
                                                marginBottom: '20px',
                                                marginTop: '20px',
                                            }}
                                            className="Draggable-section"
                                        >
                                            <div
                                                style={{
                                                    padding: '12px 10px',
                                                    borderBottom:
                                                        '1px solid rgb(50 50 93 / 10%)',
                                                }}
                                                className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                            >
                                                Visible on the Status Page{' '}
                                                <br />
                                                <span className="ContentHeader-description Text-color--inherit Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Layout-content-header">
                                                    Items in this column will be
                                                    visible on status page
                                                </span>
                                            </div>

                                            <Droppable droppableId="visible">
                                                {(provided, snapshot) => (
                                                    <div
                                                        {...provided.droppableProps}
                                                        ref={provided.innerRef}
                                                        style={getListStyle(
                                                            snapshot.isDraggingOver
                                                        )}
                                                        className="layoutContainer"
                                                    >
                                                        <div
                                                            style={getItemStyle(
                                                                false,
                                                                false,
                                                                false
                                                            )}
                                                            className="Layout-box"
                                                        >
                                                            <div
                                                                style={{
                                                                    paddingLeft:
                                                                        '18px',
                                                                }}
                                                            >
                                                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28">
                                                                    Header
                                                                </span>
                                                                <br />
                                                                <span className="draggable-content-description">
                                                                    This section
                                                                    displays the
                                                                    header of
                                                                    the status
                                                                    page and can
                                                                    not be
                                                                    hidden
                                                                </span>
                                                            </div>
                                                        </div>
                                                        {this.state.visible.map(
                                                            (item, index) => (
                                                                <Draggable
                                                                    key={
                                                                        item.key
                                                                    }
                                                                    draggableId={
                                                                        item.key
                                                                    }
                                                                    index={
                                                                        index
                                                                    }
                                                                >
                                                                    {(
                                                                        provided,
                                                                        snapshot
                                                                    ) => (
                                                                        <div
                                                                            ref={
                                                                                provided.innerRef
                                                                            }
                                                                            {...provided.draggableProps}
                                                                            {...provided.dragHandleProps}
                                                                            style={getItemStyle(
                                                                                snapshot.isDragging,
                                                                                provided
                                                                                    .draggableProps
                                                                                    .style,

                                                                                true
                                                                            )}
                                                                            className="Layout-box movable-layout-box"
                                                                        >
                                                                            <div>
                                                                                <img
                                                                                    src="/dashboard/assets/icons/draggable-icon.svg"
                                                                                    alt="draggable icon"
                                                                                    style={{
                                                                                        height:
                                                                                            '28px',
                                                                                        width:
                                                                                            '11px',
                                                                                        opacity:
                                                                                            '0.5',
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                            <div
                                                                                style={{
                                                                                    marginLeft:
                                                                                        '10px',
                                                                                }}
                                                                            >
                                                                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Drag-box-header">
                                                                                    {
                                                                                        item.name
                                                                                    }
                                                                                </span>
                                                                                <br />

                                                                                <span className="draggable-content-description">
                                                                                    {this.getDescription(
                                                                                        item.key
                                                                                    )}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </Draggable>
                                                            )
                                                        )}
                                                        {provided.placeholder}
                                                        <div
                                                            style={getItemStyle(
                                                                false,
                                                                false,
                                                                false
                                                            )}
                                                            className="Layout-box"
                                                        >
                                                            <div
                                                                style={{
                                                                    paddingLeft:
                                                                        '18px',
                                                                }}
                                                            >
                                                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28">
                                                                    Footer
                                                                </span>
                                                                <br />
                                                                <span className="draggable-content-description">
                                                                    This section
                                                                    displays the
                                                                    footer of
                                                                    the status
                                                                    page and can
                                                                    not be
                                                                    hidden
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </Droppable>
                                        </div>
                                        <div
                                            style={{
                                                boxShadow:
                                                    ' 0 7px 14px 0 rgb(50 50 93 / 10%), 0 3px 6px 0 rgb(0 0 0 / 7%)',
                                                marginBottom: '20px',
                                                marginTop: '20px',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    padding: '12px 10px',
                                                    borderBottom:
                                                        '1px solid rgb(50 50 93 / 10%)',
                                                }}
                                                className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                            >
                                                Hidden on the Status Page
                                                <br />
                                                <span className="ContentHeader-description Text-color--inherit Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Layout-content-header">
                                                    Items in this column will be
                                                    hidden on status page
                                                </span>
                                            </div>
                                            <Droppable droppableId="invisible">
                                                {(provided, snapshot) => (
                                                    <div
                                                        {...provided.droppableProps}
                                                        ref={provided.innerRef}
                                                        style={getListStyle(
                                                            snapshot.isDraggingOver,
                                                            true
                                                        )}
                                                        className="layoutContainer"
                                                    >
                                                        {this.state.invisible.map(
                                                            (item, index) => (
                                                                <Draggable
                                                                    key={
                                                                        item.key
                                                                    }
                                                                    draggableId={
                                                                        item.key
                                                                    }
                                                                    index={
                                                                        index
                                                                    }
                                                                >
                                                                    {(
                                                                        provided,
                                                                        snapshot
                                                                    ) => (
                                                                        <div
                                                                            ref={
                                                                                provided.innerRef
                                                                            }
                                                                            {...provided.draggableProps}
                                                                            {...provided.dragHandleProps}
                                                                            style={getItemStyle(
                                                                                snapshot.isDragging,
                                                                                provided
                                                                                    .draggableProps
                                                                                    .style,
                                                                                true
                                                                            )}
                                                                            className="Layout-box movable-layout-box"
                                                                        >
                                                                            <div>
                                                                                <img
                                                                                    src="/dashboard/assets/icons/draggable-icon.svg"
                                                                                    alt="draggable icon"
                                                                                    style={{
                                                                                        height:
                                                                                            '28px',
                                                                                        width:
                                                                                            '11px',
                                                                                        opacity:
                                                                                            '0.5',
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                            <div
                                                                                style={{
                                                                                    marginLeft:
                                                                                        '10px',
                                                                                }}
                                                                            >
                                                                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Drag-box-header">
                                                                                    {
                                                                                        item.name
                                                                                    }
                                                                                </span>
                                                                                <br />
                                                                                <span className="draggable-content-description">
                                                                                    {this.getDescription(
                                                                                        item.key
                                                                                    )}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </Draggable>
                                                            )
                                                        )}
                                                        {provided.placeholder}
                                                    </div>
                                                )}
                                            </Droppable>
                                        </div>
                                    </div>
                                </DragDropContext>
                                <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                    <span className="db-SettingsForm-footerMessage">
                                        <ShouldRender if={pageLayout.error}>
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {pageLayout.error}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </span>
                                    <div>
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                            disabled={
                                                this.props.statusPage.customHTML
                                                    .requesting
                                            }
                                            onClick={this.handleSubmit}
                                            id="btnAddCustomStyles"
                                        >
                                            <ShouldRender
                                                if={!pageLayout.requesting}
                                            >
                                                <span>Save</span>
                                            </ShouldRender>
                                            <ShouldRender
                                                if={pageLayout.requesting}
                                            >
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
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

StatusPageLayout.displayName = 'StatusPageLayout';

StatusPageLayout.propTypes = {
    statusPage: PropTypes.object.isRequired,
    updateStatusPageLayout: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            updateStatusPageLayout,
        },
        dispatch
    );

const mapStateToProps = ({ statusPage }) => {
    return {
        statusPage,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(StatusPageLayout);
