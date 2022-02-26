import React, { Component } from 'react';
import PropTypes from 'prop-types';

class Footer extends Component {
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'link' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { link } = this.props;
        if (!link.url) return null;
        return (
            <li>
                <a
                    rel="noopener noreferrer"
                    target="_blank"
                    href={link.url}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'textColor' does not exist on type 'Reado... Remove this comment to see the full error message
                    style={this.props.textColor}
                >
                    {link.name}
                </a>
            </li>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Footer.displayName = 'Footer';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Footer.propTypes = {
    link: PropTypes.object,
    textColor: PropTypes.object,
};

export default Footer;
