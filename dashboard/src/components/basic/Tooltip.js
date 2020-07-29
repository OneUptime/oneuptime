import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { openModal, closeModal } from '../../actions/modal';
import TooltipModal from './TooltipModal';
import { bindActionCreators } from 'redux';

class Tooltip extends Component {
    handleClick = () => {
        this.props.openModal({
            id: 'tooltip_modal',
            content: TooltipModal,
            title: this.props.title,
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

Tooltip.displayName = 'Tooltip';

Tooltip.propTypes = {
    title: PropTypes.string,
    openModal: PropTypes.func,
    body: PropTypes.string,
    children: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
};

const mapStateToProps = () => {
    return {};
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ openModal, closeModal }, dispatch);
};
export default connect(mapStateToProps, mapDispatchToProps)(Tooltip);
