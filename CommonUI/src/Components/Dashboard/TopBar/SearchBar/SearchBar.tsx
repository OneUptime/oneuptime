import React, { FunctionComponent, ReactElement } from 'react';
import './SearchBar.scss';
import { faSearch, faSlash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

const SearchBar: FunctionComponent = (): ReactElement => {
    return (
        <div className="top-search">
            <FontAwesomeIcon icon={faSearch} />
            <input type="text" placeholder="Search..." />
            <i className="aside">
                <FontAwesomeIcon icon={faSlash} />
            </i>
        </div>
    );
};

export default SearchBar;
