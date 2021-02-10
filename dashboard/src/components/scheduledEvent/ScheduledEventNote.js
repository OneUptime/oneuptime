import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentTz from 'moment-timezone';
import Markdown from 'markdown-to-jsx';
import ShouldRender from '../basic/ShouldRender';
import { currentTimeZone } from '../basic/TimezoneArray';
import DataPathHoC from '../DataPathHoC';
import { openModal } from '../../actions/modal';
import DeleteNoteModal from './DeleteNoteModal';
import AddNoteModal from './AddNoteModal';
import EditNoteModal from './EditNoteModal';
import {
    fetchScheduledEventNotesInternal,
    fetchScheduledEventNotesInvestigation,
    nextPage,
    prevPage,
} from '../../actions/scheduledEvent';

export class ScheduledEventNote extends Component {
    constructor(props) {
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

    handleDeleteNote = scheduledEventNoteId => {
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

    handleEditNote = note => {
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
            fetchScheduledEventNotesInvestigation,
            skip,
            type,
        } = this.props;

        if (type.toLowerCase() === 'internal') {
            fetchScheduledEventNotesInternal(
                projectId,
                scheduledEventId,
                this.limit,
                skip ? Number(skip) - this.limit : this.limit
            );
            this.props.prevPage(scheduledEventId + 'internal');
        }

        if (type.toLowerCase() === 'investigation') {
            fetchScheduledEventNotesInvestigation(
                projectId,
                scheduledEventId,
                this.limit,
                skip ? Number(skip) - this.limit : this.limit
            );
            this.props.prevPage(scheduledEventId + 'investigation');
        }
    };

    nextClicked = () => {
        const {
            projectId,
            scheduledEventId,
            fetchScheduledEventNotesInternal,
            fetchScheduledEventNotesInvestigation,
            skip,
            type,
        } = this.props;

        if (type.toLowerCase() === 'internal') {
            fetchScheduledEventNotesInternal(
                projectId,
                scheduledEventId,
                this.limit,
                skip ? Number(skip) + this.limit : this.limit
            );
            this.props.nextPage(scheduledEventId + 'internal');
        }

        if (type.toLowerCase() === 'investigation') {
            fetchScheduledEventNotesInvestigation(
                projectId,
                scheduledEventId,
                this.limit,
                skip ? Number(skip) + this.limit : this.limit
            );
            this.props.nextPage(scheduledEventId + 'investigation');
        }
    };

    render() {
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
                            <span>{type} Notes</span>
                        </span>
                        <p>
                            {type.toLowerCase() === 'investigation' ? (
                                <span>Tell us more about what went wrong.</span>
                            ) : (
                                <span>
                                    Internal Notes about this incident. This is
                                    only visible to your team.
                                </span>
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
                                <span>{`Add ${type} Note`}</span>
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
                            {notes && notes.length > 0 ? (
                                notes.map((note, i) => {
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
                                                            cursor: 'pointer',
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
                                                            {note.createdById
                                                                .name
                                                                ? note
                                                                      .createdById
                                                                      .name
                                                                : 'Unknown User'}
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
                                                                {note.content}
                                                            </Markdown>
                                                        </span>
                                                        <ShouldRender
                                                            if={note.updated}
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
                                                                    fontStyle:
                                                                        'italic',
                                                                    fontSize: 11,
                                                                }}
                                                            >
                                                                Posted on{' '}
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
                                                {note.event_state ? (
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
                                                                                            note.event_state
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
                                                <ShouldRender if={true}>
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
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
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
                                    ? `Page ${
                                          !page ? 1 : page
                                      } of ${numberOfPages} (${count} Note${
                                          count === 1 ? '' : 's'
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
    fetchScheduledEventNotesInternal: PropTypes.func,
    fetchScheduledEventNotesInvestigation: PropTypes.func,
    skip: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    limit: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    prevPage: PropTypes.func,
    nextPage: PropTypes.func,
    pages: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal,
            fetchScheduledEventNotesInternal,
            fetchScheduledEventNotesInvestigation,
            prevPage,
            nextPage,
        },
        dispatch
    );
const mapStateToProps = state => {
    return {
        pages: state.scheduledEvent.pages,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(ScheduledEventNote);
