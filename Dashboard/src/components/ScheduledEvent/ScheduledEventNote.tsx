import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentTz from 'moment-timezone';
import Markdown from 'markdown-to-jsx';
import ShouldRender from '../basic/ShouldRender';
import { currentTimeZone } from '../basic/TimezoneArray';
import DataPathHoC from '../DataPathHoC';
import { openModal } from 'CommonUI/actions/modal';
import DeleteNoteModal from './DeleteNoteModal';
import AddNoteModal from './AddNoteModal';
import EditNoteModal from './EditNoteModal';
import { User } from '../../config';
import { history, RootState } from '../../store';
import {
    fetchScheduledEventNotesInternal,
    nextPage,
    prevPage,
} from '../../actions/scheduledEvent';

interface ScheduledEventNoteProps {
    type?: string;
    notes?: unknown[];
    count?: number;
    openModal?: Function;
    projectId: string;
    scheduledEventId: string;
    scheduledEvent?: object;
    fetchScheduledEventNotesInternal?: Function;
    skip?: number | string;
    limit?: number | string;
    prevPage?: Function;
    nextPage?: Function;
    pages?: object;
}

export class ScheduledEventNote extends Component<ScheduledEventNoteProps>{
    public static displayName = '';
    public static propTypes = {};
    limit: PositiveNumber;
    constructor(props: $TSFixMe) {
        super(props);
        this.limit = 10;
    }
    handleAddNote = () => {

        const { openModal, projectId, scheduledEventId, type } = this.props;
        openModal({
            id: scheduledEventId,
            content: DataPathHoC(AddNoteModal, {
                projectId,
                scheduledEventId,
                type: type.toLowerCase(),
            }),
        });
    };

    handleDeleteNote = (scheduledEventNoteId: $TSFixMe) => {

        const { openModal, projectId, scheduledEventId, type } = this.props;
        openModal({
            id: scheduledEventNoteId,
            content: DataPathHoC(DeleteNoteModal, {
                projectId,
                scheduledEventId,
                type: type.toLowerCase(),
                scheduledEventNoteId,
            }),
        });
    };

    handleEditNote = (note: $TSFixMe) => {

        const { openModal, projectId, scheduledEventId, type } = this.props;
        openModal({
            id: note._id,
            content: DataPathHoC(EditNoteModal, {
                projectId,
                scheduledEventId,
                type: type.toLowerCase(),
                scheduledEventNoteId: note._id,
            }),
            note,
        });
    };

    prevClicked = () => {
        const {

            projectId,

            scheduledEventId,

            fetchScheduledEventNotesInternal,

            skip,

            type,
        } = this.props;

        if (type.toLowerCase() === 'internal') {
            fetchScheduledEventNotesInternal(
                projectId,
                scheduledEventId,
                this.limit,
                skip ? Number(skip) - this.limit : this.limit,
                type.toLowerCase()
            );

            this.props.prevPage(scheduledEventId + 'internal');
        }
    };

    nextClicked = () => {
        const {

            projectId,

            scheduledEventId,

            fetchScheduledEventNotesInternal,

            skip,

            type,
        } = this.props;

        if (type.toLowerCase() === 'internal') {
            fetchScheduledEventNotesInternal(
                projectId,
                scheduledEventId,
                this.limit,
                skip ? Number(skip) + this.limit : this.limit,
                type.toLowerCase()
            );

            this.props.nextPage(scheduledEventId + 'internal');
        }
    };

    override render() {

        const { type, count, notes, skip, limit } = this.props;
        const canNext = count > Number(skip) + Number(limit) ? true : false;
        const canPrev = Number(skip) <= 0 ? false : true;
        const numberOfPages = Math.ceil(parseInt(count) / 10);
        const page =
            type.toLowerCase() === 'investigation'

                ? this.props.pages[

                this.props.scheduledEventId + 'investigation'
                ]

                : this.props.pages[this.props.scheduledEventId + 'internal'];

        return (
            <div className="Box-root">
                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                            <span>Event Timeline</span>
                        </span>
                        <p>
                            {type.toLowerCase() === 'investigation' ? (
                                <span>Tell us more about what went wrong.</span>
                            ) : (
                                <span>Notes about this incident.</span>
                            )}
                        </p>
                    </div>
                    <div className="Box-root">
                        <button
                            className="bs-Button bs-ButtonLegacy ActionIconParent"
                            type="button"
                            id={`add-${type.toLowerCase()}-message`}
                            onClick={this.handleAddNote}
                        >
                            <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                <span>{`Add Note`}</span>
                            </span>
                        </button>
                    </div>
                </div>

                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <div id="overflow">
                        <div className="db-ListViewItem-cellContent Box-root">
                            <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                        </div>
                    </div>

                    <div className="bs-thread-container">
                        {notes && notes.length > 0
                            ? notes.map((note: $TSFixMe, i: $TSFixMe) => {
                                const eventStartDate =

                                    this.props.scheduledEvent &&

                                        this.props.scheduledEvent.startDate

                                        ? this.props.scheduledEvent.startDate
                                        : note.createdAt;
                                const eventEndDate =

                                    this.props.scheduledEvent &&

                                        this.props.scheduledEvent.endDate

                                        ? this.props.scheduledEvent.endDate
                                        : note.createdAt;

                                return <>
                                    {note.content &&
                                        note.event_state !== 'Deleted' &&
                                        note.event_state !== 'Resolved' &&
                                        note.event_state !== 'Started' &&
                                        note.event_state !== 'Cancelled' &&
                                        note.event_state !== 'Ended' ? (
                                        <div
                                            key={i}
                                            id={`${type}_incident_message_${i}`}
                                        >
                                            <ShouldRender if={i !== 0}>
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
                                                                    note.createdById &&
                                                                        note
                                                                            .createdById
                                                                            .name
                                                                        ? '/dashboard/assets/img/profile-user.svg'
                                                                        : '/dashboard/assets/img/ou-wb.svg'
                                                                }
                                                                className="userIcon"
                                                                alt="usericon"
                                                                style={{
                                                                    marginBottom:
                                                                        '-5px',
                                                                    backgroundColor:
                                                                        note.createdById &&
                                                                            note
                                                                                .createdById
                                                                                .name
                                                                            ? '#fff'
                                                                            : '#121212',
                                                                }}
                                                            />
                                                            <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                {note.createdById
                                                                    ? note
                                                                        .createdById
                                                                        .name
                                                                    : 'Unknown User'}
                                                            </span>
                                                        </div>

                                                        <div className="Margin-left--30">
                                                            <ShouldRender
                                                                if={
                                                                    note.updated
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
                                                                            note.createdAt
                                                                        )
                                                                            .tz(
                                                                                currentTimeZone
                                                                            )
                                                                            .format(
                                                                                'lll'
                                                                            )
                                                                        : moment(
                                                                            note.createdAt
                                                                        ).format(
                                                                            'lll'
                                                                        )}
                                                                </span>
                                                            </span>
                                                            {note.event_state ? (
                                                                <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2 bs-ma-10">
                                                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                        <span>
                                                                            {
                                                                                note.event_state
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
                                                                    whiteSpace:
                                                                        'pre-wrap',
                                                                }}
                                                            >
                                                                {note.content &&
                                                                    note.content
                                                                        .split(
                                                                            '\n'
                                                                        )
                                                                        .map(
                                                                            (
                                                                                elem: $TSFixMe,
                                                                                index: $TSFixMe
                                                                            ) => (
                                                                                <Markdown
                                                                                    key={`${elem}-${index}`}
                                                                                    options={{
                                                                                        forceBlock: true,
                                                                                    }}
                                                                                >
                                                                                    {
                                                                                        elem
                                                                                    }
                                                                                </Markdown>
                                                                            )
                                                                        )}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="bs-action-side">
                                                        <div>
                                                            <ShouldRender
                                                                if={
                                                                    note.createdById &&
                                                                    User.getUserId() ===
                                                                    note
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
                                                                                                    this.handleEditNote(
                                                                                                        note
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
                                                                                                    this.handleDeleteNote(
                                                                                                        note._id
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
                                                    notes.length - 1 !== i
                                                }
                                            >
                                                <div className="bs-thread-line-down"></div>
                                            </ShouldRender>
                                        </div>
                                    ) : note.event_state &&
                                        (note.event_state === 'Deleted' ||
                                            note.event_state ===
                                            'Started' ||
                                            note.event_state ===
                                            'Resolved' ||
                                            note.event_state ===
                                            'Cancelled' ||
                                            note.event_state ===
                                            'Ended') ? (
                                        <>
                                            <ShouldRender if={i !== 0}>
                                                <div className="bs-thread-line-up bs-ex-up"></div>
                                            </ShouldRender>
                                            <div className="bs-note-display-flex">
                                                <div
                                                    className={`bs-incident-notes 
                                                                ${note.event_state ===
                                                            'Deleted' ||
                                                            note.event_state ===
                                                            'Cancelled'
                                                            ? 'bs-note-offline'
                                                            : note.event_state ===
                                                                'Resolved' ||
                                                                note.event_state ===
                                                                'Created' ||
                                                                note.event_state ===
                                                                'Started' ||
                                                                note.event_state ===
                                                                'Ended'
                                                                ? 'bs-note-resolved'
                                                                : null
                                                        }`}
                                                ></div>
                                                <div className="bs-incident-notes-content">
                                                    <div className="bs-note-display-flex bs-mob-block">
                                                        <div>
                                                            Reported by
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
                                                                    note.createdById
                                                                ) {
                                                                    history.push(
                                                                        '/dashboard/profile/' +
                                                                        note
                                                                            .createdById
                                                                            ._id
                                                                    );
                                                                }
                                                            }}
                                                        >
                                                            <img
                                                                src={
                                                                    note.createdById &&
                                                                        note
                                                                            .createdById
                                                                            .name
                                                                        ? '/dashboard/assets/img/profile-user.svg'
                                                                        : '/dashboard/assets/img/ou-wb.svg'
                                                                }
                                                                className="userIcon"
                                                                alt=""
                                                                style={{
                                                                    marginBottom:
                                                                        '-5px',
                                                                    backgroundColor:
                                                                        note.createdById &&
                                                                            note
                                                                                .createdById
                                                                                .name
                                                                            ? '#fff'
                                                                            : '#121212',
                                                                }}
                                                            />
                                                            <span
                                                                style={{
                                                                    fontWeight:
                                                                        note.probeId &&
                                                                        '600',
                                                                }}
                                                            >
                                                                {note.event_state ===
                                                                    'Started' ||
                                                                    note.event_state ===
                                                                    'Ended'
                                                                    ? 'OneUptime'
                                                                    : note.createdById &&
                                                                        note
                                                                            .createdById
                                                                            .name
                                                                        ? note
                                                                            .createdById
                                                                            .name
                                                                        : 'Unknown User'}
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
                                                                                {note &&
                                                                                    note.event_state ===
                                                                                    'Deleted' ? (
                                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                Note
                                                                                                Deleted
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                ) : (note &&
                                                                                    note.event_state &&
                                                                                    note.event_state ===
                                                                                    'Resolved') ||
                                                                                    note.event_state ===
                                                                                    'Created' ||
                                                                                    note.event_state ===
                                                                                    'Started' ||
                                                                                    note.event_state ===
                                                                                    'Ended' ? (
                                                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                {
                                                                                                    note.content
                                                                                                }
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                {note.content ||
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
                                                            {note.event_state ===
                                                                'Started'
                                                                ? currentTimeZone
                                                                    ? momentTz(
                                                                        eventStartDate
                                                                    )
                                                                        .tz(
                                                                            currentTimeZone
                                                                        )
                                                                        .format(
                                                                            'lll'
                                                                        )
                                                                    : moment(
                                                                        eventStartDate
                                                                    ).format(
                                                                        'lll'
                                                                    )
                                                                : note.event_state ===
                                                                    'Ended'
                                                                    ? currentTimeZone
                                                                        ? momentTz(
                                                                            eventEndDate
                                                                        )
                                                                            .tz(
                                                                                currentTimeZone
                                                                            )
                                                                            .format(
                                                                                'lll'
                                                                            )
                                                                        : moment(
                                                                            eventEndDate
                                                                        ).format(
                                                                            'lll'
                                                                        )
                                                                    : currentTimeZone
                                                                        ? momentTz(
                                                                            note.createdAt
                                                                        )
                                                                            .tz(
                                                                                currentTimeZone
                                                                            )
                                                                            .format(
                                                                                'lll'
                                                                            )
                                                                        : moment(
                                                                            note.createdAt
                                                                        ).format(
                                                                            'lll'
                                                                        )}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <ShouldRender
                                                if={
                                                    notes.length - 1 !== i
                                                }
                                            >
                                                <div className="bs-thread-line-down bs-ex-down"></div>
                                            </ShouldRender>
                                        </>
                                    ) : (
                                        <div></div>
                                    )}
                                </>;
                            })
                            : null}
                    </div>
                </div>

                {notes && notes.length < 1 && (
                    <div
                        style={{
                            textAlign: 'center',
                            padding: '25px',
                        }}
                    >
                        {`You don't have any notes yet, start up one`}
                    </div>
                )}

                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                {numberOfPages > 0
                                    ? `Page ${!page ? 1 : page
                                    } of ${numberOfPages} (${count} Note${count === 1 ? '' : 's'
                                    })`
                                    : `${count} Note${count === 1 ? '' : 's'}`}
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="prevBtn"
                                    onClick={() => {
                                        this.prevClicked();
                                    }}
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (`${canPrev}` ? '' : 'Is--disabled')
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
                                    id="nextBtn"
                                    onClick={() => {
                                        this.nextClicked();
                                    }}
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (`${canNext}` ? '' : 'Is--disabled')
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


ScheduledEventNote.displayName = 'ScheduledEventNote';


ScheduledEventNote.propTypes = {
    type: PropTypes.string,
    notes: PropTypes.array,
    count: PropTypes.number,
    openModal: PropTypes.func,
    projectId: PropTypes.string.isRequired,
    scheduledEventId: PropTypes.string.isRequired,
    scheduledEvent: PropTypes.object,
    fetchScheduledEventNotesInternal: PropTypes.func,
    skip: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    limit: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    prevPage: PropTypes.func,
    nextPage: PropTypes.func,
    pages: PropTypes.object,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
        fetchScheduledEventNotesInternal,
        prevPage,
        nextPage,
    },
    dispatch
);
const mapStateToProps = (state: RootState) => {
    return {
        pages: state.scheduledEvent.pages,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(ScheduledEventNote);
