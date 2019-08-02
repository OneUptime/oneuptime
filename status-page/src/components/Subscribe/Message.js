import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { userData, validationError } from '../../actions/subscribe';
import ShouldRender from '../ShouldRender';


class Message extends Component {
    constructor(props) {
        super(props);
        this.state = { email: '' };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    handleChange = (event) => {
        this.setState({ email: event.target.value });
    }
    handleSubmit = (event) => {
        if (this.state.email && this.state.email.length) {
            let validemail = this.validation(this.state.email);
            if (validemail) {
                var values = this.state;
                values.method = 'email';
                this.props.userData(values);
            }
            else {
                this.props.validationError('Please enter a valid email address.');
            }
        }
        else {
            this.props.validationError('Please enter your email address.');
        }
        event.preventDefault();
    }

    validation = (email) => {
        if (email.match(/^([a-zA-Z0-9_.-])+@(([a-zA-Z0-9-])+\.)+([a-zA-Z0-9]{2,4})+$/)) {
            return true;
        }
        else {
            return false;
        }
    }

    render() {

        return (
            <div>
                <div className="directions">
                    Get email notifications when an incident is <strong>created</strong>.
          </div>
                <form id="subscribe-form-email" onSubmit={this.handleSubmit}>

                    <input name="email" onChange={this.handleChange} type="text" placeholder="Email Address" className="input-full" />
                    <input type="submit" value="Subscribe" className="subscribe-btn-full" id="subscribe-btn-email"></input>

                </form>
                <ShouldRender if={this.props.subscribed && this.props.subscribed.error}>
                    <div className="validation-error">
                        <span className="validation-error-icon"></span>
                        <span className='error-text'>
                            {this.props.subscribed && this.props.subscribed.error}
                        </span>
                    </div>
                </ShouldRender>
            </div>
        );
    }
}

Message.displayName = 'Message';

const mapStateToProps = (state) => ({
    userDetails: state.subscribe.userDetails,
    subscribed: state.subscribe.subscribed,
});

const mapDispatchToProps = (dispatch) => bindActionCreators({ userData, validationError }, dispatch)

Message.propTypes = {
    userData:PropTypes.func,
    validationError:PropTypes.func,
    subscribed:PropTypes.object,
    error:PropTypes.string
}

export default connect(mapStateToProps, mapDispatchToProps)(Message);