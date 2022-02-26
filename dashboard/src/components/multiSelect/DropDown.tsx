import React from 'react';
import PropTypes from 'prop-types';
import LoadingIndicator from './LoadingIndicator';

class Dropdown extends React.Component {
    wrapper: $TSFixMe;
    state = {
        hasFocus: false,
        expanded: false,
    };

    componentDidUpdate() {
        document.addEventListener('touchstart', this.handleDocumentClick);
        document.addEventListener('mousedown', this.handleDocumentClick);
    }

    componentDidMount() {
        document.addEventListener('touchstart', this.handleDocumentClick);
        document.addEventListener('mousedown', this.handleDocumentClick);
    }

    handleDocumentClick = (e: $TSFixMe) => {
        if (this.wrapper && this.wrapper.contains(e.target)) {
            this.setState({ expanded: false });
        }
    };

    handleKeyDown = (e: $TSFixMe) => {
        switch (e) {
            case 27:
                this.toggleExpanded(false);
                break;
            case 38:
                this.toggleExpanded(false);
                break;
            case 40:
                this.toggleExpanded(true);
                break;
            default:
                return;
        }
    };

    toggleExpanded = (value: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isLoading' does not exist on type 'Reado... Remove this comment to see the full error message
        const { isLoading } = this.props;
        const { expanded } = this.state;

        if (isLoading) {
            return;
        }

        const tempExpanded = value === undefined ? !expanded : !!value;

        this.setState({ expanded: tempExpanded });

        if (!tempExpanded && this.wrapper) {
            this.wrapper.focus();
        }
    };

    handleBlur = () => {
        const { hasFocus } = this.state;

        if (hasFocus) {
            this.setState({ hasFocus: false });
        }
    };

    handleFocus = (e: $TSFixMe) => {
        const { hasFocus } = this.state;

        if (e.target === this.wrapper && !hasFocus) {
            this.setState({ hasFocus: true });
        }
    };

    handleMouseEnter = () => {
        this.handleHover(true);
    };

    handleMouseLeave = () => {
        this.handleHover(false);
    };

    handleHover = (toggleExpanded: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'shouldToggleOnHover' does not exist on t... Remove this comment to see the full error message
        const { shouldToggleOnHover } = this.props;

        if (shouldToggleOnHover) {
            this.toggleExpanded(toggleExpanded);
        }
    };

    renderPanel = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'ContentComponent' does not exist on type... Remove this comment to see the full error message
        const { ContentComponent, contentProps } = this.props;

        return (
            <div className="db-MultiSelect-dropdown-content db-MultiSelect-panel-container">
                <ContentComponent {...contentProps} />
            </div>
        );
    };

    render() {
        const { expanded, hasFocus } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isLoading' does not exist on type 'Reado... Remove this comment to see the full error message
        const { children, isLoading, disabled } = this.props;

        return (
            <div
                className="dropdown db-MultiSelect-dropdown-container"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="0"
                role="combobox"
                aria-expanded={expanded}
                aria-readonly="true"
                aria-disabled={disabled}
                ref={ref => (this.wrapper = ref)}
                onKeyDown={this.handleKeyDown}
                onFocus={this.handleFocus}
                onBlur={this.handleBlur}
                onMouseEnter={this.handleMouseEnter}
                onMouseLeave={this.handleMouseLeave}
            >
                <div
                    className={`
                        db-MultiSelect-dropdown-header
                        ${disabled && 'db-MultiSelect-dropdown--disabled'}
                        ${hasFocus && 'db-MultiSelect-dropdown-header--focused'}
                        ${expanded &&
                            'db-MultiSelect-dropdown-header--expanded'}
                    `}
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
                    onClick={() => this.toggleExpanded()}
                >
                    <span
                        className={`
                            db-MultiSelect-dropdown-heading--value
                            db-MultiSelect-dropdown-children
                            ${hasFocus &&
                                'db-MultiSelect-dropdown-header--focused'}
                        `}
                    >
                        {children}
                    </span>

                    <span className={'db-MultiSelect-dropdown-heading-lc'}>
                        {isLoading && <LoadingIndicator />}
                    </span>

                    <span
                        className={
                            'db-MultiSelect-dropdown-heading-arrow db-MultiSelect-dropdown-arrow'
                        }
                    >
                        <span
                            className={`
                                ${
                                    expanded
                                        ? 'db-MultiSelect-dropdown-arrow--up'
                                        : 'db-MultiSelect-dropdown-arrow--down'
                                }
                                ${hasFocus &&
                                    'db-MultiSelect-dropdown-arrow-down--focused'}
                            `}
                        />
                    </span>
                </div>
                {expanded && this.renderPanel()}
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Dropdown.displayName = 'Dropdown';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Dropdown.propTypes = {
    children: PropTypes.object,
    disabled: PropTypes.bool,
    isLoading: PropTypes.bool,
    shouldToggleOnHover: PropTypes.bool,
    ContentComponent: PropTypes.element.isRequired,
    contentProps: PropTypes.object.isRequired,
};

export default Dropdown;
