import React, { Component } from 'react';

/**
 * Component that alerts if you click outside of it
 */

export default (ComposedComponent: $TSFixMe, extras: $TSFixMe) => {
    class OutsideCkick extends Component {
        wrapperRef: $TSFixMe;
        constructor(props: $TSFixMe) {
            super(props);

            this.setWrapperRef = this.setWrapperRef.bind(this);
            this.handleClickOutside = this.handleClickOutside.bind(this);
        }

        componentDidMount() {
            document.addEventListener('mousedown', this.handleClickOutside);
        }

        componentWillUnmount() {
            document.removeEventListener('mousedown', this.handleClickOutside);
        }

        /**
         * Set the wrapper ref
         */
        setWrapperRef(node: $TSFixMe) {
            this.wrapperRef = node;
        }

        /**
         * Alert if clicked on outside of element
         */
        handleClickOutside = (event: $TSFixMe) => {
            if (this.wrapperRef && !this.wrapperRef.contains(event.target)) {
                extras.closeModal();
            }
        };

        render() {
            return (
                <div ref={this.setWrapperRef}>
                    {' '}
                    <ComposedComponent {...this.props} />{' '}
                </div>
            );
        }
    }

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
    OutsideCkick.displayName = 'OutsideCkick';

    return OutsideCkick;
};
