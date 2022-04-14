import React from 'react';
import PropTypes from 'prop-types';

import { withRouter } from 'react-router-dom';
import { OnCallTableBody } from './OnCallData';
import { history, RootState } from '../../store';

interface RowProps {
    name: string;
    users?: string;
    scheduleSlug: string;
    monitors?: string;
    slug?: string;
    bottonTitle?: string;
}

function Row(props: RowProps) {
    const path:string = `/dashboard/project/${props.slug}/schedule/${props.scheduleSlug}`;
    return (
        <tr
            className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink scheduleListItem"
            onClick={() => {
                history.push(path);
            }}
        >
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                style={{ height: '1px', minWidth: '270px' }}
            >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <div className="Box-root Margin-right--16">
                            <span id={`duty_${props.name}`}>{props.name}</span>
                        </div>
                    </span>
                </div>
            </td>

            <OnCallTableBody text={props.monitors} />

            <OnCallTableBody text={props.users} />

            <OnCallTableBody text={props.bottonTitle} type="button" />
        </tr>
    );
}

Row.displayName = 'OnCallTableRow';

Row.propTypes = {
    name: PropTypes.string.isRequired,
    users: PropTypes.string,
    scheduleSlug: PropTypes.string.isRequired,
    monitors: PropTypes.string,
    slug: PropTypes.string,
    bottonTitle: PropTypes.string,
};

function parseSchedule(schedule: $TSFixMe) {
    const { name, monitorIds, _id, slug } = schedule;
    const { escalationIds } = schedule;
    const escalation = escalationIds[0] && escalationIds[0].teams;
    const userIds = [];
    if (escalation && escalation.length) {
        for (let i = 0; i < escalation.length; i++) {
            if (
                escalation[i] &&
                escalation[i].teamMembers &&
                escalation[i].teamMembers.length
            ) {
                for (let j = 0; j < escalation[i].teamMembers.length; j++) {
                    escalation[i].teamMembers[j] &&
                        escalation[i].teamMembers[j].userId &&
                        userIds.push(escalation[i].teamMembers[j].userId);
                    escalation[i].teamMembers[j].groupId &&
                        userIds.push(escalation[i].teamMembers[j].groupId);
                }
            }
        }
    }
    const gt: Function = (i: $TSFixMe) => monitorIds.length > i;
    const ut: Function = (i: $TSFixMe) => userIds.length > i;

    const id = _id;

    let users = ut(0)
        ? userIds[0].name
            ? userIds[0].name
            : userIds[0].email
        : 'Not Yet Added';
    users += ut(1) ? ` and ${userIds.length - 1} other${ut(2) ? 's' : ''}` : '';

    let monitors = gt(0) ? monitorIds[0].name : 'Not Yet Added';
    monitors += gt(1)
        ? ` and ${monitorIds.length - 1} other${gt(2) ? 's' : ''}`
        : '';

    return { name, users, monitors, id, slug };
}

function OnCallTableRows({
    schedules,
    isRequesting,
    match,
    subProjectId,
    bottonTitle,
    slug
}: $TSFixMe) {
    return schedules.length > 0
        ? schedules.map((schedule: $TSFixMe, index: $TSFixMe) => {
            if (Array.isArray(schedule)) return null;
            schedule = parseSchedule(schedule);
            return (
                <Row
                    name={schedule.name}
                    users={schedule.users}
                    monitors={schedule.monitors}

                    isRequesting={isRequesting}
                    id={schedule.id}
                    key={`oncall ${index}`}
                    match={match}
                    subProjectId={subProjectId}
                    bottonTitle={bottonTitle}
                    slug={slug}
                    scheduleSlug={schedule.slug}
                />
            );
        })
        : null;
}

export default withRouter(OnCallTableRows);
