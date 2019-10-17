import React from 'react';
import { Router, Route, Redirect, Switch } from 'react-router-dom';
import store, { history, isServer } from './store';
import { connect } from 'react-redux';
import { allRoutes } from './routes';
import NotFound from './components/404';
import './components/Dashboard';
import BackboneModals from './containers/BackboneModals';
import Socket from './components/basic/Socket';
import ReactGA from 'react-ga';
import { User, ACCOUNTS_URL, DOMAIN_URL } from './config';
import Cookies from 'universal-cookie';
import 'font-awesome/css/font-awesome.min.css';
import { loadPage } from './actions/page';

if (!isServer) {
	history.listen(location => {
		ReactGA.set({ page: location.pathname });
		ReactGA.pageview(location.pathname);
	});
}

var cookies = new Cookies();

var userData = cookies.get('data');
if (userData !== undefined) {
	User.setUserId(userData.id);
	User.setAccessToken(userData.tokens.jwtAccessToken);
	User.setEmail(userData.email);
	User.setName(userData.name);
	User.setCardRegistered(userData.cardRegistered);
}
cookies.remove('data', { domain: DOMAIN_URL });

if (!User.isLoggedIn()) {
	window.location = ACCOUNTS_URL;
	store.dispatch(loadPage('Home'));
}

const App = () => (
	<div style={{ height: '100%' }}>
		<Socket />
		<Router history={history}>
			<Switch>
				{allRoutes.filter(route => route.visible).map((route, index) => {
					return (
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
				<Redirect to="/project/project/monitoring" />
			</Switch>
		</Router>
		<BackboneModals />
	</div>
);

App.displayName = 'App'

function mapStateToProps(state) {
	return state.login;
}

export default connect(mapStateToProps)(App);
