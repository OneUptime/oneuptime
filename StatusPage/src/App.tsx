import React, { Suspense, lazy } from 'react';
import './App.css';
import Socket from './components/basic/Socket';
import {
    BrowserRouter as Router,
    Route,
    Switch,
    Redirect,

} from 'react-router-dom';
import { User } from './config';
import queryString from 'query-string';
import { removeQuery } from './store';
const Main = lazy((): $TSFixMe => import('./components/Main'));
const ScheduledEvent = lazy((): $TSFixMe => import('./components/ScheduledEvent'));
const Incident = lazy((): $TSFixMe => import('./components/Incident'));
const SingleAnnouncement = lazy((): $TSFixMe =>
    import('./components/SingleAnnouncement')
);

const userId: $TSFixMe = queryString.parse(window.location.search).userId;
const accessToken: $TSFixMe = queryString.parse(window.location.search).accessToken;

if (userId && accessToken) {
    User.setUserId(userId);
    User.setAccessToken(accessToken);
    removeQuery();
}

const AppLoader: Function = () => (
    <div
        id="app-loading"
        style={{
            position: 'fixed',
            top: '0',
            bottom: '0',
            left: '0',
            right: '0',
            zIndex: '999',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
        }}
    >
        <div style={{ transform: 'scale(2)' }}>
            <svg
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                className="bs-Spinner-svg"
            >
                <ellipse
                    cx="12"
                    cy="12"
                    rx="10"
                    ry="10"
                    className="bs-Spinner-ellipse"
                ></ellipse>
            </svg>
        </div>
    </div>
);

const App: Function = () => {
    return (
        <>
            <Socket />
            <Router>
                <Suspense fallback={<AppLoader />}>
                    <Switch>
                        <Route exact path="/" component={Main} />
                        <Route exact path="/StatusPage" component={Main} />
                        <Route
                            exact
                            path="/StatusPage/:statusPageSlug"
                            component={Main}
                        />
                        <Route
                            exact
                            path="/StatusPage/:statusPageSlug/scheduledEvent/:eventId"
                            component={ScheduledEvent}
                        />
                        <Route
                            exact
                            path="/StatusPage/:statusPageSlug/incident/:incidentSlug"
                            component={Incident}
                        />
                        <Route
                            exact
                            path="/StatusPage/:statusPageSlug/announcement/:announcementSlug"
                            component={SingleAnnouncement}
                        />
                        <Redirect to="/" />
                    </Switch>
                </Suspense>
            </Router>
        </>
    );
};

App.displayName = 'App';

export default App;
