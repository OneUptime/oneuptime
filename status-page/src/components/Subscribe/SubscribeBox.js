import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Call from './Call';
import Message from './Message';
import Webhook from './Webhook';
import Monitors from './Monitors';
import { openSubscribeMenu, selectedMenu } from '../../actions/subscribe';
import ShouldRender from '../ShouldRender';
import ClickOutHandler from 'react-onclickout';
import { API_URL } from '../../config'; 

class SubscribeBox extends Component {
    constructor(props) {
        super(props);
        this.subscribebutton = this.subscribebutton.bind(this);
        this.selectbutton = this.selectbutton.bind(this);
    }
    subscribebutton = () => {
        this.props.openSubscribeMenu();
    }
    selectbutton = (data) => {
        this.props.selectedMenu(data);
    }
    render() {
        var { statusPage } = this.props;

        return (
            <div className="subscribe-overlay">
            <ClickOutHandler onClickOut={() => this.props.openSubscribeMenu()}>
                <div className="white box subscribe-box" style={{ height: 'auto', width: '300px' }}>
                    <div className="btn-group">
                        <button
                            id="updates-dropdown-email-btn"
                            disabled={this.props.subscribed.requesting}
                            onClick={() => this.selectbutton(1)}
                            className={this.props.select === 1 ? 'icon-container selected' : 'icon-container'}>
                            <span className='sub-icon icon-message'></span>
                        </button>
                        <button
                            id="updates-dropdown-sms-btn"
                            disabled={this.props.subscribed.requesting}
                            onClick={() => this.selectbutton(2)}
                            className={this.props.select === 2 ? 'icon-container selected' : 'icon-container'}>
                            <span className='sub-icon icon-call'></span>
                        </button>
                        <button
                            id="updates-dropdown-webhook-btn"
                            disabled={this.props.subscribed.requesting}
                            onClick={() => this.selectbutton(3)}
                            className={this.props.select === 3 ? 'icon-container selected' : 'icon-container'}>
                            <span className='sub-icon icon-webhook'></span>
                        </button>
                        <button
                            id="updates-dropdown-atom-btn"
                            disabled={this.props.subscribed.requesting}
                            onClick={() => this.selectbutton(4)}
                            className={this.props.select === 4 ? 'icon-container selected' : 'icon-container'}>
                            <span className='sub-icon icon-rss'></span>
                        </button>
                        <button
                            id="updates-dropdown-close-btn"
                            onClick={() => this.subscribebutton()}
                            disabled={this.props.subscribed.requesting}
                            className="icon-container">
                            <span className='close-button'>X</span>
                        </button>
                    </div>

                    <div className="subscribe-box-inner">
                        <ShouldRender if={!this.props.openSelectedBox && this.props.select === 1}>
                            <Message />
                        </ShouldRender>
                        <ShouldRender if={!this.props.openSelectedBox && this.props.select === 2}>
                            <Call />
                        </ShouldRender>
                        <ShouldRender if={!this.props.openSelectedBox && this.props.select === 3}>
                            <Webhook />
                        </ShouldRender>
                        <ShouldRender if={!this.props.openSelectedBox && this.props.select === 4}>
                                <div className="directions">
                                    Get the <a href={`${API_URL}/statusPage/${statusPage._id}/rss`}
                                        target="_blank"
                                        download="incidents-rss.xml"
                                        rel="noopener noreferrer">  
                                        RSS feed
                                    </a>
                                </div>
                        </ShouldRender>
                        <ShouldRender if={this.props.openSelectedBox}>
                            <Monitors />
                        </ShouldRender>
                    </div>
                </div>
                </ClickOutHandler>
            </div>
        );
    }
}

SubscribeBox.displayName = 'SubscribeBox';

const mapStateToProps = (state) => ({
    select: state.subscribe.selectedMenu,
    subscribed: state.subscribe.subscribed,
    openSelectedBox:state.subscribe.openSelectedBox,
    statusPage: state.status.statusPage
});

const mapDispatchToProps = (dispatch) => bindActionCreators({ openSubscribeMenu, selectedMenu }, dispatch)

SubscribeBox.propTypes = {
    openSubscribeMenu: PropTypes.func,
    selectedMenu: PropTypes.func,
    openSelectedBox:PropTypes.bool,
    select: PropTypes.number,
    subscribed: PropTypes.object,
    requesting: PropTypes.bool,
    statusPage: PropTypes.object
}

export default connect(mapStateToProps, mapDispatchToProps)(SubscribeBox);