import React, { Component } from 'react';
import PropTypes from 'prop-types';

import setInTransition from './setInTransition';

class Collapsible extends Component {
    innerRef: $TSFixMe;
    timeout: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);

        this.timeout = undefined;

        // Defaults the dropdown to be closed
        if (props.open) {
            this.state = {
                isClosed: false,
                shouldSwitchAutoOnNextCycle: false,
                height: 'auto',
                transition: 'none',
                hasBeenOpened: true,
                overflow: props.overflowWhenOpen,
                inTransition: false,
            };
        } else {
            this.state = {
                isClosed: true,
                shouldSwitchAutoOnNextCycle: false,
                height: 0,
                transition: `height ${props.transitionTime}ms ${props.easing}`,
                hasBeenOpened: false,
                overflow: 'hidden',
                inTransition: false,
            };
        }
    }

    componentDidUpdate(prevProps: $TSFixMe, prevState: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'shouldOpenOnNextCycle' does not exist on... Remove this comment to see the full error message
        if (this.state.shouldOpenOnNextCycle) {
            this.continueOpenCollapsible();
        }

        if (
            (prevState.height === 'auto' || prevState.height === 0) &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'shouldSwitchAutoOnNextCycle' does not ex... Remove this comment to see the full error message
            this.state.shouldSwitchAutoOnNextCycle === true
        ) {
            window.clearTimeout(this.timeout);
            this.timeout = window.setTimeout(() => {
                // Set small timeout to ensure a true re-render
                this.setState({
                    height: 0,
                    overflow: 'hidden',
                    isClosed: true,
                    shouldSwitchAutoOnNextCycle: false,
                });
            }, 50);
        }

        // If there has been a change in the open prop (controlled by accordion)
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'open' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        if (prevProps.open !== this.props.open) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'open' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            if (this.props.open === true) {
                this.openCollapsible();
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'onOpening' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.onOpening();
            } else {
                this.closeCollapsible();
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'onClosing' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.onClosing();
            }
        }
    }

    componentWillUnmount() {
        window.clearTimeout(this.timeout);
    }

    closeCollapsible() {
        const { innerRef } = this;

        this.setState({
            shouldSwitchAutoOnNextCycle: true,
            height: innerRef.scrollHeight,
            transition: `height ${
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'transitionCloseTime' does not exist on t... Remove this comment to see the full error message
                this.props.transitionCloseTime
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'transitionCloseTime' does not exist on t... Remove this comment to see the full error message
                    ? this.props.transitionCloseTime
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'transitionTime' does not exist on type '... Remove this comment to see the full error message
                    : this.props.transitionTime
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'easing' does not exist on type 'Readonly... Remove this comment to see the full error message
            }ms ${this.props.easing}`,
            inTransition: setInTransition(innerRef.scrollHeight),
        });
    }

    openCollapsible() {
        this.setState({
            inTransition: setInTransition(this.innerRef.scrollHeight),
            shouldOpenOnNextCycle: true,
        });
    }

    continueOpenCollapsible = () => {
        const { innerRef } = this;

        this.setState({
            height: innerRef.scrollHeight,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'transitionTime' does not exist on type '... Remove this comment to see the full error message
            transition: `height ${this.props.transitionTime}ms ${this.props.easing}`,
            isClosed: false,
            hasBeenOpened: true,
            inTransition: setInTransition(innerRef.scrollHeight),
            shouldOpenOnNextCycle: false,
        });
    };

    handleTriggerClick = (event: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerDisabled' does not exist on type ... Remove this comment to see the full error message
        if (this.props.triggerDisabled || this.state.inTransition) {
            return;
        }

        event.preventDefault();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleTriggerClick' does not exist on ty... Remove this comment to see the full error message
        if (this.props.handleTriggerClick) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleTriggerClick' does not exist on ty... Remove this comment to see the full error message
            this.props.handleTriggerClick(this.props.accordionPosition);
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isClosed' does not exist on type 'Readon... Remove this comment to see the full error message
            if (this.state.isClosed === true) {
                this.openCollapsible();
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'onOpening' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.onOpening();
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'onTriggerOpening' does not exist on type... Remove this comment to see the full error message
                this.props.onTriggerOpening();
            } else {
                this.closeCollapsible();
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'onClosing' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.onClosing();
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'onTriggerClosing' does not exist on type... Remove this comment to see the full error message
                this.props.onTriggerClosing();
            }
        }
    };

    renderNonClickableTriggerElement() {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerSibling' does not exist on type '... Remove this comment to see the full error message
            this.props.triggerSibling &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerSibling' does not exist on type '... Remove this comment to see the full error message
            typeof this.props.triggerSibling === 'string'
        ) {
            return (
                <span
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'classParentString' does not exist on typ... Remove this comment to see the full error message
                    className={`${this.props.classParentString}__trigger-sibling`}
                >
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerSibling' does not exist on type '... Remove this comment to see the full error message
                    {this.props.triggerSibling}
                </span>
            );
        } else if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerSibling' does not exist on type '... Remove this comment to see the full error message
            this.props.triggerSibling &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerSibling' does not exist on type '... Remove this comment to see the full error message
            typeof this.props.triggerSibling === 'function'
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerSibling' does not exist on type '... Remove this comment to see the full error message
            return this.props.triggerSibling();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerSibling' does not exist on type '... Remove this comment to see the full error message
        } else if (this.props.triggerSibling) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerSibling' does not exist on type '... Remove this comment to see the full error message
            return <this.props.triggerSibling />;
        }
        return null;
    }

    handleTransitionEnd = (e: $TSFixMe) => {
        // only handle transitions that origin from the container of this component
        if (e.target !== this.innerRef) {
            return;
        }
        // Switch to height auto to make the container responsive
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isClosed' does not exist on type 'Readon... Remove this comment to see the full error message
        if (!this.state.isClosed) {
            this.setState({
                height: 'auto',
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'overflowWhenOpen' does not exist on type... Remove this comment to see the full error message
                overflow: this.props.overflowWhenOpen,
                inTransition: false,
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'onOpen' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.onOpen();
        } else {
            this.setState({ inTransition: false });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'onClose' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.onClose();
        }
    };

    setInnerRef = (ref: $TSFixMe) => this.innerRef = ref;

    render() {
        const dropdownStyle = {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'height' does not exist on type 'Readonly... Remove this comment to see the full error message
            height: this.state.height,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'transition' does not exist on type 'Read... Remove this comment to see the full error message
            WebkitTransition: this.state.transition,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'transition' does not exist on type 'Read... Remove this comment to see the full error message
            msTransition: this.state.transition,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'transition' does not exist on type 'Read... Remove this comment to see the full error message
            transition: this.state.transition,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'overflow' does not exist on type 'Readon... Remove this comment to see the full error message
            overflow: this.state.overflow,
            margin: '0 35px',
        };

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isClosed' does not exist on type 'Readon... Remove this comment to see the full error message
        const openClass = this.state.isClosed ? 'is-closed' : 'is-open';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerDisabled' does not exist on type ... Remove this comment to see the full error message
        const disabledClass = this.props.triggerDisabled ? 'is-disabled' : '';

        //If user wants different text when tray is open
        const trigger =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isClosed' does not exist on type 'Readon... Remove this comment to see the full error message
            this.state.isClosed === false &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerWhenOpen' does not exist on type ... Remove this comment to see the full error message
            this.props.triggerWhenOpen !== undefined
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerWhenOpen' does not exist on type ... Remove this comment to see the full error message
                ? this.props.triggerWhenOpen
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'trigger' does not exist on type 'Readonl... Remove this comment to see the full error message
                : this.props.trigger;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'contentContainerTagName' does not exist ... Remove this comment to see the full error message
        const ContentContainerElement = this.props.contentContainerTagName;

        // If user wants a trigger wrapping element different than 'span'
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerTagName' does not exist on type '... Remove this comment to see the full error message
        const TriggerElement = this.props.triggerTagName;

        // Don't render children until the first opening of the Collapsible if lazy rendering is enabled
        const children =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'lazyRender' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.lazyRender &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'hasBeenOpened' does not exist on type 'R... Remove this comment to see the full error message
            !this.state.hasBeenOpened &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isClosed' does not exist on type 'Readon... Remove this comment to see the full error message
            this.state.isClosed &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'inTransition' does not exist on type 'Re... Remove this comment to see the full error message
            !this.state.inTransition
                ? null
                : this.props.children;

        // Construct CSS classes strings
        const triggerClassString = `${
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'classParentString' does not exist on typ... Remove this comment to see the full error message
            this.props.classParentString
        }__trigger ${openClass} ${disabledClass} ${
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isClosed' does not exist on type 'Readon... Remove this comment to see the full error message
            this.state.isClosed
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerClassName' does not exist on type... Remove this comment to see the full error message
                ? this.props.triggerClassName
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerOpenedClassName' does not exist o... Remove this comment to see the full error message
                : this.props.triggerOpenedClassName
        }`;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'classParentString' does not exist on typ... Remove this comment to see the full error message
        const parentClassString = `${this.props.classParentString} ${
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isClosed' does not exist on type 'Readon... Remove this comment to see the full error message
            this.state.isClosed
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'className' does not exist on type 'Reado... Remove this comment to see the full error message
                ? this.props.className
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'openedClassName' does not exist on type ... Remove this comment to see the full error message
                : this.props.openedClassName
        }`;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'classParentString' does not exist on typ... Remove this comment to see the full error message
        const outerClassString = `${this.props.classParentString}__contentOuter ${this.props.contentOuterClassName}`;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'classParentString' does not exist on typ... Remove this comment to see the full error message
        const innerClassString = `${this.props.classParentString}__contentInner ${this.props.contentInnerClassName}`;

        return (
            <ContentContainerElement
                style={{ cursor: 'pointer' }}
                className={parentClassString.trim()}
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerElementProps' does not exist on... Remove this comment to see the full error message
                {...this.props.containerElementProps}
            >
                <TriggerElement
                    className={triggerClassString.trim()}
                    onClick={this.handleTriggerClick}
                    style={
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isClosed' does not exist on type 'Readon... Remove this comment to see the full error message
                        !this.state.isClosed
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerStyle' does not exist on type 'Re... Remove this comment to see the full error message
                            ? { ...this.props.triggerStyle, marginBottom: 25 }
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerStyle' does not exist on type 'Re... Remove this comment to see the full error message
                            : this.props.triggerStyle
                    }
                    onKeyPress={(event: $TSFixMe) => {
                        const { key } = event;
                        if (
                            (key === ' ' &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerTagName' does not exist on type '... Remove this comment to see the full error message
                                this.props.triggerTagName.toLowerCase() !==
                                    'button') ||
                            key === 'Enter'
                        ) {
                            this.handleTriggerClick(event);
                        }
                    }}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'tabIndex' does not exist on type 'Readon... Remove this comment to see the full error message
                    tabIndex={this.props.tabIndex && this.props.tabIndex}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerElementProps' does not exist on t... Remove this comment to see the full error message
                    {...this.props.triggerElementProps}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}
                    >
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusColorStyle' does not exist on type... Remove this comment to see the full error message
                        <div style={this.props.statusColorStyle}></div>
                        {trigger}
                    </div>

                    <div>
                        <div
                            className={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'isClosed' does not exist on type 'Readon... Remove this comment to see the full error message
                                this.state.isClosed
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closedIconClass' does not exist on type ... Remove this comment to see the full error message
                                    ? this.props.closedIconClass
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openIconClass' does not exist on type 'R... Remove this comment to see the full error message
                                    : this.props.openIconClass
                            }
                            style={{ marginRight: '5px ' }}
                        />
                    </div>
                </TriggerElement>

                {this.renderNonClickableTriggerElement()}

                <div
                    className={outerClassString.trim()}
                    style={dropdownStyle}
                    onTransitionEnd={this.handleTransitionEnd}
                    ref={this.setInnerRef}
                    hidden={
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'contentHiddenWhenClosed' does not exist ... Remove this comment to see the full error message
                        this.props.contentHiddenWhenClosed &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isClosed' does not exist on type 'Readon... Remove this comment to see the full error message
                        this.state.isClosed &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'inTransition' does not exist on type 'Re... Remove this comment to see the full error message
                        !this.state.inTransition
                    }
                >
                    <div className={innerClassString.trim()}>{children}</div>
                </div>
            </ContentContainerElement>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Collapsible.propTypes = {
    transitionTime: PropTypes.number,
    transitionCloseTime: PropTypes.number,
    triggerTagName: PropTypes.string,
    easing: PropTypes.string,
    open: PropTypes.bool,
    containerElementProps: PropTypes.object,
    triggerElementProps: PropTypes.object,
    classParentString: PropTypes.string,
    openedClassName: PropTypes.string,
    triggerStyle: PropTypes.object,
    statusColorStyle: PropTypes.object,
    triggerClassName: PropTypes.string,
    triggerOpenedClassName: PropTypes.string,
    contentOuterClassName: PropTypes.string,
    contentInnerClassName: PropTypes.string,
    accordionPosition: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.number,
    ]),
    handleTriggerClick: PropTypes.func,
    onOpen: PropTypes.func,
    onClose: PropTypes.func,
    onOpening: PropTypes.func,
    onClosing: PropTypes.func,
    onTriggerOpening: PropTypes.func,
    onTriggerClosing: PropTypes.func,
    trigger: PropTypes.oneOfType([PropTypes.string, PropTypes.element]),
    triggerWhenOpen: PropTypes.oneOfType([PropTypes.string, PropTypes.element]),
    triggerDisabled: PropTypes.bool,
    lazyRender: PropTypes.bool,
    overflowWhenOpen: PropTypes.oneOf([
        'hidden',
        'visible',
        'auto',
        'scroll',
        'inherit',
        'initial',
        'unset',
    ]),
    contentHiddenWhenClosed: PropTypes.bool,
    className: PropTypes.string,
    children: PropTypes.object,
    triggerSibling: PropTypes.oneOfType([PropTypes.element, PropTypes.func]),
    tabIndex: PropTypes.number,
    contentContainerTagName: PropTypes.string,
    closedIconClass: PropTypes.string,
    openIconClass: PropTypes.string,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'defaultProps' does not exist on type 'ty... Remove this comment to see the full error message
Collapsible.defaultProps = {
    transitionTime: 400,
    transitionCloseTime: null,
    triggerTagName: 'span',
    easing: 'linear',
    open: false,
    classParentString: 'Collapsible',
    triggerDisabled: false,
    lazyRender: false,
    overflowWhenOpen: 'hidden',
    contentHiddenWhenClosed: false,
    openedClassName: '',
    triggerStyle: null,
    triggerClassName: '',
    triggerOpenedClassName: '',
    contentOuterClassName: '',
    contentInnerClassName: '',
    className: '',
    triggerSibling: null,
    onOpen: () => {},
    onClose: () => {},
    onOpening: () => {},
    onClosing: () => {},
    onTriggerOpening: () => {},
    onTriggerClosing: () => {},
    tabIndex: null,
    contentContainerTagName: 'div',
    closedIconClass: '',
    openIconClass: '',
    statusColorStyle: {},
};

export default Collapsible;
