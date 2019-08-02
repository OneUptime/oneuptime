import React from 'react';
import './App.css';
import Main from './components/Main';
import Login from './components/Login';
import { BrowserRouter as Router, Route, Switch,Redirect } from 'react-router-dom';

const App = () => (
    <Router>
        <Switch>
            <Route exact path="/" component={Main} />
            <Route path="/login" component={Login} />
            <Redirect to="/" />
        </Switch>
    </Router>
)


App.displayName = 'App'

export default App;