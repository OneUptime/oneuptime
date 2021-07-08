import React, { Suspense, lazy } from 'react';
import './App.css';
const Main = lazy(() => import('./components/Main'));
const ScheduledEvent = lazy(() => import('./components/ScheduledEvent'));
const Incident = lazy(() => import('./components/Incident'));
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
const SingleAnnouncement = lazy(() =>
    import('./components/SingleAnnouncement')
);
import { LoadingState } from './components/basic/Loader';

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
            <Suspense fallback={<LoadingState />}>
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
            </Suspense>
        </Router>
    </>
);

App.displayName = 'App';

export default App;
