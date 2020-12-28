// import React, { Component } from 'react';
// import PropTypes from 'prop-types';
// import { connect } from 'react-redux';
// import ShouldRender from '../basic/ShouldRender';
// import ReactJson from 'react-json-view';

// class EmailLogsJsonViewModal extends Component {
//     componentDidMount() {
//         window.addEventListener('keydown', this.handleKeyboard);
//     }

//     componentWillUnmount() {
//         window.removeEventListener('keydown', this.handleKeyboard);
//     }

//     handleKeyboard = e => {
//         switch (e.key) {
//             case 'Escape':
//                 return this.props.closeThisDialog();
//             default:
//                 return false;
//         }
//     };

//     render() {
//         const {
//             isRequesting,
//             error,
//             closeThisDialog,
//             reqLog,
//             resLog,
//         } = this.props;

//         return (
//             <div className="db-EmailLogsJsonViewModal ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
//                 <div
//                     className="ModalLayer-contents"
//                     tabIndex={-1}
//                     style={{ marginTop: 40 }}
//                 >
//                     <div className="bs-BIM">
//                         <div className="bs-Modal bs-Modal--medium">
//                             <div className="bs-Modal-header">
//                                 <div className="bs-Modal-header-copy">
//                                     <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
//                                         <span>API Request and Response</span>
//                                     </span>
//                                 </div>
//                             </div>
//                             <div className="bs-Modal-content">
//                                 <div className="jsonViwer Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
//                                     <div className="db-EmailLogsJsonViewModal-JsonViewerWrapper">
//                                         <div className="db-EmailLogsJsonViewModal-JsonViewerContainer">
//                                             <div className="Text-fontWeight--medium">
//                                                 Request
//                                             </div>
//                                             <div className="db-EmailLogsJsonViewModal-JsonViewer">
//                                                 <ReactJson
//                                                     src={reqLog}
//                                                     name="Request"
//                                                     enableClipboard={false}
//                                                     displayObjectSize={false}
//                                                     displayDataTypes={false}
//                                                     indentWidth={2}
//                                                     collapsed={1}
//                                                     style={{
//                                                         fontSize: '12px',
//                                                     }}
//                                                 />
//                                             </div>
//                                         </div>
//                                         <div className="EmailLogsJsonViewModal-JsonViewerContainer">
//                                             <div className="Text-fontWeight--medium">
//                                                 Response
//                                             </div>
//                                             <div className="db-EmailLogsJsonViewModal-JsonViewer">
//                                                 <ReactJson
//                                                     src={resLog}
//                                                     name="Response"
//                                                     enableClipboard={false}
//                                                     displayObjectSize={false}
//                                                     displayDataTypes={false}
//                                                     indentWidth={2}
//                                                     collapsed={1}
//                                                     style={{
//                                                         fontSize: '12px',
//                                                     }}
//                                                 />
//                                             </div>
//                                         </div>
//                                     </div>
//                                 </div>
//                             </div>
//                             <div className="bs-Modal-footer">
//                                 <div className="bs-Modal-footer-actions">
//                                     <ShouldRender if={error}>
//                                         <div className="bs-Tail-copy">
//                                             <div
//                                                 className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
//                                                 style={{ marginTop: '10px' }}
//                                             >
//                                                 <div className="Box-root Margin-right--8">
//                                                     <div
//                                                         className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"
//                                                         style={{
//                                                             marginTop: '2px',
//                                                         }}
//                                                     ></div>
//                                                 </div>
//                                                 <div className="Box-root">
//                                                     <span
//                                                         style={{ color: 'red' }}
//                                                     >
//                                                         {error}
//                                                     </span>
//                                                 </div>
//                                             </div>
//                                         </div>
//                                     </ShouldRender>
//                                     <button
//                                         className={`bs-Button btn__modal ${isRequesting &&
//                                             'bs-is-disabled'}`}
//                                         type="button"
//                                         onClick={closeThisDialog}
//                                         disabled={isRequesting}
//                                         autoFocus={true}
//                                     >
//                                         <span>Close</span>
//                                         <span className="cancel-btn__keycode">
//                                             Esc
//                                         </span>
//                                     </button>
//                                 </div>
//                             </div>
//                         </div>
//                     </div>
//                 </div>
//             </div>
//         );
//     }
// }

// EmailLogsJsonViewModal.displayName = 'EmailLogsJsonViewModal';

// const mapStateToProps = state => {
//     return {
//         isRequesting:
//             state.emailLogs &&
//             state.emailLogs.emailLogs &&
//             state.emailLogs.emailLogs.requesting,
//         error:
//             state.emailLogs &&
//             state.emailLogs.emailLogs &&
//             state.emailLogs.emailLogs.error,
//     };
// };

// EmailLogsJsonViewModal.propTypes = {
//     isRequesting: PropTypes.oneOfType([
//         PropTypes.bool,
//         PropTypes.oneOf([null, undefined]),
//     ]),
//     closeThisDialog: PropTypes.func,
//     error: PropTypes.oneOfType([
//         PropTypes.string,
//         PropTypes.oneOf([null, undefined]),
//     ]),
//     reqLog: PropTypes.object,
//     resLog: PropTypes.object,
// };

// export default connect(mapStateToProps)(EmailLogsJsonViewModal);
