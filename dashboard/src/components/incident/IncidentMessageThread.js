import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import moment from 'moment';
import momentTz from 'moment-timezone';
import { currentTimeZone } from '../basic/TimezoneArray';
import NewIncidentMessage from '../modals/NewIncidentMessage';
import { User } from '../../config';
import { ListLoader } from '../basic/Loader';
import DataPathHoC from '../DataPathHoC';
import ReactMarkdown from 'react-markdown';
import DeleteIncidentMessage from '../modals/DeleteIncidentMessage';
export class IncidentMessageThread extends Component {
    render() {
        const {
            title,
            description,
            incident,
            incidentMessages,
            count,
            canPrev,
            canNext,
            requesting,
            type,
            error,
            olderMessage,
            newerMessage,
            createMessageModalId,
            openModal,
            editMessageModalId,
            deleteMessageModalId,
            deleteIncidentMessage,
        } = this.props;
        return (
            <div className="Box-root">
                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                            <span>{title}</span>
                        </span>
                        <p>
                            <span>{description}</span>
                        </p>
                    </div>
                    <div className="Box-root">
                        <button
                            className="bs-Button bs-ButtonLegacy ActionIconParent"
                            type="button"
                            id={`add-${title.toLowerCase()}-message`}
                            onClick={() =>
                                openModal({
                                    id: createMessageModalId,
                                    onClose: () => '',
                                    content: DataPathHoC(NewIncidentMessage, {
                                        incident,
                                        formId: `New${type}Form`,
                                        type,
                                    }),
                                })
                            }
                        >
                            <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                <span>{`Add ${title} Note`}</span>
                            </span>
                        </button>
                    </div>
                </div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '400px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Note </span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                ></td>
                                <td
                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '150px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Incident State </span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    id="overflow"
                                    type="action"
                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Actions </span>
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {incidentMessages &&
                            incidentMessages.incidentMessages ? (
                                incidentMessages.incidentMessages.map(
                                    (incidentMessage, i) => {
                                        return (
                                            <tr
                                                id={`${type}_incident_message_${i}`}
                                                key={i}
                                                className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                            >
                                                <td
                                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                    style={{
                                                        height: '1px',
                                                        minWidth: '400px',
                                                    }}
                                                >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <div
                                                            className="Box-root Margin-right--16"
                                                            style={{
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                        >
                                                            <img
                                                                src="/dashboard/assets/img/profile-user.svg"
                                                                className="userIcon"
                                                                alt="usericon"
                                                                style={{
                                                                    marginBottom:
                                                                        '-5px',
                                                                }}
                                                            />
                                                            <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                {incidentMessage
                                                                    .createdById
                                                                    .name
                                                                    ? incidentMessage
                                                                          .createdById
                                                                          .name
                                                                    : 'Unknown User'}
                                                            </span>
                                                        </div>

                                                        <div className="Margin-left--30">
                                                            <span
                                                                id={`content_${type}_incident_message_${i}`}
                                                            >
                                                                <ReactMarkdown
                                                                    source={
                                                                        incidentMessage.content
                                                                    }
                                                                />
                                                                <ShouldRender
                                                                    if={
                                                                        incidentMessage.updated
                                                                    }
                                                                >
                                                                    <span
                                                                        id={`edited_${type}_incident_message_${i}`}
                                                                        className="Text-color--dark Margin-right--4"
                                                                    >
                                                                        (edited)
                                                                    </span>
                                                                </ShouldRender>
                                                            </span>
                                                            <span className="Text-display--inline Text-fontSize--14 Text-lineHeight--16 Text-wrap--noWrap">
                                                                <span
                                                                    style={{
                                                                        fontWeight:
                                                                            '500',
                                                                        fontStyle:
                                                                            'italic',
                                                                    }}
                                                                >
                                                                    {currentTimeZone
                                                                        ? momentTz(
                                                                              incidentMessage.createdAt
                                                                          )
                                                                              .tz(
                                                                                  currentTimeZone
                                                                              )
                                                                              .format(
                                                                                  'lll'
                                                                              )
                                                                        : moment(
                                                                              incidentMessage.createdAt
                                                                          ).format(
                                                                              'lll'
                                                                          )}
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td
                                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{ height: '1px' }}
                                                ></td>
                                                <td
                                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{
                                                        height: '1px',
                                                        minWidth: '150px',
                                                    }}
                                                >
                                                    {incidentMessage.incident_state ? (
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                        <span>
                                                                                            {
                                                                                                incidentMessage.incident_state
                                                                                            }
                                                                                        </span>
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </td>
                                                <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"></td>
                                                <td
                                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{ height: '1px' }}
                                                >
                                                    <ShouldRender
                                                        if={
                                                            User.getUserId() ===
                                                            incidentMessage
                                                                .createdById._id
                                                        }
                                                    >
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Flex">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                    <button
                                                                                        className="bs-Button bs-DeprecatedButton"
                                                                                        type="button"
                                                                                        onClick={() =>
                                                                                            openModal(
                                                                                                {
                                                                                                    id: editMessageModalId,
                                                                                                    onClose: () =>
                                                                                                        '',
                                                                                                    content: DataPathHoC(
                                                                                                        NewIncidentMessage,
                                                                                                        {
                                                                                                            incident,
                                                                                                            formId: `Edit${type}Form`,
                                                                                                            type,
                                                                                                            incidentMessage,
                                                                                                            edit: true,
                                                                                                        }
                                                                                                    ),
                                                                                                }
                                                                                            )
                                                                                        }
                                                                                        id={`edit_${type}_incident_message_${i}`}
                                                                                    >
                                                                                        <span>
                                                                                            <img
                                                                                                src={`/dashboard/assets/img/edit.svg`}
                                                                                                style={{
                                                                                                    height:
                                                                                                        '10px',
                                                                                                    width:
                                                                                                        '10px',
                                                                                                }}
                                                                                                alt="edit"
                                                                                            />{' '}
                                                                                            Edit
                                                                                        </span>
                                                                                    </button>
                                                                                    <button
                                                                                        className="bs-Button bs-DeprecatedButton bs-Button--icon bs-Button--delete"
                                                                                        type="button"
                                                                                        onClick={() =>
                                                                                            openModal(
                                                                                                {
                                                                                                    id: deleteMessageModalId,
                                                                                                    onClose: () =>
                                                                                                        '',
                                                                                                    onConfirm: () =>
                                                                                                        deleteIncidentMessage(
                                                                                                            incidentMessage._id
                                                                                                        ),
                                                                                                    content: DataPathHoC(
                                                                                                        DeleteIncidentMessage,
                                                                                                        {
                                                                                                            incidentMessage,
                                                                                                        }
                                                                                                    ),
                                                                                                }
                                                                                            )
                                                                                        }
                                                                                        id={`delete_${type}_incident_message_${i}`}
                                                                                    >
                                                                                        <span>
                                                                                            Delete
                                                                                        </span>
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </ShouldRender>
                                                </td>
                                            </tr>
                                        );
                                    }
                                )
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {requesting ? <ListLoader /> : null}

                {incidentMessages &&
                incidentMessages.incidentMessages &&
                incidentMessages.incidentMessages.length < 1 ? (
                    <div
                        style={{
                            textAlign: 'center',
                            padding: '25px',
                        }}
                    >
                        {`You don't have any messages yet, start up a conversation`}
                    </div>
                ) : null}
                {error}

                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                {count
                                    ? count +
                                      (count > 1 ? ' Messages' : ' Message')
                                    : '0 Messages'}
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnTimelinePrev"
                                    onClick={() => {
                                        olderMessage();
                                    }}
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (canPrev ? '' : 'Is--disabled')
                                    }
                                    disabled={!canPrev}
                                    data-db-analytics-name="list_view.pagination.previous"
                                    type="button"
                                >
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                            <span>Newer Messages</span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                            <div className="Box-root">
                                <button
                                    id="btnTimelineNext"
                                    onClick={() => {
                                        newerMessage();
                                    }}
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (canNext ? '' : 'Is--disabled')
                                    }
                                    disabled={!canNext}
                                    data-db-analytics-name="list_view.pagination.next"
                                    type="button"
                                >
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                            <span>Older Messages</span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

IncidentMessageThread.displayName = 'IncidentMessageThread';

IncidentMessageThread.propTypes = {
    title: PropTypes.string,
    description: PropTypes.string,
    incident: PropTypes.object.isRequired,
    incidentMessages: PropTypes.object,
    count: PropTypes.number,
    canPrev: PropTypes.bool,
    canNext: PropTypes.bool,
    requesting: PropTypes.bool,
    type: PropTypes.string,
    error: PropTypes.string,
    olderMessage: PropTypes.func,
    newerMessage: PropTypes.func,
    openModal: PropTypes.func,
    createMessageModalId: PropTypes.string,
    editMessageModalId: PropTypes.string,
    deleteMessageModalId: PropTypes.string,
    deleteIncidentMessage: PropTypes.func,
};

export default IncidentMessageThread;
