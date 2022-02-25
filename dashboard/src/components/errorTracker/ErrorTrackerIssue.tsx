import React from 'react';
import * as moment from 'moment';
import Badge from '../common/Badge';
import PropTypes from 'prop-types';
import formatNumber from '../../utils/formatNumber';
import { history } from '../../store';
import ErrorEventUtil from '../../utils/ErrorEventUtil';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader2 } from '../basic/Loader';

function getComponentBadge(componentName) {
    return (
        <span className="Margin-right--8">
            <Badge>{componentName.substr(0, 1).toUpperCase()}</Badge>{' '}
            <span className="Padding-left--4">{componentName}</span>
        </span>
    );
}
getComponentBadge.displayName = 'getComponentBadge';

function viewMore(
    slug,
    componentId,
    componentSlug,
    errorTrackerSlug,
    errorEventId
) {
    return history.push(
        '/dashboard/project/' +
            slug +
            '/component/' +
            componentSlug +
            '/error-trackers/' +
            errorTrackerSlug +
            '/events/' +
            errorEventId
    );
}
function isSelected(selectedErrorEvents, id) {
    return selectedErrorEvents.indexOf(id) > -1 ? true : false;
}
function ErrorTrackerIssue({
    componentId,
    errorTrackerIssue,
    componentSlug,
    errorTracker,
    selectErrorEvent,
    selectedErrorEvents,
    openEventMemberModal,
    resolveSingleIssue,
    errorTrackerStatus,
    slug,
}) {
    return (
        <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem">
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                style={{
                    height: '1px',
                }}
            >
                <div className="Padding-vertical--8 Flex-flex Flex-justifyContent--spaceBetween">
                    <div
                        style={{
                            height: '20px',
                            width: '10px',
                            backgroundColor: `${ErrorEventUtil.getExceptionColor(
                                errorTrackerIssue.type
                            )}`,
                            borderTopRightRadius: '5px',
                            borderBottomRightRadius: '5px',
                        }}
                    ></div>
                    <input
                        type="checkbox"
                        onChange={() => selectErrorEvent(errorTrackerIssue._id)}
                        checked={isSelected(
                            selectedErrorEvents,
                            errorTrackerIssue._id
                        )}
                    />
                </div>
            </td>
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                style={{
                    height: '1px',
                    minWidth: '350px',
                }}
                onClick={() =>
                    viewMore(
                        slug,
                        componentId,
                        componentSlug,
                        errorTracker.slug,
                        errorTrackerIssue.latestId
                    )
                }
            >
                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <div
                            className="Box-root Margin-right--16"
                            style={{
                                cursor: 'pointer',
                            }}
                        >
                            <span className="Text-color--gray Flex-flex">
                                <ShouldRender if={errorTrackerIssue.ignored}>
                                    <img
                                        src="/dashboard/assets/img/mute.svg"
                                        alt=""
                                        style={{
                                            marginBottom: '-5px',
                                            height: '20px',
                                            width: '20px',
                                            marginRight: '10px',
                                        }}
                                    />
                                </ShouldRender>
                                <span
                                    className="Text-color--slate Text-fontSize--16 Padding-right--4"
                                    style={{
                                        textDecoration: errorTrackerIssue.resolved
                                            ? 'line-through'
                                            : 'none',
                                    }}
                                >
                                    {errorTrackerIssue.name
                                        ? errorTrackerIssue.name
                                        : 'Unknown Error Event'}
                                </span>{' '}
                            </span>
                        </div>
                    </span>
                    <div>
                        <div
                            className="Box-root Flex"
                            style={{
                                paddingTop: '5px',
                            }}
                        >
                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                {errorTrackerIssue.description
                                    ? errorTrackerIssue.description.length > 100
                                        ? `${errorTrackerIssue.description.substr(
                                              0,
                                              100
                                          )} ...`
                                        : errorTrackerIssue.description
                                    : ''}
                            </div>
                        </div>
                    </div>
                    <div>
                        <div
                            className="Box-root Flex"
                            style={{
                                paddingTop: '5px',
                            }}
                        >
                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                <div
                                    className="Box-root Margin-right--16 Padding-right--12"
                                    style={{
                                        cursor: 'pointer',
                                    }}
                                >
                                    {getComponentBadge(
                                        errorTracker.componentId.name
                                    )}
                                    <img
                                        src="/dashboard/assets/img/time.svg"
                                        alt=""
                                        style={{
                                            marginBottom: '-5px',
                                            height: '15px',
                                            width: '15px',
                                        }}
                                    />
                                    <span className="Padding-left--8">
                                        {moment(
                                            errorTrackerIssue.latestOccurennce
                                        ).fromNow()}{' '}
                                        -{' '}
                                        {moment(
                                            errorTrackerIssue.earliestOccurennce
                                        ).fromNow()}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </td>
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                style={{
                    height: '1px',
                }}
            >
                <div className="db-ListViewItem-link">
                    <div className="db-ListViewItem-cellContent  Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-justifyContent--center Flex-alignItems--center ">
                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            -
                        </span>
                    </div>
                </div>
            </td>
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                style={{
                    height: '1px',
                }}
            >
                <div className="db-ListViewItem-link">
                    <div className="db-ListViewItem-cellContent  Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-justifyContent--center Flex-alignItems--center ">
                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            {formatNumber(
                                errorTrackerIssue.totalNumberOfEvents
                            )}
                        </span>
                    </div>
                </div>
            </td>
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                style={{
                    height: '1px',
                    minWidth: '250px',
                }}
            >
                <div className="db-ListViewItem-link Flex-flex Flex-justifyContent--center  Flex-alignItems--center">
                    <div className="Padding-all--8">
                        <div className="">
                            {errorTrackerIssue.members.length > 0 ? (
                                errorTrackerIssue.members.map((member, i) => {
                                    return (
                                        <span
                                            key={i}
                                            className="Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper"
                                        >
                                            <span>
                                                {member.userId.name
                                                    ? member.userId.name
                                                    : member.userId.email
                                                    ? member.userId.email
                                                    : 'N/A'}
                                                {i <
                                                errorTrackerIssue.members
                                                    .length -
                                                    1
                                                    ? ', '
                                                    : null}
                                            </span>
                                        </span>
                                    );
                                })
                            ) : (
                                <div> - </div>
                            )}
                        </div>
                    </div>
                </div>
            </td>
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                style={{
                    height: '1px',
                    minWidth: '250px',
                }}
            >
                <div className="db-ListViewItem-link Flex-flex Flex-justifyContent--center Flex-alignItems--center">
                    <div className="Padding-all--8">
                        <button
                            className="bs-Button"
                            type="button"
                            onClick={() =>
                                openEventMemberModal(errorTrackerIssue)
                            }
                        >
                            <span>Assign Members</span>
                        </button>
                        <button
                            className={`bs-Button ${
                                errorTrackerStatus &&
                                errorTrackerStatus[errorTrackerIssue._id] &&
                                errorTrackerStatus[errorTrackerIssue._id]
                                    .requestingResolve
                                    ? ''
                                    : 'bs-Button--icon bs-Button--check'
                            }  `}
                            type="button"
                            disabled={errorTrackerIssue.resolved}
                            onClick={() =>
                                resolveSingleIssue(errorTrackerIssue._id)
                            }
                        >
                            <span>
                                {errorTrackerStatus &&
                                errorTrackerStatus[errorTrackerIssue._id] &&
                                errorTrackerStatus[errorTrackerIssue._id]
                                    .requestingResolve ? (
                                    <FormLoader2 />
                                ) : (
                                    <span>
                                        {errorTrackerIssue.resolved
                                            ? 'Resolved'
                                            : 'Resolve'}
                                    </span>
                                )}
                            </span>
                        </button>
                    </div>
                </div>
            </td>
        </tr>
    );
}
ErrorTrackerIssue.propTypes = {
    errorTracker: PropTypes.object,
    errorTrackerIssue: PropTypes.object,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    selectErrorEvent: PropTypes.func,
    selectedErrorEvents: PropTypes.array,
    openEventMemberModal: PropTypes.func,
    resolveSingleIssue: PropTypes.func,
    errorTrackerStatus: PropTypes.func,
    slug: PropTypes.string,
};
ErrorTrackerIssue.displayName = 'ErrorTrackerIssue';
export default ErrorTrackerIssue;
