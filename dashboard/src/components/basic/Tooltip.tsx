import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { openModal, closeModal } from '../../actions/modal';
import TooltipModal from './TooltipModal';
import { bindActionCreators } from 'redux';

class Tooltip extends Component {
    handleClick = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            id: 'tooltip_modal',
            content: TooltipModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type 'Readonly<... Remove this comment to see the full error message
            title: this.props.title,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'body' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            body: this.props.body || this.props.children,
            closeModal,
        });
    };

    render() {
        return (
            <div
                style={{
                    padding: '5px',
                    paddingLeft: '7px',
                    paddingRight: '7px',
                }}
            >
                <span
                    className="db-SideNav-icon db-SideNav-icon--question"
                    style={{
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: 'contain',
                        width: '19px',
                        height: '19px',
                        paddingLeft: '10px',
                        paddingRight: '10px',
                        cursor: 'pointer',
                    }}
                    onClick={this.handleClick}
                />
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Tooltip.displayName = 'Tooltip';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Tooltip.propTypes = {
    title: PropTypes.string,
    openModal: PropTypes.func,
    body: PropTypes.string,
    children: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
};

const mapStateToProps = () => {
    return {};
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ openModal, closeModal }, dispatch);
};
export default connect(mapStateToProps, mapDispatchToProps)(Tooltip);
