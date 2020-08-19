import React, { Component } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
import { withRouter } from 'react-router-dom';
import ShouldRender from './ShouldRender';

class Notes extends Component {
    render() {
        const {
            history,
            statusPageId,
            uptimeColor,
            downtimeColor,
            degradedColor,
        } = this.props;

        return (
            <ShouldRender if={this.props.notes}>
                {this.props.notes.map((note, i) => {
                    if (!note) return <div>No note</div>;
                    return (
                        <li className="incidentlist feed-item clearfix" key={i}>
                            <div
                                className="incident-status-bubble"
                                style={{
                                    backgroundColor:
                                        note.incidentType === 'online'
                                            ? uptimeColor.backgroundColor
                                            : note.incidentType === 'offline'
                                            ? downtimeColor.backgroundColor
                                            : degradedColor.backgroundColor,
                                }}
                            ></div>
                            <div
                                className="message"
                                style={{
                                    width: '100%',
                                    marginLeft: 0,
                                    ...this.props.noteBackgroundColor,
                                }}
                            >
                                <div
                                    className="text"
                                    style={{
                                        paddingLeft: 0,
                                        paddingRight: 0,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        flexWrap: 'nowrap',
                                    }}
                                >
                                    <span
                                        style={{
                                            fontWeight: 'Bold',
                                            ...this.props.primaryTextColor,
                                            color: 'rgb(76, 76, 76)',
                                        }}
                                    >
                                        {capitalize(note.title)}
                                    </span>
                                    <span
                                        style={{
                                            ...this.props.secondaryTextColor,
                                            color: 'rgba(0, 0, 0, 0.5)',
                                            display: 'block',
                                            textAlign: 'justify',
                                        }}
                                    >
                                        {note.description}.
                                    </span>
                                </div>
                            </div>
                            <div
                                className="ongoing__affectedmonitor"
                                style={
                                    note.description
                                        ? { marginTop: 10 }
                                        : { marginTop: 0 }
                                }
                            >
                                <span
                                    className="ongoing__affectedmonitor--title"
                                    style={{ color: 'rgb(76, 76, 76)' }}
                                >
                                    Resource Affected:
                                </span>{' '}
                                <span
                                    className="ongoing__affectedmonitor--content"
                                    style={{ color: 'rgba(0, 0, 0, 0.5)' }}
                                >
                                    {capitalize(note.monitorId.name)}
                                </span>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                }}
                            >
                                <span>
                                    <span
                                className="time"
                                style={{
                                    ...this.props.secondaryTextColor,
                                    marginLeft: 0,
                                    paddingBottom: 10,
                                }}
                            >
                                {moment(note.createdAt).format(
                                    'MMMM Do YYYY, h:mm a'
                                )}
                                &nbsp;&nbsp;&nbsp;&nbsp;
                                {note.resolved ? 'Resolved' : 'Not Resolved'}
                            </span>
                        </li>
                    );
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
    noteBackgroundColor: PropTypes.object,
    statusPageId: PropTypes.string,
    history: PropTypes.object,
};

export default withRouter(Notes);
