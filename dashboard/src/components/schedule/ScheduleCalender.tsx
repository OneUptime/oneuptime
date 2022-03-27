import React, { useState } from 'react';
import PropTypes from 'prop-types';

import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import { ListLoader } from '../basic/Loader';

interface ScheduleCalenderProps {
    escalations?: unknown[];
    requestingEscalations?: boolean;
}

function ScheduleCalender({
    escalations,
    requestingEscalations
}: ScheduleCalenderProps) {
    const [dayOffset, setDayOffset] = useState(47);
    const [defaultDate, setDefaultDate] = useState(new Date());

    const teamSchedules: $TSFixMe = [];
    escalations.forEach((escalation: $TSFixMe) => {
        if (escalation.activeTeam) {
            if (escalation.activeTeam.teamMembers.length) {
                teamSchedules.push(...escalation.activeTeam.teamMembers);
            }
        }
        if (escalation.nextActiveTeam) {
            if (escalation.nextActiveTeam.teamMembers.length) {
                teamSchedules.push(...escalation.nextActiveTeam.teamMembers);
            }
        }
    });

    const extendedSchedule: $TSFixMe = [];

    teamSchedules.forEach(schedule => {
        for (let i = 0; i <= dayOffset; i++) {
            const currentStart = new Date(schedule.startTime);
            const currentEnd = new Date(schedule.endTime);
            const scheduleData = {
                title: `${schedule.user?.name ||
                    schedule.user
                        ?.email} is on-call schedule during this period`,
                start: new Date(
                    currentStart.setDate(currentStart.getDate() + i)
                ),
                end: new Date(currentEnd.setDate(currentEnd.getDate() + i)),
                id: schedule._id + i,
            };

            extendedSchedule.push(scheduleData);
        }
    });

    // Setup the localizer by providing the moment (or globalize) Object
    // to the correct localizer.
    const localizer = momentLocalizer(moment); // or globalizeLocalizer

    const handleNavigate = (date: $TSFixMe, view: $TSFixMe, action: Action) => {
        setDefaultDate(date);
        if (view === 'month') {
            setDayOffset(prevState => {
                if (action && action === 'PREV') {
                    return prevState - 47;
                }
                if (action && action === 'TODAY') {
                    return 47;
                }
                return prevState + 47;
            });
        }
        if (view === 'week') {
            setDayOffset(prevState => {
                if (action && action === 'PREV') {
                    return prevState - 7;
                }
                if (action && action === 'TODAY') {
                    return 7;
                }
                return prevState + 7;
            });
        }
        if (view === 'day') {
            setDayOffset(prevState => {
                if (action && action === 'PREV') {
                    return prevState - 1;
                }
                if (action && action === 'TODAY') {
                    return 1;
                }
                return prevState + 1;
            });
        }
        if (view === 'agenda') {
            setDayOffset(prevState => {
                if (action && action === 'PREV') {
                    return prevState - 30;
                }
                if (action && action === 'TODAY') {
                    return 30;
                }
                return prevState + 30;
            });
        }
    };

    const handleView = (view: $TSFixMe) => {
        setDefaultDate(new Date());
        if (view === 'month') setDayOffset(47);
        if (view === 'week') setDayOffset(7);
        if (view === 'day') setDayOffset(1);
        if (view === 'agenda') setDayOffset(30);
    };

    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span> Call Schedule Calender</span>
                                </span>
                                <p>
                                    Calender to show team member that is on-call
                                </p>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div className="Box-root"></div>
                            </div>
                        </div>
                    </div>
                    {requestingEscalations && (
                        <div className="bs-ContentSection-content Box-root">
                            <div
                                className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2"
                                style={{ backgroundColor: '#f7f7f7' }}
                            >
                                <div>
                                    <div className="bs-Fieldset-row flex-center">
                                        <ListLoader />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {!requestingEscalations && (
                        <div className="bs-ContentSection-content Box-root">
                            <div
                                className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2"
                                style={{
                                    backgroundColor: '#f7f7f7',
                                }}
                            >
                                <div>
                                    <Calendar
                                        date={defaultDate}
                                        getNow={() => new Date()}
                                        localizer={localizer}
                                        events={extendedSchedule}
                                        startAccessor="start"
                                        endAccessor="end"
                                        style={{ height: 500 }}
                                        views={[
                                            'month',
                                            'week',
                                            'day',
                                            'agenda',
                                        ]}
                                        showMultiDayTimes={true}
                                        onView={(view: $TSFixMe) => handleView(view)}
                                        onNavigate={(date: $TSFixMe, view: $TSFixMe, action: Action) =>
                                            handleNavigate(date, view, action)
                                        }
                                        popup={true}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                        <div className="bs-Tail-copy">
                            <div
                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                style={{ marginTop: '10px' }}
                            ></div>
                        </div>

                        <div></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

ScheduleCalender.displayName = 'ScheduleCalender';

ScheduleCalender.propTypes = {
    escalations: PropTypes.array,
    requestingEscalations: PropTypes.bool,
};

export default ScheduleCalender;
