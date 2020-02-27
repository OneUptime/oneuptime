import React, { Component } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
import ShouldRender from './ShouldRender';

class Notes extends Component {
    render() {
        const { degradedColor, uptimeColor, downtimeColor } = this.props;

        return (
            <ShouldRender if={this.props.notes}>
                {this.props.notes.map((note, i) => {
                    if (!note) return <div>No note</div>;
                    if (note.investigationNote) {
                        return (
                            <li className="feed-item clearfix" key={i}>
                                <div
                                    className="incident-status-bubble"
                                    style={{
                                        backgroundColor:
                                            note.incidentType === 'online'
                                                ? uptimeColor.backgroundColor
                                                : note.incidentType ===
                                                  'offline'
                                                ? downtimeColor.backgroundColor
                                                : degradedColor.backgroundColor,
                                    }}
                                ></div>

                                <div
                                    className="message"
                                    style={{
                                        width: '90%',
                                        ...this.props.noteBackgroundColor,
                                    }}
                                >
                                    <div className="text">
                                        <span
                                            style={{
                                                fontWeight: 'Bold',
                                                ...this.props.primaryTextColor,
                                            }}
                                        >
                                            {note.monitorId.name
                                                .charAt(0)
                                                .toUpperCase() +
                                                note.monitorId.name.substr(1)}
                                        </span>
                                        :{' '}
                                        <span
                                            style={
                                                this.props.secondaryTextColor
                                            }
                                        >
                                            {note.investigationNote}.
                                        </span>
                                    </div>
                                </div>
                                <span
                                    className="time"
                                    style={this.props.secondaryTextColor}
                                >
                                    {moment(note.createdAt).format(
                                        'MMMM Do YYYY, h:mm a'
                                    )}
                                    &nbsp;&nbsp;&nbsp;&nbsp;
                                    {note.resolved
                                        ? 'Resolved'
                                        : 'Not Resolved'}
                                </span>
                            </li>
                        );
                    } else {
                        return (
                            <li className="feed-item clearfix" key={i}>
                                <div
                                    className="incident-status-bubble"
                                    style={{
                                        backgroundColor:
                                            note.incidentType === 'online'
                                                ? uptimeColor.backgroundColor
                                                : note.incidentType ===
                                                  'offline'
                                                ? downtimeColor.backgroundColor
                                                : degradedColor.backgroundColor,
                                    }}
                                ></div>

                                <div
                                    className="message"
                                    style={{
                                        width: '90%',
                                        ...this.props.noteBackgroundColor,
                                        top: '-30px',
                                    }}
                                >
                                    <div className="text">
                                        <span
                                            style={{
                                                fontWeight: 'Bold',
                                                ...this.props.primaryTextColor,
                                            }}
                                        >
                                            {note.monitorId.name
                                                .charAt(0)
                                                .toUpperCase() +
                                                note.monitorId.name.substr(1)}
                                        </span>
                                        :{' '}
                                        <span
                                            style={
                                                this.props.secondaryTextColor
                                            }
                                        >
                                            No incident notes added yet.
                                        </span>
                                    </div>
                                </div>
                                <span
                                    className="time"
                                    style={{
                                        ...this.props.secondaryTextColor,
                                        marginTop: '-25px',
                                    }}
                                >
                                    {moment(note.createdAt).format(
                                        'MMMM Do YYYY, h:mm a'
                                    )}
                                    &nbsp;&nbsp;&nbsp;&nbsp;
                                    {note.resolved
                                        ? 'Resolved'
                                        : 'Not Resolved'}
                                </span>
                            </li>
                        );
                    }
                })}
            </ShouldRender>
        );
    }
}

Notes.displayName = 'Notes';

Notes.propTypes = {
    notes: PropTypes.array,
    secondaryTextColor: PropTypes.object,
    primaryTextColor: PropTypes.object,
    degradedColor: PropTypes.object,
    uptimeColor: PropTypes.object,
    downtimeColor: PropTypes.object,
    noteBackgroundColor: PropTypes.object,
};

export default Notes;
