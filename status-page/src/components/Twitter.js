import React from 'react';
import PropTypes from 'prop-types';

class Twitter extends React.Component {
    state = {
        tweets: [
            {
                text:
                    'Jesus Loves the little children, all the children of the world',
                created_at: '2019-06-11T17:59:13.000Z',
            },
            {
                text:
                    'Jesus Loves the little children, all the children of the world',
                created_at: '2019-06-11T17:59:13.000Z',
            },
            {
                text:
                    'Jesus Loves the little children, all the children of the world',
                created_at: '2019-06-11T17:59:13.000Z',
            },
            {
                text:
                    'Jesus Loves the little children, all the children of the world',
                created_at: '2019-06-11T17:59:13.000Z',
            },
        ],
    };

    tweetList = (tweet, index) => {
        return (
            <li
                className="incidentlist feed-item clearfix"
                style={{
                    margin: '0 0 10px',
                    cursor: 'text',
                }}
                key={index}
            >
                <div className="ct_desc">{tweet.text}</div>
                {/* <span>{tweet.created_at}</span> */}
            </li>
        );
    };

    render() {
        return (
            <div>
                <div
                    id="scheduledEvents"
                    className="twitter-feed white box"
                    style={{ overflow: 'visible' }}
                >
                    <div className="messages" style={{ position: 'relative' }}>
                        <div
                            className="box-inner"
                            style={{
                                paddingLeft: 0,
                                paddingRight: 0,
                                width: '100%',
                            }}
                        >
                            <div
                                style={{ display: 'block' }}
                                className="feed-header"
                            >
                                <span className="feed-title">
                                    Twitter Updates
                                </span>
                                <ul className="feed-contents plain">
                                    {this.state.tweets.map((tweet, i) =>
                                        this.tweetList(tweet, i)
                                    )}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>

                {/*  */}
            </div>
        );
    }
}

Twitter.displayName = 'Twitter';

Twitter.PropTypes = {
    handle: PropTypes.string,
    theme: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

export default Twitter;
