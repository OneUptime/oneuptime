import React from 'react'
import ScheduleForm  from '../schedule/ScheduleForm';
import OnCallTableRows from '../onCall/OnCallTableRows';
import { OnCallTableHeader } from '../onCall/OnCallData';
import ShouldRender from '../basic/ShouldRender';
import RenderIfSubProjectAdmin  from '../basic/RenderIfSubProjectAdmin';
import DataPathHoC from '../DataPathHoC';
import IsAdminSubProject from '../basic/IsAdminSubProject';
import IsOwnerSubProject from '../basic/IsOwnerSubProject';
import PropTypes from 'prop-types';
import { ListLoader } from '../basic/Loader';

const ScheduleProjectBox = (props) => (
    <div className="Box-root">
        <div>
            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                        <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                        <span style={{'textTransform':'capitalize'}}>{props.currentProject._id !== props.subProjectSchedule._id ? props.subProjectName : props.subProjects.length > 0 ? 'Project' : ''} call schedules</span>
                        </span>
                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                { IsOwnerSubProject(props.currentProject) || IsAdminSubProject(props.subProject) || IsOwnerSubProject(props.subProject) ? 'Schedules let\'s you connect members to monitors, so only members who are responsible for certain monitors are alerted.' : 'When monitors go down, Fyipe alerts your team.' }
                            </span>
                        </span>
                    </div>
                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                        <div className="Box-root">
                            <RenderIfSubProjectAdmin subProjectId={props.projectId}>
                                <button id={`btnCreateSchedule_${props.subProjectName}`} className="Button bs-ButtonLegacy ActionIconParent" type="button" 
                                onClick={()=>{props.openModal({
                                                id: props.scheduleModalId,
                                                content: DataPathHoC(ScheduleForm, { projectId: props.projectId })
                                            })}}
                                >
                                    <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <div className="Box-root Margin-right--8">
                                            <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex">
                                            </div>
                                        </div>
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                            <span>Create Schedule</span>
                                        </span>
                                    </div>
                                </button>
                            </RenderIfSubProjectAdmin>
                        </div>
                    </div>
                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                        <div></div>
                    </div>
                </div>
            </div>
            <table className="Table">
                <thead className="Table-body">
                    <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                        <OnCallTableHeader text="Schedule Name" />

                        <OnCallTableHeader text="Monitor" />

                        <OnCallTableHeader text="Team Members" />
                    </tr>
                </thead>
                <tbody className="Table-body">

                    <OnCallTableRows schedules={props.schedules} requesting={props.isRequesting} subProjectId={props.subProjectSchedule._id} />

                </tbody>
            </table>
            <ShouldRender if={!props.isRequesting && props.schedules.length === 0}>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center" style={{ marginTop: '20px' }}>
                    You don&#39;t have any schedule at this time!
                </div>
            </ShouldRender>
            <ShouldRender if={props.isRequesting}>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center" style={{ marginTop: '10px' }}>
                    <ListLoader />
                </div>
            </ShouldRender>
            <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <span>
                            <span id={`schedule_count_${props.subProjectName}`} className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                {props.count} schedule{props.numberOfSchedules === 1 ? '' : 's'}
                            </span>
                        </span>
                    </span>
                </div>
                <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                        <div className="Box-root Margin-right--8">
                            <button
                                className={`Button bs-ButtonLegacy ${!props.canPaginateBackward ? 'Is--disabled' : ''}`}
                                data-db-analytics-name="list_view.pagination.previous"
                                disabled={!props.canPaginateBackward}
                                type="button"
                                onClick={()=>props.prevClicked(props.subProjectSchedule._id, props.skip, props.limit)}
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
                                className={`Button bs-ButtonLegacy ${!props.canPaginateForward ? 'Is--disabled' : ''}`}
                                data-db-analytics-name="list_view.pagination.next"
                                disabled={!props.canPaginateForward}
                                type="button"
                                onClick={()=>props.nextClicked(props.subProjectSchedule._id, props.skip, props.limit)}
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
);

ScheduleProjectBox.displayName = 'StatusPageProjectBox';

ScheduleProjectBox.propTypes = {
    openModal: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    nextClicked: PropTypes.func.isRequired,
    subProjectSchedule: PropTypes.object.isRequired,
    schedules: PropTypes.array.isRequired,
    canPaginateBackward: PropTypes.bool.isRequired,
    canPaginateForward: PropTypes.bool.isRequired,
    isRequesting: PropTypes.bool.isRequired,
    skip: PropTypes.string.isRequired,
    limit: PropTypes.string.isRequired,
    count: PropTypes.number.isRequired,
    numberOfSchedules: PropTypes.number.isRequired,
    subProjectName: PropTypes.string.isRequired,
    currentProject: PropTypes.object.isRequired,
    subProject: PropTypes.object.isRequired,
    projectId: PropTypes.string.isRequired,
    scheduleModalId: PropTypes.string.isRequired,
    subProjects: PropTypes.array
};

export default ScheduleProjectBox;