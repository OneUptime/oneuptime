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
import Markdown from 'markdown-to-jsx';
import DeleteIncidentMessage from '../modals/DeleteIncidentMessage';
import { history } from '../../store';
export class IncidentMessageThread extends Component {
    render() {
        const {
            title,
            description,
            incident,
            incidentMessages,
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
                            <span>
                                {title === 'Status Page' ? title : 'Timeline'}
                            </span>
                        </span>
                        <p>
                            <span>{description}</span>
                        </p>
                    </div>
                    <div className="Box-root">
                        <button
                            className="bs-Button bs-ButtonLegacy ActionIconParent"
                            type="button"
                            id={`add-${type}-message`}
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
                {type === 'investigation' ? (
                    <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                        <table className="Table">
                            <thead className="Table-body">
                                <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                            minWidth: '400px',
                                        }}
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
                                        style={{
                                            height: '1px',
                                            minWidth: '150px',
                                        }}
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
                                        <div
                                            className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                            style={{ float: 'right' }}
                                        >
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
                                                                    src={
                                                                        incidentMessage.createdById &&
                                                                        incidentMessage
                                                                            .createdById
                                                                            .name
                                                                            ? '/dashboard/assets/img/profile-user.svg'
                                                                            : '/dashboard/assets/img/Fyipe.svg'
                                                                    }
                                                                    className="userIcon"
                                                                    alt="usericon"
                                                                    style={{
                                                                        marginBottom:
                                                                            '-5px',
                                                                    }}
                                                                />
                                                                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    {incidentMessage.createdById &&
                                                                    incidentMessage
                                                                        .createdById
                                                                        .name
                                                                        ? incidentMessage
                                                                              .createdById
                                                                              .name
                                                                        : incident.createdByZapier
                                                                        ? 'Zapier'
                                                                        : 'Fyipe'}
                                                                </span>
                                                            </div>

                                                            <div className="Margin-left--30">
                                                                <span
                                                                    id={`content_${type}_incident_message_${i}`}
                                                                    style={{
                                                                        display:
                                                                            'block',
                                                                    }}
                                                                >
                                                                    <Markdown>
                                                                        {
                                                                            incidentMessage.content
                                                                        }
                                                                    </Markdown>
                                                                </span>
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
                                                                <span className="Text-display--inline Text-fontSize--14 Text-lineHeight--16 Text-wrap--noWrap">
                                                                    <span
                                                                        style={{
                                                                            fontWeight:
                                                                                '500',
                                                                            fontSize:
                                                                                '11px',
                                                                        }}
                                                                    >
                                                                        Posted
                                                                        on{' '}
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
                                                        style={{
                                                            height: '1px',
                                                        }}
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
                                                        style={{
                                                            height: '1px',
                                                        }}
                                                    >
                                                        <ShouldRender
                                                            if={
                                                                incidentMessage.createdById &&
                                                                User.getUserId() ===
                                                                    incidentMessage
                                                                        .createdById
                                                                        ._id
                                                            }
                                                        >
                                                            <div className="db-ListViewItem-link">
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                        <div className="Box-root Flex">
                                                                            <div
                                                                                className="Box-root Flex-flex"
                                                                                style={{
                                                                                    justifyContent:
                                                                                        'flex-end',
                                                                                }}
                                                                            >
                                                                                <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                    <div
                                                                                        className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                                                        style={{
                                                                                            paddingRight:
                                                                                                '0',
                                                                                        }}
                                                                                    >
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
                ) : (
                    <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                        <div id="overflow">
                            <div className="db-ListViewItem-cellContent Box-root">
                                <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                            </div>
                        </div>
                        <div className="bs-thread-container">
                            {incidentMessages &&
                            incidentMessages.incidentMessages ? (
                                incidentMessages.incidentMessages.map(
                                    (incidentMessage, i) => {
                                        return (
                                            <>
                                                {incidentMessage.content ? (
                                                    <div
                                                        key={i}
                                                        id={`${type}_incident_message_${i}`}
                                                    >
                                                        <ShouldRender
                                                            if={i !== 0}
                                                        >
                                                            <div className="bs-thread-line-up"></div>
                                                        </ShouldRender>
                                                        <div className="bs-thread-card">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8 bs-thread-display">
                                                                <div className="bs-thread-content">
                                                                    <div
                                                                        className="Box-root Margin-right--16"
                                                                        style={{
                                                                            cursor:
                                                                                'pointer',
                                                                        }}
                                                                    >
                                                                        <img
                                                                            src={
                                                                                incidentMessage.createdById &&
                                                                                incidentMessage
                                                                                    .createdById
                                                                                    .name
                                                                                    ? '/dashboard/assets/img/profile-user.svg'
                                                                                    : '/dashboard/assets/img/Fyipe.svg'
                                                                            }
                                                                            className="userIcon"
                                                                            alt="usericon"
                                                                            style={{
                                                                                marginBottom:
                                                                                    '-5px',
                                                                            }}
                                                                        />
                                                                        <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                            {incidentMessage.createdById &&
                                                                            incidentMessage
                                                                                .createdById
                                                                                .name
                                                                                ? incidentMessage
                                                                                      .createdById
                                                                                      .name
                                                                                : incident.createdByZapier
                                                                                ? 'Zapier'
                                                                                : 'Fyipe'}
                                                                        </span>
                                                                    </div>

                                                                    <div className="Margin-left--30">
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
                                                                        <span className="Text-display--inline Text-fontSize--14 Text-lineHeight--16 Text-wrap--noWrap">
                                                                            <span
                                                                                style={{
                                                                                    fontWeight:
                                                                                        '500',
                                                                                    fontSize:
                                                                                        '11px',
                                                                                }}
                                                                            >
                                                                                Posted
                                                                                on{' '}
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
                                                                        {incidentMessage.incident_state ? (
                                                                            <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2 bs-ma-10">
                                                                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                    <span>
                                                                                        {
                                                                                            incidentMessage.incident_state
                                                                                        }
                                                                                    </span>
                                                                                </span>
                                                                            </div>
                                                                        ) : null}
                                                                        <span
                                                                            id={`content_${type}_incident_message_${i}`}
                                                                            style={{
                                                                                display:
                                                                                    'block',
                                                                                marginTop:
                                                                                    '10px',
                                                                            }}
                                                                        >
                                                                            <Markdown>
                                                                                {
                                                                                    incidentMessage.content
                                                                                }
                                                                            </Markdown>
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <div className="bs-action-side">
                                                                    <div>
                                                                        <ShouldRender
                                                                            if={
                                                                                incidentMessage.createdById &&
                                                                                User.getUserId() ===
                                                                                    incidentMessage
                                                                                        .createdById
                                                                                        ._id
                                                                            }
                                                                        >
                                                                            <div className="db-ListViewItem-link">
                                                                                <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                        <div className="Box-root Flex">
                                                                                            <div
                                                                                                className="Box-root Flex-flex"
                                                                                                style={{
                                                                                                    justifyContent:
                                                                                                        'flex-end',
                                                                                                }}
                                                                                            >
                                                                                                <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                                    <div
                                                                                                        className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                                                                        style={{
                                                                                                            paddingRight:
                                                                                                                '0',
                                                                                                        }}
                                                                                                    >
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
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <ShouldRender
                                                            if={
                                                                incidentMessages
                                                                    .incidentMessages
                                                                    .length -
                                                                    1 !==
                                                                i
                                                            }
                                                        >
                                                            <div className="bs-thread-line-down"></div>
                                                        </ShouldRender>
                                                    </div>
                                                ) : incidentMessage.status ? (
                                                    <>
                                                        <ShouldRender
                                                            if={i !== 0}
                                                        >
                                                            <div className="bs-thread-line-up bs-ex-up"></div>
                                                        </ShouldRender>
                                                        <div className="bs-note-display-flex">
                                                            <div
                                                                className={`bs-incident-notes 
                                                                    ${
                                                                        incidentMessage.status ===
                                                                            'closed' ||
                                                                        incidentMessage.status ===
                                                                            'offline'
                                                                            ? 'bs-note-offline'
                                                                            : incidentMessage.status ===
                                                                                  'acknowledged' ||
                                                                              incidentMessage.status ===
                                                                                  'degraded'
                                                                            ? 'bs-note-acknowleged'
                                                                            : incidentMessage.status ===
                                                                                  'resolved' ||
                                                                              incidentMessage.status ===
                                                                                  'online'
                                                                            ? 'bs-note-resolved'
                                                                            : incidentMessage.status ===
                                                                                  'internal notes updated' ||
                                                                              incidentMessage.status ===
                                                                                  'investigation notes updated'
                                                                            ? 'bs-note-updated'
                                                                            : incidentMessage.status ===
                                                                                  'investigation notes added' ||
                                                                              incidentMessage.status ===
                                                                                  'internal notes added' ||
                                                                              incidentMessage.status ===
                                                                                  'created'
                                                                            ? 'bs-note-offline-o'
                                                                            : 'bs-note-offline'
                                                                    }`}
                                                            ></div>
                                                            <div className="bs-incident-notes-content">
                                                                <div className="bs-note-display-flex bs-mob-block">
                                                                    <div>
                                                                        Reported
                                                                        by
                                                                    </div>
                                                                    <div
                                                                        className="Box-root Margin-right--16 bs-note-7"
                                                                        style={{
                                                                            cursor:
                                                                                'pointer',
                                                                            marginLeft:
                                                                                '6px',
                                                                        }}
                                                                        onClick={() => {
                                                                            if (
                                                                                incidentMessage.createdById
                                                                            ) {
                                                                                history.push(
                                                                                    '/dashboard/profile/' +
                                                                                        incidentMessage
                                                                                            .createdById
                                                                                            ._id
                                                                                );
                                                                            }
                                                                        }}
                                                                    >
                                                                        <img
                                                                            src={
                                                                                incidentMessage.createdById &&
                                                                                incidentMessage
                                                                                    .createdById
                                                                                    .name
                                                                                    ? '/dashboard/assets/img/profile-user.svg'
                                                                                    : '/dashboard/assets/img/Fyipe.svg'
                                                                            }
                                                                            className="userIcon"
                                                                            alt=""
                                                                            style={{
                                                                                marginBottom:
                                                                                    '-5px',
                                                                            }}
                                                                        />
                                                                        <span>
                                                                            {incidentMessage.createdById &&
                                                                            incidentMessage
                                                                                .createdById
                                                                                .name
                                                                                ? incidentMessage
                                                                                      .createdById
                                                                                      .name
                                                                                : 'Fyipe'}
                                                                        </span>
                                                                    </div>

                                                                    <div
                                                                        className="db-ListViewItem-link"
                                                                        style={{
                                                                            width:
                                                                                '0%',
                                                                        }}
                                                                    >
                                                                        <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                            <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                <div className="Box-root Flex-flex">
                                                                                    <div className="Box-root Flex-flex">
                                                                                        <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                            {incidentMessage &&
                                                                                            incidentMessage.status &&
                                                                                            (incidentMessage.status ===
                                                                                                'closed' ||
                                                                                                incidentMessage.status ===
                                                                                                    'offline') ? (
                                                                                                <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                                    <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                        <span>
                                                                                                            {
                                                                                                                incidentMessage.status
                                                                                                            }
                                                                                                        </span>
                                                                                                    </span>
                                                                                                </div>
                                                                                            ) : incidentMessage &&
                                                                                              incidentMessage.status &&
                                                                                              (incidentMessage.status ===
                                                                                                  'resolved' ||
                                                                                                  incidentMessage.status ===
                                                                                                      'online') ? (
                                                                                                <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                        <span>
                                                                                                            {
                                                                                                                incidentMessage.status
                                                                                                            }
                                                                                                        </span>
                                                                                                    </span>
                                                                                                </div>
                                                                                            ) : incidentMessage &&
                                                                                              incidentMessage.status &&
                                                                                              (incidentMessage.status ===
                                                                                                  'acknowledged' ||
                                                                                                  incidentMessage.status ===
                                                                                                      'degraded') ? (
                                                                                                <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                                    <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                        <span>
                                                                                                            {
                                                                                                                incidentMessage.status
                                                                                                            }
                                                                                                        </span>
                                                                                                    </span>
                                                                                                </div>
                                                                                            ) : incidentMessage &&
                                                                                              incidentMessage.status &&
                                                                                              (incidentMessage.status ===
                                                                                                  'created' ||
                                                                                                  incidentMessage.status ===
                                                                                                      'internal notes added' ||
                                                                                                  incidentMessage.status ===
                                                                                                      'investigation notes added') ? (
                                                                                                <div className="Badge Badge--color--blue Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                                    <span className="Badge-text Text-color--blue Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                        <span>
                                                                                                            {
                                                                                                                incidentMessage.status
                                                                                                            }
                                                                                                        </span>
                                                                                                    </span>
                                                                                                </div>
                                                                                            ) : incidentMessage &&
                                                                                              incidentMessage.status &&
                                                                                              (incidentMessage.status ===
                                                                                                  'internal notes updated' ||
                                                                                                  incidentMessage.status ===
                                                                                                      'investigation notes updated') ? (
                                                                                                <div className="Badge Badge--color--purple Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                                    <span className="Badge-text Text-color--purple Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                        <span>
                                                                                                            {
                                                                                                                incidentMessage.status
                                                                                                            }
                                                                                                        </span>
                                                                                                    </span>
                                                                                                </div>
                                                                                            ) : (
                                                                                                <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                                    <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                        <span>
                                                                                                            {incidentMessage.status ||
                                                                                                                'Unknown Status'}
                                                                                                        </span>
                                                                                                    </span>
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <span>
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
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <ShouldRender
                                                            if={
                                                                incidentMessages
                                                                    .incidentMessages
                                                                    .length -
                                                                    1 !==
                                                                i
                                                            }
                                                        >
                                                            <div className="bs-thread-line-down bs-ex-down"></div>
                                                        </ShouldRender>
                                                    </>
                                                ) : incidentMessage.totalSubscribers ? (
                                                    <>
                                                        <ShouldRender
                                                            if={i !== 0}
                                                        >
                                                            <div className="bs-thread-line-up bs-ex-up"></div>
                                                        </ShouldRender>
                                                        <div className="bs-note-display-flex">
                                                            <div
                                                                className={`bs-incident-notes 
                                                                            ${
                                                                                incidentMessage.eventType ===
                                                                                    'resolved' ||
                                                                                incidentMessage.eventType ===
                                                                                    'identified'
                                                                                    ? 'bs-note-resolved'
                                                                                    : incidentMessage.eventType ===
                                                                                      'acknowledged'
                                                                                    ? 'bs-note-acknowleged'
                                                                                    : 'bs-note-offline-o'
                                                                            }`}
                                                            ></div>
                                                            <div className="bs-incident-notes-content">
                                                                <div className="bs-note-display-flex bs-mob-block">
                                                                    <div>
                                                                        {incidentMessage.eventType ===
                                                                            'status page note created' ||
                                                                        incidentMessage.eventType ===
                                                                            'status page note updated'
                                                                            ? 'Action'
                                                                            : 'Incident'}
                                                                    </div>
                                                                    <div>
                                                                        <div className="db-ListViewItem-link">
                                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                    <div
                                                                                        className={`Badge Badge--color--${
                                                                                            incidentMessage.eventType ===
                                                                                            'identified'
                                                                                                ? 'green'
                                                                                                : incidentMessage.eventType ===
                                                                                                  'acknowledged'
                                                                                                ? 'yellow'
                                                                                                : incidentMessage.eventType ===
                                                                                                  'resolved'
                                                                                                ? 'green'
                                                                                                : null
                                                                                        } Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
                                                                                    >
                                                                                        <span
                                                                                            className={`Badge-text Text-color--${
                                                                                                incidentMessage.eventType ===
                                                                                                'identified'
                                                                                                    ? 'green'
                                                                                                    : incidentMessage.eventType ===
                                                                                                      'acknowledged'
                                                                                                    ? 'yellow'
                                                                                                    : incidentMessage.eventType ===
                                                                                                      'resolved'
                                                                                                    ? 'green'
                                                                                                    : null
                                                                                            } Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}
                                                                                        >
                                                                                            {
                                                                                                incidentMessage.eventType
                                                                                            }
                                                                                        </span>
                                                                                    </div>
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        {!incidentMessage.error
                                                                            ? `Alert sent to ${
                                                                                  incidentMessage.totalSubscribers
                                                                              } ${
                                                                                  incidentMessage.totalSubscribers >
                                                                                  1
                                                                                      ? 'subscribers'
                                                                                      : 'subscriber'
                                                                              }`
                                                                            : `Alert sent to ${
                                                                                  incidentMessage.totalSubscribers
                                                                              } ${
                                                                                  incidentMessage.totalSubscribers >
                                                                                  1
                                                                                      ? 'subscribers'
                                                                                      : 'subscriber'
                                                                              } while some failed`}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <span>
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
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <ShouldRender
                                                            if={
                                                                incidentMessages
                                                                    .incidentMessages
                                                                    .length -
                                                                    1 !==
                                                                i
                                                            }
                                                        >
                                                            <div className="bs-thread-line-down bs-ex-down"></div>
                                                        </ShouldRender>
                                                    </>
                                                ) : (
                                                    <>
                                                        <ShouldRender
                                                            if={i !== 0}
                                                        >
                                                            <div className="bs-thread-line-up bs-ex-up"></div>
                                                        </ShouldRender>
                                                        <div className="bs-note-display-flex">
                                                            <div
                                                                className={`bs-incident-notes 
                                                                        ${
                                                                            incidentMessage.eventType ===
                                                                                'resolved' ||
                                                                            incidentMessage.eventType ===
                                                                                'identified'
                                                                                ? 'bs-note-resolved'
                                                                                : incidentMessage.eventType ===
                                                                                  'acknowledged'
                                                                                ? 'bs-note-acknowleged'
                                                                                : 'bs-note-offline'
                                                                        }`}
                                                            ></div>
                                                            <div className="bs-incident-notes-content">
                                                                <div className="bs-note-display-flex bs-mob-block">
                                                                    <div
                                                                        className="Box-root bs-note-7"
                                                                        style={{
                                                                            cursor:
                                                                                'pointer',
                                                                            marginRight:
                                                                                '5px',
                                                                        }}
                                                                        onClick={() => {
                                                                            if (
                                                                                incidentMessage.userId
                                                                            ) {
                                                                                history.push(
                                                                                    '/dashboard/profile/' +
                                                                                        incidentMessage
                                                                                            .userId
                                                                                            ._id
                                                                                );
                                                                            }
                                                                        }}
                                                                    >
                                                                        <img
                                                                            src={
                                                                                incidentMessage.userId &&
                                                                                incidentMessage
                                                                                    .userId
                                                                                    .name
                                                                                    ? '/dashboard/assets/img/profile-user.svg'
                                                                                    : '/dashboard/assets/img/Fyipe.svg'
                                                                            }
                                                                            className="userIcon"
                                                                            alt=""
                                                                            style={{
                                                                                marginBottom:
                                                                                    '-5px',
                                                                            }}
                                                                        />
                                                                        <span>
                                                                            {incidentMessage.userId &&
                                                                            incidentMessage
                                                                                .userId
                                                                                .name
                                                                                ? incidentMessage
                                                                                      .userId
                                                                                      .name
                                                                                : 'Fyipe'}
                                                                        </span>
                                                                    </div>
                                                                    <div>
                                                                        is
                                                                        notified
                                                                        by{' '}
                                                                        {incidentMessage.alertVia ===
                                                                        'email'
                                                                            ? 'an'
                                                                            : 'a'}{' '}
                                                                        <span
                                                                            style={{
                                                                                fontSize:
                                                                                    '13px',
                                                                                fontWeight:
                                                                                    '600',
                                                                                textTransform:
                                                                                    'uppercase',
                                                                            }}
                                                                        >
                                                                            {
                                                                                incidentMessage.alertVia
                                                                            }
                                                                        </span>{' '}
                                                                        because
                                                                        an
                                                                        incident
                                                                        was{' '}
                                                                        <span
                                                                            style={{
                                                                                fontWeight:
                                                                                    '600',
                                                                            }}
                                                                        >
                                                                            {incidentMessage.eventType ===
                                                                            'identified'
                                                                                ? 'created'
                                                                                : incidentMessage.eventType}
                                                                        </span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="db-ListViewItem-link">
                                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                    <div className="Box-root Flex-flex">
                                                                                        <div className="Box-root Flex-flex">
                                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                                <div
                                                                                                    className="Box-root Flex-flex Flex-alignItems--center"
                                                                                                    style={{
                                                                                                        height:
                                                                                                            '100%',
                                                                                                    }}
                                                                                                >
                                                                                                    <div
                                                                                                        className={`Badge ${
                                                                                                            incidentMessage.alertStatus ===
                                                                                                            'Success'
                                                                                                                ? 'Badge--color--green'
                                                                                                                : 'Badge--color--red'
                                                                                                        } Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
                                                                                                    >
                                                                                                        <span
                                                                                                            className={`Badge-text ${
                                                                                                                incidentMessage.alertStatus ===
                                                                                                                'Success'
                                                                                                                    ? 'Text-color--green'
                                                                                                                    : 'Text-color--red'
                                                                                                            } Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}
                                                                                                        >
                                                                                                            <span>
                                                                                                                {
                                                                                                                    incidentMessage.alertStatus
                                                                                                                }
                                                                                                            </span>
                                                                                                        </span>
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                </span>
                                                                            </div>
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <span>
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
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <ShouldRender
                                                            if={
                                                                incidentMessages
                                                                    .incidentMessages
                                                                    .length -
                                                                    1 !==
                                                                i
                                                            }
                                                        >
                                                            <div className="bs-thread-line-down bs-ex-down"></div>
                                                        </ShouldRender>
                                                    </>
                                                )}
                                            </>
                                        );
                                    }
                                )
                            ) : (
                                <div></div>
                            )}
                        </div>
                    </div>
                )}

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

                {type === 'investigation' && (
                    <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                        <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {incidentMessages.incidentMessages.length
                                        ? incidentMessages.incidentMessages
                                              .length +
                                          (incidentMessages.incidentMessages
                                              .length > 1
                                              ? ' Messages'
                                              : ' Message')
                                        : '0 Messages'}
                                </span>
                            </span>
                        </div>
                        <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                <div className="Box-root Margin-right--8">
                                    <button
                                        id={`btn-${type}-Prev`}
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
                                        id={`btn-${type}-Next`}
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
                )}
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
