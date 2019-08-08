import React from 'react';
import { Router, Route, Redirect, Switch } from 'react-router-dom';
import { history, isServer } from './store';
import { connect } from 'react-redux';
import { allRoutes } from './routes';
import NotFound from './components/404';
import BackboneModals from './containers/BackboneModals';
import ReactGA from 'react-ga';
import { User, ACCOUNTS_URL, DOMAIN_URL } from './config';
import Cookies from 'universal-cookie';
import 'font-awesome/css/font-awesome.min.css';

if (!isServer) {
	history.listen(location => {
		ReactGA.set({ page: location.pathname });
		ReactGA.pageview(location.pathname);
	});
}

var cookies = new Cookies();

var userData = cookies.get('admin-data');
if (userData !== undefined){
	User.setUserId(userData.id);
	User.setAccessToken(userData.tokens.jwtAccessToken);
	User.setEmail(userData.email);
	User.setName(userData.name);
}
cookies.remove('admin-data', {domain: DOMAIN_URL });

if (!User.isLoggedIn()){
	window.location = ACCOUNTS_URL;
}

const App = () => (
	<div style={{ height: '100%' }}>
		<Router history={history}>
			<Switch>
			{allRoutes.filter(route => route.visible).map((route, index) => {
					return  (
						<Route
							exact
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
				<Redirect to="/users" />
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
