import React from 'react';
import PropTypes from 'prop-types'

export default function MessageBox(props) {
    return (
        <div id="main-body" className="box css">
            <div className="inner">
                <div className="request-reset-step step" >
                    <div className="title">
                        <h2>
                            {props.title}
                        </h2>
                    </div>
                    <p className="error-message hidden" />
                    <p className="message">{props.message}</p>
                </div>
            </div>
        </div>
    )
}

MessageBox.displayName = 'MessageBox'

MessageBox.propTypes = {
    title: PropTypes.string,
    message: PropTypes.string,
}