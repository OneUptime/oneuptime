import type { FunctionComponent } from 'react';
import React from 'react';
import { Link } from 'react-router-dom';

const Footer: FunctionComponent = () => {
    return (
        <div className="footer">
            <p>
                <Link to="/">&copy; OneUptime</Link>
            </p>
            <p>
                <Link to="/">Contact</Link>
            </p>
            <p>
                <Link to="/">Privacy &amp; terms</Link>
            </p>
        </div>
    );
};

export default Footer;
