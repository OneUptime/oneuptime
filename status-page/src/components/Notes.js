import React, { Component } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
import ShouldRender from './ShouldRender';

class Notes extends Component {
    render() {
        return (
            <ShouldRender if={this.props.notes}>
                {this.props.notes.map((note, i) => {
                    if(!note) return <div>No not</div>;
                    if (note.investigationNote) {
                        return <li className="feed-item clearfix" key={i}>
                            <img src={`/images/status_lights/${note.resolved ? 'green' : 'red'}.svg`} alt="" width="22" height="22" style={{marginTop:'4px'}}/>

                            <div className="message" style={{ width: '90%' }}>
                                <div className="text"><span style={{ fontWeight: 'Bold' }}>{note.monitorId.name.charAt(0).toUpperCase() + note.monitorId.name.substr(1)}</span>: {note.investigationNote}.</div>
                            </div>
                            <span className="time">{moment(note.createdAt).format('MMMM Do YYYY, h:mm a')}&nbsp;&nbsp;&nbsp;&nbsp;{note.resolved ? 'Resolved':'Not Resolved'}</span>
                        </li>
                    }
                    else return <li className="feed-item clearfix" key={i}>
                    <img src={`/images/status_lights/${note.resolved ? 'green' : 'red'}.svg`} alt="" width="22" height="22" style={{marginTop:'4px'}}/>

                    <div className="message" style={{ width: '90%' }}>
                        <div className="text"><span style={{ fontWeight: 'Bold' }}>{note.monitorId.name.charAt(0).toUpperCase() + note.monitorId.name.substr(1)}</span>: No incident notes added yet.</div>
                    </div>
                    <span className="time">{moment(note.createdAt).format('MMMM Do YYYY, h:mm a')}&nbsp;&nbsp;&nbsp;&nbsp;{note.resolved ? 'Resolved':'Not Resolved'}</span>
                </li>
                })}
            </ShouldRender>
        );
    }
}

Notes.displayName = 'Notes';

Notes.propTypes = {notes: PropTypes.array}

export default Notes;