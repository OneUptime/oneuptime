import React from 'react';
import { Route, Redirect, Switch } from 'react-router-dom';
import routes from '../routes';

const { allRoutes } = routes;

const PublicPage = () => (
	<Switch>
		{allRoutes
			.filter(route => route.isPublic)
			.map((route, index) => (
				<Route
					component={route.component}
					exact={route.exact}
					path={route.path}
					key={index}
				/>
			))}
			<Redirect to='/login' />
	</Switch>
);

PublicPage.displayName = 'PublicPage'

export default PublicPage;
