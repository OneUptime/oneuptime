import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { User } from '../config';
import { history } from '../store';

export default function (ComposedComponent) {
  class Authentication extends Component {

    constructor(props){
      super(props);
      this.props = props;

      this.isAuthenticated = User.isLoggedIn();
    }

    componentDidMount() {
      if (!this.isAuthenticated) {
        history.push('/login', { continue: this.props.location.pathname });
      }
    }

    componentDidUpdate() {
      if (!this.isAuthenticated) { 
        history.push('/login', { continue: this.props.location.pathname });
      }
    }

    PropTypes = {
      router: PropTypes.object
    }

    render() {
      return <ComposedComponent {...this.props} />;
    }
  }

  Authentication.propTypes = {
    location: PropTypes.object
  }

  Authentication.displayName = 'RequireAuth'

  function mapStateToProps(state_Ignored) {
    return {};
  }

  function mapDispatchToProps (dispatch_Ignored) {
  return {};
}

  return connect(mapStateToProps, mapDispatchToProps)(Authentication);
}
