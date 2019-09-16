import React, { Component } from 'react';
import { connect } from 'react-redux';
import { User } from '../config';
import { history } from '../store';

export default function (ComposedComponent) {
  class NotAuthentication extends Component {
    constructor(props) {
      super(props);
      this.props = props;

      this.isAuthenticated = User.isLoggedIn();
    }

    componentDidMount() {
      if (this.isAuthenticated) {
        history.push('/project/project/monitoring');
      }
    }

    componentDidUpdate() {
      if (this.isAuthenticated) {
        history.push('/project/project/monitoring');
      }
    }

    render() {
      return <ComposedComponent {...this.props} />;
    }
  }

  function mapStateToProps(state_Ignored) {
    return {};
  }

  NotAuthentication.displayName = 'NotAuthentication'

  return connect(mapStateToProps)(NotAuthentication);
}