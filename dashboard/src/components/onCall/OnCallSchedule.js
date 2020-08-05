import React from 'react';
import PropTypes from 'prop-types';
import moment from 'moment-timezone';
import { history } from '../../store';

const OnCallSchedule = ({ status, schedules, currentProjectId }) => {
    let color;
    switch (status) {
        case 'active':
            color = 'red';
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
                                            }}
                                            alt="warning"
                                            src={`${
                                                status === 'inactive'
                                                    ? 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2ZXJzaW9uPSIxLjEiIGlkPSJMYXllcl8xIiB4PSIwcHgiIHk9IjBweCIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgMCAwIDUxMiA1MTI7IiB4bWw6c3BhY2U9InByZXNlcnZlIiB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgY2xhc3M9ImhvdmVyZWQtcGF0aHMiPjxnPjxnPgoJPGc+CgkJPHBhdGggZD0iTTQ0OS43MTYsMjM5Ljg0MmMtMC41NDMtNy41MzUtNy4wODItMTMuMTkxLTE0LjYyOC0xMi42NjFjLTcuNTM2LDAuNTQzLTEzLjIwNCw3LjA5Mi0xMi42NjIsMTQuNjI4ICAgIGMwLjMzNyw0LjY1NSwwLjUwNiw5LjQzMSwwLjUwNiwxNC4xOTFjMCwxMDkuMDYxLTg4LjcyNiwxOTcuNzg3LTE5Ny43ODYsMTk3Ljc4N0MxMTYuMDg2LDQ1My43ODcsMjcuMzYsMzY1LjA2LDI3LjM2LDI1NiAgICBTMTE2LjA4Niw1OC4yMTQsMjI1LjE0Nyw1OC4yMTRjNDMuMTkxLDAsODQuMjEsMTMuNjY4LDExOC42MiwzOS41MjVjNi4wNDEsNC41MzgsMTQuNjE1LDMuMzIxLDE5LjE1NC0yLjcxOCAgICBjNC41NC02LjA0LDMuMzIzLTE0LjYxNi0yLjcxNy0xOS4xNTRjLTM5LjE4OS0yOS40NDctODUuODkxLTQ1LjAxMi0xMzUuMDU4LTQ1LjAxMkMxMDEuMDAxLDMwLjg1NCwwLDEzMS44NTUsMCwyNTYgICAgczEwMS4wMDEsMjI1LjE0NSwyMjUuMTQ3LDIyNS4xNDVTNDUwLjI5MiwzODAuMTQ2LDQ1MC4yOTIsMjU2QzQ1MC4yOTIsMjUwLjU4Niw0NTAuMDk3LDI0NS4xNSw0NDkuNzE2LDIzOS44NDJ6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iaG92ZXJlZC1wYXRoIGFjdGl2ZS1wYXRoIiBzdHlsZT0iZmlsbDojRkZGRkZGIiBkYXRhLW9sZF9jb2xvcj0iIzAwMDAwMCI+PC9wYXRoPgoJPC9nPgo8L2c+PGc+Cgk8Zz4KCQk8cGF0aCBkPSJNNDk2LjM5NSw2MS43N2MtMjAuODA4LTIwLjgwNy01NC42NjYtMjAuODA3LTc1LjQ3NCwwbC0xOTcuMTEsMTk3LjEwOGwtNjkuODc0LTY5Ljg3NSAgICBjLTIwLjgwOC0yMC44MDctNTQuNjY2LTIwLjgwNy03NS40NzQsMGMtMjAuODA4LDIwLjgwOC0yMC44MDgsNTQuNjY2LDAsNzUuNDc0bDEyMC4zNDEsMTIwLjM0MSAgICBjNi44OTUsNi44OTUsMTUuOTUxLDEwLjM0MiwyNS4wMDcsMTAuMzQyYzkuMDU3LDAsMTguMTEzLTMuNDQ3LDI1LjAwOC0xMC4zNDJsMjQ3LjU3Ni0yNDcuNTc2ICAgIEM1MTcuMjAxLDExNi40MzUsNTE3LjIwMSw4Mi41NzksNDk2LjM5NSw2MS43N3ogTTQ3Ny4wNDksMTE3Ljg5N0wyMjkuNDcyLDM2NS40NzVjLTMuMTIsMy4xMi04LjIsMy4xMi0xMS4zMiwwTDk3LjgxMSwyNDUuMTMzICAgIGMtMTAuMTQxLTEwLjE0MS0xMC4xNDEtMjYuNjQsMC0zNi43ODFjNS4wNy01LjA3MiwxMS43MjktNy42MDYsMTguMzktNy42MDZzMTMuMzIxLDIuNTM1LDE4LjM5LDcuNjA2bDcxLjg4Miw3MS44ODIgICAgYzQuNjMyLDQuNjMxLDEwLjc5MSw3LjE4MSwxNy4zMzksNy4xODFjNi41NTEsMCwxMi43MS0yLjU1MSwxNy4zNDEtNy4xODJMNDQwLjI2OCw4MS4xMTZjMTAuMTM4LTEwLjE0MSwyNi42NC0xMC4xNDEsMzYuNzgxLDAgICAgQzQ4Ny4xODksOTEuMjU3LDQ4Ny4xODksMTA3Ljc1Niw0NzcuMDQ5LDExNy44OTd6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iaG92ZXJlZC1wYXRoIGFjdGl2ZS1wYXRoIiBzdHlsZT0iZmlsbDojRkZGRkZGIiBkYXRhLW9sZF9jb2xvcj0iIzAwMDAwMCI+PC9wYXRoPgoJPC9nPgo8L2c+PC9nPiA8L3N2Zz4='
                                                    : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHg9IjBweCIgeT0iMHB4IiB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNTEyIDUxMjsiIHhtbDpzcGFjZT0icHJlc2VydmUiIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIj48Zz48Zz4KCTxnPgoJCTxwYXRoIGQ9Ik00OTkuMDE1LDM0NS40M2wtNzkuNjQ2LTEzNy45NDljLTAuMzExLTAuNTM5LTAuNjY0LTEuMDM3LTEuMDU0LTEuNDk0TDM0Mi40OTQsNzQuNjYgICAgYy04LjQ0Ny0xNi44OTUtMjEuNTY1LTMwLjgzMy0zNy45NTUtNDAuMzE4Yy0xNC43MDktOC41MTctMzEuNDI0LTEzLjAyLTQ4LjMzNy0xMy4wMmMtMzQuNDA5LDAtNjYuNDgxLDE4LjQ3My04My43MDYsNDguMjIgICAgTDkyLjg1MSwyMDcuNDhjLTAuMzEsMC41MzctMC41NjcsMS4wOTctMC43NywxLjY3M2wtNzQuNDYsMTI4Ljk4NEM2LjA5MSwzNTQuNTA5LDAsMzczLjc1OSwwLDM5My44NDMgICAgYzAsNTMuMzk1LDQzLjQ0LDk2LjgzNSw5Ni44MzUsOTYuODM1aDMxOC41NmMwLjczLDAsMS40NDItMC4wNzgsMi4xMjctMC4yMjdjMTYuMjA4LTAuMzQyLDMyLjE3My00LjgxOCw0Ni4yOTctMTIuOTk3ICAgIEM1MDkuOTIyLDQ1MC43NTksNTI1LjcwOCwzOTEuNTI3LDQ5OS4wMTUsMzQ1LjQzeiBNNDUzLjc5Nyw0NjAuMTQ2Yy0xMS42NjUsNi43NTQtMjQuOTAyLDEwLjMyNS0zOC4yODEsMTAuMzI1aC0wLjEwNyAgICBjLTAuNjg0LDAuMDE4LTEuMzY3LDAuMDY5LTIuMDMxLDAuMjA2SDk2LjgzNWMtNDIuMzY2LDAtNzYuODM0LTM0LjQ2OC03Ni44MzQtNzYuODM0YzAtMTYuMDY2LDQuOTA5LTMxLjQ1NiwxNC4xOTctNDQuNTA1ICAgIGMwLjE4NC0wLjI1OCwwLjM1NS0wLjUyNSwwLjUxNC0wLjc5OWw3NS40MjMtMTMwLjY1M2wwLjExNi0wLjE5M2MwLjM0Ny0wLjU4MiwwLjYzMi0xLjE5MiwwLjg1My0xLjgyMkwxODkuODEsNzkuNTUzICAgIGMxMy42NTUtMjMuNTgxLDM5LjA5NC0zOC4yMyw2Ni4zOTEtMzguMjNjMTMuMzk5LDAsMjYuNjQ3LDMuNTcxLDM4LjMxNywxMC4zMjhjMTMuMDY5LDcuNTY0LDIzLjUxMiwxOC42OTMsMzAuMjAxLDMyLjE4NCAgICBjMC4wOTQsMC4xODksMC4xOTMsMC4zNzYsMC4yOTksMC41NTlsNzYuODg3LDEzMy4xNjljMC4zMTEsMC41MzksMC42NjQsMS4wMzcsMS4wNTQsMS40OTRMNDgxLjcsMzU1LjQ0MSAgICBDNTAyLjg3NCwzOTIuMDA3LDQ5MC4zNTYsNDM4Ljk3Nyw0NTMuNzk3LDQ2MC4xNDZ6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iYWN0aXZlLXBhdGgiIHN0eWxlPSJmaWxsOiNGRkZGRkYiIGRhdGEtb2xkX2NvbG9yPSIjMDAwMDAwIj48L3BhdGg+Cgk8L2c+CjwvZz48Zz4KCTxnPgoJCTxwYXRoIGQ9Ik0yNTUuOTkyLDEzMy4wNTljLTE5LjQyOCwwLTM1LjIzNCwxNS44MDctMzUuMjM0LDM1LjIzNnYxMDkuMTAxYzAsMTkuNDI5LDE1LjgwNiwzNS4yMzYsMzUuMjM0LDM1LjIzNiAgICBzMzUuMjM0LTE1LjgwNywzNS4yMzQtMzUuMjM2VjE2OC4yOTVDMjkxLjIyNywxNDguODY2LDI3NS40MiwxMzMuMDU5LDI1NS45OTIsMTMzLjA1OXogTTI3MS4yMjYsMjc3LjM5NiAgICBjMCw4LjQtNi44MzMsMTUuMjM1LTE1LjIzMywxNS4yMzVjLTguMzk5LDAtMTUuMjMzLTYuODM0LTE1LjIzMy0xNS4yMzVWMTY4LjI5NWMwLTguNCw2LjgzMy0xNS4yMzUsMTUuMjMzLTE1LjIzNSAgICBjOC4zOTksMCwxNS4yMzMsNi44MzQsMTUuMjMzLDE1LjIzNVYyNzcuMzk2eiIgZGF0YS1vcmlnaW5hbD0iIzAwMDAwMCIgY2xhc3M9ImFjdGl2ZS1wYXRoIiBzdHlsZT0iZmlsbDojRkZGRkZGIiBkYXRhLW9sZF9jb2xvcj0iIzAwMDAwMCI+PC9wYXRoPgoJPC9nPgo8L2c+PGc+Cgk8Zz4KCQk8cGF0aCBkPSJNMjU1Ljk5MiwzMzQuNTU5Yy0xOS40MjgsMC0zNS4yMzQsMTUuODA2LTM1LjIzNCwzNS4yMzRzMTUuODA2LDM1LjIzNCwzNS4yMzQsMzUuMjM0czM1LjIzNC0xNS44MDYsMzUuMjM0LTM1LjIzNCAgICBDMjkxLjIyNywzNTAuMzY2LDI3NS40MiwzMzQuNTU5LDI1NS45OTIsMzM0LjU1OXogTTI1NS45OTIsMzg1LjAyN2MtOC4zOTksMC0xNS4yMzMtNi44MzMtMTUuMjMzLTE1LjIzMyAgICBzNi44MzMtMTUuMjMzLDE1LjIzMy0xNS4yMzNzMTUuMjMzLDYuODMzLDE1LjIzMywxNS4yMzNDMjcxLjIyNiwzNzguMTk0LDI2NC4zOTIsMzg1LjAyNywyNTUuOTkyLDM4NS4wMjd6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iYWN0aXZlLXBhdGgiIHN0eWxlPSJmaWxsOiNGRkZGRkYiIGRhdGEtb2xkX2NvbG9yPSIjMDAwMDAwIj48L3BhdGg+Cgk8L2c+CjwvZz48Zz4KCTxnPgoJCTxwYXRoIGQ9Ik04MS4wNDgsMzE4LjI3N2MtNC43ODMtMi43Ni0xMC45LTEuMTIzLTEzLjY2MSwzLjY2MWwtMjAuNTE3LDM1LjU0MWMtMi43NjEsNC43ODMtMS4xMjIsMTAuOSwzLjY2MSwxMy42NjEgICAgYzEuNTc1LDAuOTA5LDMuMjk0LDEuMzQxLDQuOTksMS4zNDFjMy40NTYsMCw2LjgxOC0xLjc5Myw4LjY3LTUuMDAybDIwLjUxNy0zNS41NDFDODcuNDcxLDMyNy4xNTQsODUuODMzLDMyMS4wMzgsODEuMDQ4LDMxOC4yNzcgICAgeiIgZGF0YS1vcmlnaW5hbD0iIzAwMDAwMCIgY2xhc3M9ImFjdGl2ZS1wYXRoIiBzdHlsZT0iZmlsbDojRkZGRkZGIiBkYXRhLW9sZF9jb2xvcj0iIzAwMDAwMCI+PC9wYXRoPgoJPC9nPgo8L2c+PGc+Cgk8Zz4KCQk8cGF0aCBkPSJNOTUuNTI1LDI5My4xODZjLTQuNzg1LTIuNzU3LTEwLjktMS4xMTMtMTMuNjU4LDMuNjcybC0wLjExOCwwLjIwNWMtMi43NTcsNC43ODUtMS4xMTMsMTAuOSwzLjY3MiwxMy42NTggICAgYzEuNTczLDAuOTA2LDMuMjg5LDEuMzM3LDQuOTgzLDEuMzM3YzMuNDU5LDAsNi44MjMtMS43OTcsOC42NzQtNS4wMDlsMC4xMTgtMC4yMDUgICAgQzEwMS45NTYsMzAyLjA1OCwxMDAuMzExLDI5NS45NDMsOTUuNTI1LDI5My4xODZ6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iYWN0aXZlLXBhdGgiIHN0eWxlPSJmaWxsOiNGRkZGRkYiIGRhdGEtb2xkX2NvbG9yPSIjMDAwMDAwIj48L3BhdGg+Cgk8L2c+CjwvZz48L2c+IDwvc3ZnPg=='
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
                                                                `/dashboard/project/${currentProjectId}/sub-project/${
                                                                    schedule.projectId &&
                                                                    schedule
                                                                        .projectId
                                                                        ._id
                                                                }/schedule/${
                                                                    schedule.scheduleId &&
                                                                    schedule
                                                                        .scheduleId
                                                                        ._id
                                                                }`
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
                                                    {status === 'active' ? (
                                                        <span>
                                                            Your duty ends at{' '}
                                                            <b>
                                                                {moment(
                                                                    schedule.endTime,
                                                                    'HH:mm'
                                                                ).format(
                                                                    'hh:mm A'
                                                                )}
                                                                {schedule.timezone &&
                                                                    ` (${schedule.timezone})`}
                                                            </b>{' '}
                                                            and your next duty
                                                            begins at
                                                        </span>
                                                    ) : (
                                                        <span>
                                                            Your next duty
                                                            begins at
                                                        </span>
                                                    )}{' '}
                                                    <b>
                                                        {moment(
                                                            schedule.startTime,
                                                            'HH:mm'
                                                        ).format('hh:mm A')}
                                                        {schedule.timezone &&
                                                            ` (${schedule.timezone})`}
                                                    </b>{' '}
                                                    and ends at{' '}
                                                    <b>
                                                        {moment(
                                                            schedule.endTime,
                                                            'HH:mm'
                                                        ).format('hh:mm A')}
                                                        {schedule.timezone &&
                                                            ` (${schedule.timezone})`}
                                                        .
                                                    </b>
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
};

export default OnCallSchedule;
