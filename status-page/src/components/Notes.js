import React, { Component } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
import { withRouter } from 'react-router-dom';
import ShouldRender from './ShouldRender';

class Notes extends Component {
    render() {
        const { history, statusPageId } = this.props;

        return (
            <ShouldRender if={this.props.notes}>
                {this.props.notes.map((note, i) => {
                    if (!note) return <div>No note</div>;
                    return (
                        <li
                            className="feed-item clearfix"
                            key={i}
                            style={{ cursor: 'pointer' }}
                            onClick={() =>
                                history.push(
                                    `/status-page/${statusPageId}/incident/${note._id}`
                                )
                            }
                        >
                            <div
                                className="message"
                                style={{
                                    width: '100%',
                                    marginLeft: 0,
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
                                    <span style={this.props.secondaryTextColor}>
                                        {note.description}.
                                    </span>
                                </div>
                            </div>
                            <span
                                className="time"
                                style={{
                                    ...this.props.secondaryTextColor,
                                    marginLeft: 12,
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
