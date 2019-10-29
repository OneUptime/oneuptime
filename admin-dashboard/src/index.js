import React from 'react';
import { Provider } from 'react-redux';
import { Frontload } from 'react-frontload';
import MixpanelProvider from 'react-mixpanel';
import mixpanel from 'mixpanel-browser';
import ReactGA from 'react-ga';
import ErrorBoundary from './components/basic/ErrorBoundary';
import { render } from 'react-dom';
import store, { history, isServer } from './store';
import App from './App';
import './index.css';

if (!isServer) {
	ReactGA.initialize('UA-115085157-1');
	mixpanel.init('de27af9b37fa926bf648bb704836fd5f');
}

const target = document.getElementById('root');

render (
	<Provider store={store} history={history}>
		<Frontload noServerRender={true}>
				<MixpanelProvider mixpanel={mixpanel}>
					<ErrorBoundary>
						<App />
					</ErrorBoundary>
				</MixpanelProvider>
		</Frontload>
  </Provider>,target
);
