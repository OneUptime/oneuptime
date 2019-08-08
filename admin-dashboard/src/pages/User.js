import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { destroy } from 'redux-form';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';


class User extends Component {

    componentDidMount() {
        if(window.location.href.indexOf('localhost') <= -1){
        this.context.mixpanel.track('User page Loaded');
        }
    }

    render() {
        return (
            <Dashboard>
                
            </Dashboard>
        );
    }
}

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ destroy }, dispatch)
}

const mapStateToProps = state => {
    return {
    };
}

User.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

User.propTypes = {
}

User.displayName = 'User'

export default connect(mapStateToProps, mapDispatchToProps)(User);
