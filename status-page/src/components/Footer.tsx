import React, { Component } from 'react';
import PropTypes from 'prop-types';

class Footer extends Component {
    render() {
        const { link } = this.props;
        if (!link.url) return null;
        return (
            <li>
                <a
                    rel="noopener noreferrer"
                    target="_blank"
                    href={link.url}
                    style={this.props.textColor}
                >
                    {link.name}
                </a>
            </li>
        );
    }
}

Footer.displayName = 'Footer';

Footer.propTypes = {
    link: PropTypes.object,
    textColor: PropTypes.object,
};

export default Footer;
