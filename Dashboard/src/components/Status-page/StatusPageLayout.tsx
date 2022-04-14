import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { updateStatusPageLayout } from '../../actions/statusPage';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';

import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import ConfirmResetLayout from '../modals/ConfirmResetLayout';
import { openModal } from 'CommonUI/actions/modal';
import DataPathHoC from '../DataPathHoC';

import { v4 as uuidv4 } from 'uuid';

const grid: $TSFixMe = 8;


const getItemStyle: Function = (isDragging, draggableStyle) => ({
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
    ...(isDragging && { pointerEvents: 'auto' })
});

const getListStyle: Function = (isDraggingOver: $TSFixMe) => ({
    background: isDraggingOver ? 'lightblue' : 'transparent',
    padding: grid,
    width: '30rem',
    height: '90%'
});

interface StatusPageLayoutProps {
    statusPage: object;
    updateStatusPageLayout?: Function;
    openModal?: Function;
}

export class StatusPageLayout extends Component<StatusPageLayoutProps>{
    public static displayName = '';
    public static propTypes = {};
    state = {
        visible: [
            { name: 'Header', key: 'header' },
            {
                name: 'Active Announcement',
                key: 'anouncement',
            },
            {
                name: 'Ongoing Scheduled Events',
                key: 'ongoingSchedule',
            },
            { name: 'Overall Status of Resources', key: 'resources' },
            { name: 'Resource List', key: 'services' },
            { name: 'Incidents List', key: 'incidents' },
            {
                name: 'Future Scheduled Events',
                key: 'maintenance',
            },
            { name: 'Footer', key: 'footer' },
        ],
        invisible: [
            { name: 'Scheduled Events Completed', key: 'pastEvents' },
            { name: 'Past Announcements List', key: 'AnnouncementLogs' },
            { name: 'Twitter Updates', key: 'twitter' },
            { name: 'External Status Pages', key: 'externalStatusPage' },
        ],
        confirmResetModalId: uuidv4(),
    };

    override componentDidMount() {

        const { statusPage }: $TSFixMe = this.props;
        const { layout }: $TSFixMe = statusPage.status;

        const visible: Function = (layout && layout.visible) || [];
        const invisible: Function = (layout && layout.invisible) || [];

        if (visible.length > 0 || invisible.length > 0) {
            this.setState({
                visible,
                invisible,
            });
        }
    }
    handleSubmit = () => {

        const { statusPage }: $TSFixMe = this.props;
        const { _id }: $TSFixMe = statusPage.status;
        let { projectId } = statusPage.status;
        projectId = projectId._id ?? projectId;
        const layout: $TSFixMe = {
            visible: this.state.visible,
            invisible: this.state.invisible,
        };

        this.props.updateStatusPageLayout(projectId, {
            _id,
            projectId,
            layout,
        });
    };

    onDragEnd = (result: $TSFixMe) => {
        // dropped outside the list
        const { destination, source }: $TSFixMe = result;

        if (!destination) {
            return;
        }

        if (
            destination.droppableId === source.droppableId &&
            destination.index === source.index
        ) {
            return;
        }

        const start: $TSFixMe = source.droppableId;
        const finish: $TSFixMe = destination.droppableId;

        if (start === finish) {

            const result: $TSFixMe = Array.from(this.state[start]);
            const [removed]: $TSFixMe = result.splice(source.index, 1);
            result.splice(destination.index, 0, removed);

            this.setState({
                [start]: result,
            });
            return;
        }

        // Moving from one list to another

        const startTask: $TSFixMe = Array.from(this.state[start]);
        const [removed]: $TSFixMe = startTask.splice(source.index, 1);


        const finishTask: $TSFixMe = Array.from(this.state[finish]);
        finishTask.splice(destination.index, 0, removed);

        this.setState({
            [start]: startTask,
            [finish]: finishTask,
        });
    };

    getDescription(type: $TSFixMe) {
        switch (type) {
            case 'anouncement':
                return 'This is the announment section of the status page';
            case 'language':
                return 'On this section you can change the status page language(default is English)';
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
                return 'This section contains the scheduled events that are yet to start';
            case 'pastEvents':
                return 'This section contains the scheduled events that have ended';
            case 'AnnouncementLogs':
                return 'This section displays the announcement logs in the status page';
            case 'ongoingSchedule':
                return 'This section contains the scheduled events that are ongoing';
            case 'twitter':
                return 'This section displays the most recent tweets for any twitter handle entered in advanced options';
            case 'footer':
                return 'This section displays the footer of the status page and can not be hidden';
            case 'header':
                return 'This section displays the header of the status page and can not be hidden';
            case 'externalStatusPage':
                return 'This section displays external status pages';
            default:
                return '';
        }
    }

    resetLayoutToDefault = async () => {

        const { statusPage }: $TSFixMe = this.props;
        const { _id }: $TSFixMe = statusPage.status;
        let { projectId } = statusPage.status;
        projectId = projectId._id ?? projectId;
        const layout: $TSFixMe = {
            visible: [
                { name: 'Header', key: 'header' },
                {
                    name: 'Active Announcement',
                    key: 'anouncement',
                },
                {
                    name: 'Ongoing Scheduled Events',
                    key: 'ongoingSchedule',
                },
                { name: 'Overall Status of Resources', key: 'resources' },
                { name: 'Resource List', key: 'services' },
                { name: 'Incidents List', key: 'incidents' },
                {
                    name: 'Future Scheduled Events',
                    key: 'maintenance',
                },

                { name: 'Footer', key: 'footer' },
            ],
            invisible: [
                { name: 'Past Announcements List', key: 'AnnouncementLogs' },
                { name: 'Scheduled Events Completed', key: 'pastEvents' },
                { name: 'Twitter Updates', key: 'twitter' },
                { name: 'External Status Pages', key: 'externalStatusPage' },
            ],
        };
        await this.props

            .updateStatusPageLayout(projectId, {
                _id,
                projectId,
                layout,
            })
            .then(() => {
                this.setState({
                    visible: layout.visible,
                    invisible: layout.invisible,
                });
                return true;
            });
    };
    override render() {

        const { statusPage }: $TSFixMe = this.props;
        const pageLayout: $TSFixMe = statusPage && statusPage.updateLayout;
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
                                        dragging and dropping components. You
                                        can even hide or show components.
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
                                                {(provided: $TSFixMe, snapshot: $TSFixMe) => (
                                                    <div
                                                        {...provided.droppableProps}
                                                        ref={provided.innerRef}
                                                        style={getListStyle(
                                                            snapshot.isDraggingOver
                                                        )}
                                                        className="layoutContainer"
                                                    >
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
                                                                        provided: $TSFixMe,
                                                                        snapshot: $TSFixMe
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
                                                {(provided: $TSFixMe, snapshot: $TSFixMe) => (
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
                                                                        provided: $TSFixMe,
                                                                        snapshot: $TSFixMe
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
                                            id="resetBranding"
                                            className="bs-Button bs-FileUploadButton bs-Button--new"
                                            disabled={

                                                this.props.statusPage
                                                    .resetBrandingColors
                                                    .requesting
                                            }
                                            type="button"
                                            onClick={e => {
                                                e.preventDefault();

                                                return this.props.openModal({
                                                    id: this.state
                                                        .confirmResetModalId,

                                                    content: DataPathHoC(
                                                        ConfirmResetLayout,
                                                        {
                                                            confirmResetModalId: this
                                                                .state
                                                                .confirmResetModalId,
                                                            resetLayoutToDefault: this
                                                                .resetLayoutToDefault,
                                                        }
                                                    ),
                                                });
                                            }}
                                        >
                                            <span>Reset Layout to Default</span>
                                        </button>
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
    openModal: PropTypes.func,
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        updateStatusPageLayout,
        openModal,
    },
    dispatch
);

const mapStateToProps: Function = ({
    statusPage
}: $TSFixMe) => {
    return {
        statusPage,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(StatusPageLayout);
