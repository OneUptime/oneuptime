import React from 'react';
import PropTypes from 'prop-types'
import { connect } from 'react-redux';

/**
 * @function Modalize
 * @param {React.Props} props Props comprise an object with 3 JSX values for `HEADER`, `CONTENT` & `FOOTER`
 * @returns {JSX.Element} A modal and a child component.
*/
export function Modalize({ HEADER, CONTENT, FOOTER }) {
    
    return HEADER && CONTENT && FOOTER ? (

        <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">

            <div className="ModalLayer-contents" tabIndex="-1" style={{marginTop: 105}}>

                <div className="bs-BIM">

                    <form>
                        <div className="bs-Modal bs-Modal--medium">

                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    {HEADER}
                                </div>
                                <div className="bs-Modal-messages"></div>
                            </div>

                            <div className="bs-Modal-content">
                                {CONTENT}
                            </div>

                            <div className="bs-Modal-footer">
                                {FOOTER}
                            </div>

                        </div>
                    </form> 

                </div>

            </div>

        </div>
        
    )   :   null;
}

const mapStateToProps = state => ({
    HEADER: state.modal.header,
    CONTENT: state.modal.content,
    FOOTER: state.modal.footer
})

Modalize.propTypes = {
    HEADER: PropTypes.string.isRequired,
    CONTENT: PropTypes.string.isRequired,
    FOOTER: PropTypes.string.isRequired
}

Modalize.displayName = 'Modalize'

export default connect(mapStateToProps)(Modalize);