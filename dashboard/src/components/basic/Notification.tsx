import React, { Component } from 'react';
import PropTypes from 'prop-types';

export interface ComponentProps {
    message: object;
    id?: string;
    backgroundClass?: string;
    icon?: string;
}

class Notification extends Component<ComponentProps> {
    override render() {
        return (
            <div

                id={this.props.id}
                className={`Box-root Flex-flex Flex-direction--row Flex-alignItems--center ${this.props.backgroundClass

                    ? this.props.backgroundClass
                    : 'Box-background--green'
                    } Text-color--white Border-radius--4 Text-fontWeight--bold Padding-horizontal--20 Padding-vertical--12 pointer Card-shadow--medium bs-mar-cursor`}
            >
                <span
                    className={`db-SideNav-icon ${this.props.icon

                        ? this.props.icon
                        : 'db-SideNav-icon--tick'
                        } db-SideNav-icon--selected`}
                    style={{
                        filter: 'brightness(0) invert(1)',
                        marginTop: '1px',
                        marginRight: '3px',
                    }}
                ></span>

                <span>{this.props.message}</span>
            </div >
        );
    }
}


Notification.displayName = 'Notification';


Notification.propTypes = {
    message: PropTypes.object.isRequired,
    id: PropTypes.string,
    backgroundClass: PropTypes.string,
    icon: PropTypes.string,
};

export default Notification;
