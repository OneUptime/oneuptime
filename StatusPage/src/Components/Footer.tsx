import React, { Component } from 'react';
import PropTypes from 'prop-types';

export interface ComponentProps {
    link?: object;
    textColor?: object;
}

class Footer extends Component<ComponentProps> {
    override render() {
        const { link }: $TSFixMe = this.props;
        if (!link.url) {
            return null;
        }
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
