import React, { Component } from 'react';

/**
 * Component that alerts if you click outside of it
 */

export default (ComposedComponent, extras) => {
    class OutsideCkick extends Component {
        constructor(props) {
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
        setWrapperRef(node) {
            this.wrapperRef = node;
        }

        /**
         * Alert if clicked on outside of element
         */
        handleClickOutside = event => {
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

    OutsideCkick.displayName = 'PublicPage';

    return OutsideCkick;
};
