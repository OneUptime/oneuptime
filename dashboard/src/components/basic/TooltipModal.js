import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import Modal from './Modal'

class TooltipModal extends Component {

    render() {
        var {title, body, closeThisDialog} = this.props; 
        return (
            <Modal title={title} closeButtonLabel={"Close"} hideAffirmativeButton={true} closeThisDialog={closeThisDialog}>
                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                    {body}
				</span>
            </Modal>
        );
    }
}

TooltipModal.displayName = 'TooltipModal'

TooltipModal.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    tite: PropTypes.string,
    content: PropTypes.string,
}

const mapStateToProps = state => {
    return {
       
    }
}

const mapDispatchToProps = dispatch => {
    return {};
};

export default connect(mapStateToProps, mapDispatchToProps)(TooltipModal);
