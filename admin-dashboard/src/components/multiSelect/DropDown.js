import React from 'react';
import PropTypes from 'prop-types';
import LoadingIndicator from './LoadingIndicator';

class Dropdown extends React.Component {
    state = {
        hasFocus: false,
        expanded: false
    }

    UNSAFE_componentWillUpdate() {
        document.addEventListener('touchstart', this.handleDocumentClick);
        document.addEventListener('mousedown', this.handleDocumentClick);
    }

    UNSAFE_componentWillMount() {
        document.addEventListener('touchstart', this.handleDocumentClick);
        document.addEventListener('mousedown', this.handleDocumentClick);
    }

    handleDocumentClick = e => {

        if(this.wrapper && this.wrapper.contains(e.target)){
            this.setState({expanded: false});
        }
    }

    handleKeyDown = e => {
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
    }
    
    toggleExpanded = value => {
        const { isLoading } = this.props;
        const { expanded } = this.state;

        if(isLoading){
            return;
        }

        const tempExpanded = value === undefined ? !expanded : !!value;

        this.setState({expanded: tempExpanded});

        if(!tempExpanded && this.wrapper) {
            this.wrapper.focus();
        }
    }

    handleBlur = () => {
        const { hasFocus } = this.state;

        if(hasFocus) {
            this.setState({ hasFocus: false });
        }
    }

    handleFocus = e => {
        const { hasFocus } = this.state;

        if(e.target === this.wrapper && !hasFocus) {
            this.setState({ hasFocus: true });
        }
    }

    handleMouseEnter = () => {
        this.handleHover(true);
    }

    handleMouseLeave = () => {
        this.handleHover(false)
    }
    
    handleHover = toggleExpanded => {
        const { shouldToggleOnHover } = this.props;

        if(shouldToggleOnHover) {
            this.toggleExpanded(toggleExpanded)
        }
    }

    renderPanel = () => {
        const { ContentComponent, contentProps } = this.props;

        return <div className="db-MultiSelect-dropdown-content db-MultiSelect-panel-container">
            <ContentComponent {...contentProps} />
        </div>
    }

    render() {

        const { expanded, hasFocus } = this.state;
        const { children, isLoading, disabled } = this.props;

        return (
            <div
                className="dropdown db-MultiSelect-dropdown-container"
                tabIndex="0"
                role="combobox"
                aria-expanded={expanded}
                aria-readonly="true"
                aria-disabled={disabled}
                ref={ref => this.wrapper = ref }
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
                        ${expanded && 'db-MultiSelect-dropdown-header--expanded'}
                    `}
                    onClick={() => this.toggleExpanded()}
                >
                    <span
                        className={`
                            db-MultiSelect-dropdown-heading--value
                            db-MultiSelect-dropdown-children
                            ${hasFocus && 'db-MultiSelect-dropdown-header--focused'}
                        `}
                    >
                        {children}
                    </span>

                    <span
                        className={'db-MultiSelect-dropdown-heading-lc'}
                    >
                        {isLoading && <LoadingIndicator />}
                    </span>

                    <span
                        className={'db-MultiSelect-dropdown-heading-arrow db-MultiSelect-dropdown-arrow'}
                    >
                        <span
                            className={`
                                ${expanded ? 'db-MultiSelect-dropdown-arrow--up' : 'db-MultiSelect-dropdown-arrow--down'}
                                ${hasFocus && 'db-MultiSelect-dropdown-arrow-down--focused'}
                            `}
                        />
                    </span>

                </div>
                {expanded && this.renderPanel()}
            </div>
        );
    }
}

Dropdown.displayName = 'Dropdown';

Dropdown.propTypes = {
    children: PropTypes.object,
    disabled: PropTypes.bool,
    isLoading: PropTypes.bool,
    shouldToggleOnHover: PropTypes.bool,
    ContentComponent: PropTypes.element.isRequired,
    contentProps: PropTypes.object.isRequired
}

export default Dropdown;