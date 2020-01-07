import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  componentDidCatch(error, info) {
    // Display fallback UI
    this.setState({ hasError: true });
    // You can also log the error to an error reporting service
    if (!IS_DEV) {
      logEvent('An Error has occurred', { error, info });
    }
  }

  render() {

    if (this.state.hasError) {
      return (
        <div id="app-loading" style={{ 'position': 'fixed', 'top': '0', 'bottom': '0', 'left': '0', 'right': '0', 'backgroundColor': '#e6ebf1', 'zIndex': '999', 'display': 'flex', 'justifyContent': 'center', 'alignItems': 'center' }}>
          <div>An unexpected error has occured. Please reload the page to continue</div>
        </div>
      )
    }
    return this.props.children;
  }
}

ErrorBoundary.displayName = 'ErrorBoundary';

ErrorBoundary.propTypes = {
  children: PropTypes.any
}

export default ErrorBoundary;