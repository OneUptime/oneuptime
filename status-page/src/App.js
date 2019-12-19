import React from 'react';
import './App.css';
import Main from './components/Main';
import { BrowserRouter as Router, Route, Switch,Redirect } from 'react-router-dom';
import { User } from './config';
import queryString from 'query-string';
import { removeQuery } from './store/store';

const userId = queryString.parse(window.location.search).userId;
const accessToken = queryString.parse(window.location.search).accessToken;

if (userId && accessToken){
	User.setUserId(userId);
    User.setAccessToken(accessToken);
    removeQuery();
}

const App = () => (
    <Router>
        <Switch>
            <Route exact path="/" component={Main} />
            <Redirect to="/" />
        </Switch>
    </Router>
)


App.displayName = 'App'

export default App;