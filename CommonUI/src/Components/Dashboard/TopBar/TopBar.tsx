import React, { ReactElement } from 'react';
import ProjectView from '../Project/ProjectView';
import SearchBar from './SearchBar/SearchBar';
import './TopBar.scss';

const TopBar = (): ReactElement => {
    return (
        <div className="root">
            <header>
                <ProjectView />
                <SearchBar />
                <div>3</div>
            </header>
            <nav></nav>
        </div>
    );
};

export default TopBar;
