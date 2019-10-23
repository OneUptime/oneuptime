import React from 'react';
import { Router, Route, Redirect, Switch } from 'react-router-dom';
import { history, isServer } from './store';
import { connect } from 'react-redux';
import { allRoutes } from './routes';
import NotFound from './components/404';
import BackboneModals from './containers/BackboneModals';
import { User, DASHBOARD_URL } from './config';

import ReactGA from 'react-ga';

if (!isServer) {
	history.listen(location => {
		ReactGA.set({ page: location.pathname });
		ReactGA.pageview(location.pathname);
	});
}

if (User.isLoggedIn()) {
	window.location = DASHBOARD_URL;
	store.dispatch(loadPage('Home'));
}

const App = () => (
	<div style={{ height: '100%' }}>
		
		<Router history={history}>
			<Switch>
				{allRoutes.filter(route => route.visible).map((route, index) => {
					return  (
						<Route
							exact={route.exact}
							path={route.path}
							key={index}
							component={(route.component)}
						/>
					)
				})}
				<Route
					path={'/:404_path'}
					key={'404'}
					component={NotFound}
				/>
				<Redirect to="/login" />
			</Switch>
		</Router>
		<BackboneModals />
	</div>
);

App.displayName = 'App';

function mapStateToProps(state) {
	return state.login;
}

export default connect(mapStateToProps)(App);
