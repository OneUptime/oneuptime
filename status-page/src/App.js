import React from 'react';
import './App.css';
import Main from './components/Main';
import ScheduledEvent from './components/ScheduledEvent';
import Incident from './components/Incident';
import Socket from './components/basic/Socket';
import {
    BrowserRouter as Router,
    Route,
    Switch,
    Redirect,
} from 'react-router-dom';
import { User } from './config';
import queryString from 'query-string';
import { removeQuery } from './store/store';
import SingleAnnouncement from './components/SingleAnnouncement';

const userId = queryString.parse(window.location.search).userId;
const accessToken = queryString.parse(window.location.search).accessToken;

if (userId && accessToken) {
    User.setUserId(userId);
    User.setAccessToken(accessToken);
    removeQuery();
}

const App = () => (
    <>
        <Socket />
        <Router>
            <Switch>
                <Route exact path="/" component={Main} />
                <Route exact path="/status-page" component={Main} />
                <Route
                    exact
                    path="/status-page/:statusPageSlug"
                    component={Main}
                />
                <Route
                    exact
                    path="/status-page/:statusPageSlug/scheduledEvent/:eventId"
                    component={ScheduledEvent}
                />
                <Route
                    exact
                    path="/status-page/:statusPageSlug/incident/:incidentId"
                    component={Incident}
                />
                <Route
                    exact
                    path="/status-page/:statusPageSlug/announcement/:announcementSlug"
                    component={SingleAnnouncement}
                />
                <Redirect to="/" />
            </Switch>
        </Router>
    </>
);

App.displayName = 'App';

export default App;
