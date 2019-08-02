import React from 'react';

import store from '../src/store/store'
import { Provider } from 'react-redux';

Date.now = (() => 1487076708000) 

export default class Container extends React.Component {
  render() {
    const { story } = this.props;

    return (
      <Provider store={store}>
        <div style={{ margin: '10%' }} >
                {story()}
            </div>
    </Provider>
    );
  }
}
