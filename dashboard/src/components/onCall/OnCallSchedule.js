import React from 'react';
import PropTypes from 'prop-types';
import moment from 'moment-timezone';
import { history } from '../../store';

const OnCallSchedule = ({ status, schedules, currentProjectId }) => {
    let color;
    switch (status) {
        case 'active':
            color = 'cyan5';
            break;
        case 'upcoming':
            color = 'yellow';
            break;
        case 'inactive':
            color = 'green';
            break;
        default:
            color = 'green';
    }

    return (
        <div
            className={`Box-root Margin-vertical--12 Card-shadow--medium Box-background--${color} Border-radius--4`}
            tabIndex="0"
        >
            <div className="db-Trends-header">
                <div className="db-Trends-controls">
                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="Box-root Flex-flex Flex-direction--row Margin-bottom--8">
                                    <span className="ContentHeader-title Text-color--white Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-wrap--wrap">
                                        <img
                                            width="17"
                                            style={{
                                                marginRight: 5,
                                                verticalAlign: 'bottom',
                                                color: 'red',
                                            }}
                                            alt="warning"
                                            src={`${status === 'inactive'
                                                    ? 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2ZXJzaW9uPSIxLjEiIGlkPSJMYXllcl8xIiB4PSIwcHgiIHk9IjBweCIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgMCAwIDUxMiA1MTI7IiB4bWw6c3BhY2U9InByZXNlcnZlIiB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgY2xhc3M9ImhvdmVyZWQtcGF0aHMiPjxnPjxnPgoJPGc+CgkJPHBhdGggZD0iTTQ0OS43MTYsMjM5Ljg0MmMtMC41NDMtNy41MzUtNy4wODItMTMuMTkxLTE0LjYyOC0xMi42NjFjLTcuNTM2LDAuNTQzLTEzLjIwNCw3LjA5Mi0xMi42NjIsMTQuNjI4ICAgIGMwLjMzNyw0LjY1NSwwLjUwNiw5LjQzMSwwLjUwNiwxNC4xOTFjMCwxMDkuMDYxLTg4LjcyNiwxOTcuNzg3LTE5Ny43ODYsMTk3Ljc4N0MxMTYuMDg2LDQ1My43ODcsMjcuMzYsMzY1LjA2LDI3LjM2LDI1NiAgICBTMTE2LjA4Niw1OC4yMTQsMjI1LjE0Nyw1OC4yMTRjNDMuMTkxLDAsODQuMjEsMTMuNjY4LDExOC42MiwzOS41MjVjNi4wNDEsNC41MzgsMTQuNjE1LDMuMzIxLDE5LjE1NC0yLjcxOCAgICBjNC41NC02LjA0LDMuMzIzLTE0LjYxNi0yLjcxNy0xOS4xNTRjLTM5LjE4OS0yOS40NDctODUuODkxLTQ1LjAxMi0xMzUuMDU4LTQ1LjAxMkMxMDEuMDAxLDMwLjg1NCwwLDEzMS44NTUsMCwyNTYgICAgczEwMS4wMDEsMjI1LjE0NSwyMjUuMTQ3LDIyNS4xNDVTNDUwLjI5MiwzODAuMTQ2LDQ1MC4yOTIsMjU2QzQ1MC4yOTIsMjUwLjU4Niw0NTAuMDk3LDI0NS4xNSw0NDkuNzE2LDIzOS44NDJ6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iaG92ZXJlZC1wYXRoIGFjdGl2ZS1wYXRoIiBzdHlsZT0iZmlsbDojRkZGRkZGIiBkYXRhLW9sZF9jb2xvcj0iIzAwMDAwMCI+PC9wYXRoPgoJPC9nPgo8L2c+PGc+Cgk8Zz4KCQk8cGF0aCBkPSJNNDk2LjM5NSw2MS43N2MtMjAuODA4LTIwLjgwNy01NC42NjYtMjAuODA3LTc1LjQ3NCwwbC0xOTcuMTEsMTk3LjEwOGwtNjkuODc0LTY5Ljg3NSAgICBjLTIwLjgwOC0yMC44MDctNTQuNjY2LTIwLjgwNy03NS40NzQsMGMtMjAuODA4LDIwLjgwOC0yMC44MDgsNTQuNjY2LDAsNzUuNDc0bDEyMC4zNDEsMTIwLjM0MSAgICBjNi44OTUsNi44OTUsMTUuOTUxLDEwLjM0MiwyNS4wMDcsMTAuMzQyYzkuMDU3LDAsMTguMTEzLTMuNDQ3LDI1LjAwOC0xMC4zNDJsMjQ3LjU3Ni0yNDcuNTc2ICAgIEM1MTcuMjAxLDExNi40MzUsNTE3LjIwMSw4Mi41NzksNDk2LjM5NSw2MS43N3ogTTQ3Ny4wNDksMTE3Ljg5N0wyMjkuNDcyLDM2NS40NzVjLTMuMTIsMy4xMi04LjIsMy4xMi0xMS4zMiwwTDk3LjgxMSwyNDUuMTMzICAgIGMtMTAuMTQxLTEwLjE0MS0xMC4xNDEtMjYuNjQsMC0zNi43ODFjNS4wNy01LjA3MiwxMS43MjktNy42MDYsMTguMzktNy42MDZzMTMuMzIxLDIuNTM1LDE4LjM5LDcuNjA2bDcxLjg4Miw3MS44ODIgICAgYzQuNjMyLDQuNjMxLDEwLjc5MSw3LjE4MSwxNy4zMzksNy4xODFjNi41NTEsMCwxMi43MS0yLjU1MSwxNy4zNDEtNy4xODJMNDQwLjI2OCw4MS4xMTZjMTAuMTM4LTEwLjE0MSwyNi42NC0xMC4xNDEsMzYuNzgxLDAgICAgQzQ4Ny4xODksOTEuMjU3LDQ4Ny4xODksMTA3Ljc1Niw0NzcuMDQ5LDExNy44OTd6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iaG92ZXJlZC1wYXRoIGFjdGl2ZS1wYXRoIiBzdHlsZT0iZmlsbDojRkZGRkZGIiBkYXRhLW9sZF9jb2xvcj0iIzAwMDAwMCI+PC9wYXRoPgoJPC9nPgo8L2c+PC9nPiA8L3N2Zz4='
                                                    : 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeG1sbnM6c3ZnanM9Imh0dHA6Ly9zdmdqcy5jb20vc3ZnanMiIHZlcnNpb249IjEuMSIgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHg9IjAiIHk9IjAiIHZpZXdCb3g9IjAgMCAxOTEuODEyIDE5MS44MTIiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgMCAwIDUxMiA1MTIiIHhtbDpzcGFjZT0icHJlc2VydmUiPjxnPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgoJPHBhdGggc3R5bGU9IiIgZD0iTTk1LjkwNiwxMjEuMDAzYzYuOTAzLDAsMTIuNS01LjU5NywxMi41LTEyLjVWNTEuNTExYzAtNi45MDQtNS41OTctMTIuNS0xMi41LTEyLjUgICBzLTEyLjUsNS41OTYtMTIuNSwxMi41djU2Ljk5M0M4My40MDYsMTE1LjQwNyw4OS4wMDMsMTIxLjAwMyw5NS45MDYsMTIxLjAwM3oiIGZpbGw9IiNmZmZmZmYiIGRhdGEtb3JpZ2luYWw9IiMxZDFkMWIiLz4KCTxwYXRoIHN0eWxlPSIiIGQ9Ik05NS45MDksMTI3LjgwN2MtMy4yOSwwLTYuNTIxLDEuMzMtOC44NDEsMy42NmMtMi4zMjksMi4zMi0zLjY1OSw1LjU0LTMuNjU5LDguODMgICBzMS4zMyw2LjUyLDMuNjU5LDguODRjMi4zMiwyLjMzLDUuNTUxLDMuNjYsOC44NDEsMy42NnM2LjUxLTEuMzMsOC44NC0zLjY2YzIuMzE5LTIuMzIsMy42Ni01LjU1LDMuNjYtOC44NHMtMS4zNDEtNi41MS0zLjY2LTguODMgICBDMTAyLjQxOSwxMjkuMTM3LDk5LjE5OSwxMjcuODA3LDk1LjkwOSwxMjcuODA3eiIgZmlsbD0iI2ZmZmZmZiIgZGF0YS1vcmlnaW5hbD0iIzFkMWQxYiIvPgoJPHBhdGggc3R5bGU9IiIgZD0iTTk1LjkwNiwwQzQzLjAyNCwwLDAsNDMuMDIzLDAsOTUuOTA2czQzLjAyMyw5NS45MDYsOTUuOTA2LDk1LjkwNnM5NS45MDUtNDMuMDIzLDk1LjkwNS05NS45MDYgICBTMTQ4Ljc4OSwwLDk1LjkwNiwweiBNOTUuOTA2LDE3Ni44MTJDNTEuMjk0LDE3Ni44MTIsMTUsMTQwLjUxOCwxNSw5NS45MDZTNTEuMjk0LDE1LDk1LjkwNiwxNSAgIGM0NC42MTEsMCw4MC45MDUsMzYuMjk0LDgwLjkwNSw4MC45MDZTMTQwLjUxOCwxNzYuODEyLDk1LjkwNiwxNzYuODEyeiIgZmlsbD0iI2ZmZmZmZiIgZGF0YS1vcmlnaW5hbD0iIzFkMWQxYiIvPgo8L2c+CjxnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjwvZz4KPGcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPC9nPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8L2c+CjxnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjwvZz4KPGcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPC9nPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8L2c+CjxnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjwvZz4KPGcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPC9nPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8L2c+CjxnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjwvZz4KPGcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPC9nPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8L2c+CjxnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjwvZz4KPGcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPC9nPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8L2c+CjwvZz48L3N2Zz4K'
                                                }`}
                                        />

                                        <span>
                                            {status === 'active'
                                                ? "You're currently on-call duty for these on-call schedules:"
                                                : status === 'upcoming'
                                                    ? 'Your duty is starting soon for these on-call schedules:'
                                                    : "You're not on duty for these on-call schedules:"}
                                        </span>
                                    </span>
                                </span>
                                <span className="ContentHeader-description Text-color--white Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <ul>
                                        {schedules.map((schedule, i) => {
                                            return (
                                                <li key={i}>
                                                    <b
                                                        onClick={() =>
                                                            history.push(
                                                                `/dashboard/project/${currentProjectId}/sub-project/${schedule.projectId &&
                                                                schedule
                                                                    .projectId
                                                                    ._id}/schedule/${schedule.scheduleId &&
                                                                    schedule
                                                                        .scheduleId
                                                                        ._id}`
                                                            )
                                                        }
                                                        style={{
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                fontSize:
                                                                    '20px',
                                                            }}
                                                        >
                                                            &middot;
                                                        </span>{' '}
                                                        {schedule.scheduleId &&
                                                            schedule.scheduleId
                                                                .name}
                                                        :
                                                    </b>{' '}
                                                    {!schedule.isOnDutyAllTheTime ? (
                                                        <span>
                                                            {status ===
                                                                'active' ? (
                                                                    <span>
                                                                        Your duty
                                                                    ends at{' '}
                                                                        <b>
                                                                            {moment(
                                                                                schedule.endTime,
                                                                                'HH:mm'
                                                                            ).format(
                                                                                'hh:mm A'
                                                                            )}
                                                                        </b>{' '}
                                                                    and your
                                                                    next duty
                                                                    begins at
                                                                    </span>
                                                                ) : (
                                                                    <span>
                                                                        Your next
                                                                        duty begins
                                                                        at
                                                                    </span>
                                                                )}{' '}
                                                            <b>
                                                                {moment(
                                                                    schedule.startTime,
                                                                    'HH:mm'
                                                                ).format(
                                                                    'hh:mm A'
                                                                )}
                                                            </b>{' '}
                                                            and ends at{' '}
                                                            <b>
                                                                {moment(
                                                                    schedule.endTime,
                                                                    'HH:mm'
                                                                ).format(
                                                                    'hh:mm A'
                                                                )}
                                                                .
                                                            </b>
                                                        </span>
                                                    ) : (
                                                            <span>
                                                                You&#39;re on duty
                                                                all the time
                                                            </span>
                                                        )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

OnCallSchedule.displayName = 'OnCallSchedule';

OnCallSchedule.propTypes = {
    status: PropTypes.string,
    schedules: PropTypes.array,
    currentProjectId: PropTypes.string,
};

export default OnCallSchedule;
