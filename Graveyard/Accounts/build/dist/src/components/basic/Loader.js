import React from 'react';
import { PropTypes } from 'prop-types';
const loaderStyle = {
    backgroundColor: '#96d8ff',
};
export const FlatLoader = () => (React.createElement("div", { className: "ball-pulse" },
    React.createElement("div", { style: loaderStyle }),
    React.createElement("div", { style: loaderStyle }),
    React.createElement("div", { style: loaderStyle })));
FlatLoader.displayName = 'FlatLoader';
export const FormLoader = () => (React.createElement("div", { className: "ball-beat" },
    React.createElement("div", { style: { height: '8px', width: '8px' } }),
    React.createElement("div", { style: { height: '8px', width: '8px' } }),
    React.createElement("div", { style: { height: '8px', width: '8px' } })));
FormLoader.displayName = 'FormLoader';
export const ListLoader = () => (React.createElement("div", { className: "ball-beat", style: { textAlign: 'center', marginTop: '20px' } },
    React.createElement("div", { style: { height: '8px', width: '8px', backgroundColor: '#4c4c4c' } }),
    React.createElement("div", { style: { height: '8px', width: '8px', backgroundColor: '#4c4c4c' } }),
    React.createElement("div", { style: { height: '8px', width: '8px', backgroundColor: '#4c4c4c' } })));
ListLoader.displayName = 'ListLoader';
export const TeamListLoader = () => (React.createElement("div", { className: "ball-beat", style: { textAlign: 'center', width: '95px' } },
    React.createElement("div", { style: { height: '8px', width: '8px', backgroundColor: '#4c4c4c' } }),
    React.createElement("div", { style: { height: '8px', width: '8px', backgroundColor: '#4c4c4c' } }),
    React.createElement("div", { style: { height: '8px', width: '8px', backgroundColor: '#4c4c4c' } })));
TeamListLoader.displayName = 'TeamListLoader';
export const Spinner = () => (React.createElement("div", { className: "Spinner bs-SpinnerLegacy Spinner--color--white Box-root Flex-inlineFlex Flex-alignItems--center Flex-justifyContent--center" },
    React.createElement("svg", { viewBox: "0 0 24 24", xmlns: "http://www.w3.org/2000/svg", className: "Spinner-svg" },
        React.createElement("ellipse", { cx: 12, cy: 12, rx: 10, ry: 10, className: "Spinner-ellipse" }))));
Spinner.displayName = 'Spinner';
export const ButtonSpinner = (props) => React.createElement("div", { className: `Spinner bs-SpinnerLegacy Spinner--color--${props && props.color ? props.color : 'white'} Box-root Flex-inlineFlex Flex-alignItems--center Flex-justifyContent--center`, style: { marginTop: 4 } },
    React.createElement("svg", { viewBox: "0 0 24 24", xmlns: "http://www.w3.org/2000/svg", className: "Spinner-svg", style: { width: 25, height: 25 } },
        React.createElement("ellipse", { cx: 12, cy: 12, rx: 10, ry: 10, className: "Spinner-ellipse" })));
ButtonSpinner.displayName = 'ButtonSpinner';
ButtonSpinner.propTypes = {
    color: PropTypes.string,
};
export const LoadingState = () => (React.createElement("div", { className: "Box-root Margin-bottom--12" },
    React.createElement("div", { className: "bs-ContentSection Card-root Card-shadow--medium" },
        React.createElement("div", { className: "Box-root" },
            React.createElement("div", { className: "ContentState Box-root" },
                React.createElement("div", { className: "Box-root Padding-horizontal--20 Padding-vertical--48" },
                    React.createElement("div", { className: "Box-root Flex-flex Flex-alignItems--center Flex-direction--column Flex-justifyContent--flexStart" },
                        React.createElement("div", { className: "Box-root Margin-bottom--12" },
                            React.createElement("div", { className: "Box-root" },
                                React.createElement("div", { className: "Spinner bs-SpinnerLegacy Spinner--size--large Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center" },
                                    React.createElement("svg", { viewBox: "0 0 24 24", xmlns: "http://www.w3.org/2000/svg", className: "Spinner-svg" },
                                        React.createElement("ellipse", { cx: 12, cy: 12, rx: 10, ry: 10, className: "Spinner-ellipse" }))))),
                        React.createElement("div", { className: "Box-root" },
                            React.createElement("div", { className: "Box-root" },
                                React.createElement("span", { className: "ContentState-title Text-align--center Text-color--secondary Text-display--block Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap" },
                                    React.createElement("span", null, "Loading")))))))))));
LoadingState.displayName = 'LoadingState';
