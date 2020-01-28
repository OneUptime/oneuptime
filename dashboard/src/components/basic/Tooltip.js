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
            closeModal
        })
    }

    render() {
        return (
            <div style={{padding:'5px', paddingLeft:'7px', paddingRight:'7px'}}>
                <img src='/assets/img/question.svg' style={{ height: '18px', width: '18px', cursor:'pointer' }} alt="" onClick={this.handleClick} />
            </div>
        );
    }
}

Tooltip.displayName = 'Tooltip'

Tooltip.propTypes = {
    title: PropTypes.string,
    openModal: PropTypes.func, 
    body: PropTypes.string,
    children: PropTypes.object,
}

const mapStateToProps = () => {
    return {

    }
}

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ openModal, closeModal }, dispatch)
}
export default connect(mapStateToProps, mapDispatchToProps)(Tooltip);
