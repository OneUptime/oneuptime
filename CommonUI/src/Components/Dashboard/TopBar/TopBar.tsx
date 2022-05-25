import React, { ReactElement } from 'react';
import Account from '../Account/Account';
import CurrentProject from '../ProjectPicker/CurrentProject';
import SearchBar from './SearchBar/SearchBar';
import './TopBar.scss';

const TopBar = (): ReactElement => {
    return (
        <div className="root">
            <header>
                <CurrentProject />
                <SearchBar />
                <div>
                    <div>Create</div>
                    <div>Help</div>
                    <div>Notifications</div>
                    <div>Settings</div>
                    <Account />
                </div>
            </header>
            <nav></nav>
        </div>
    );
};

export default TopBar;
