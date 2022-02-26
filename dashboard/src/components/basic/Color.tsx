import React from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { SketchPicker } from 'react-color';

function Color({
    currentColorPicker,
    handleClick,
    displayColorPicker,
    color,
    handleChange,
    handleClose,
    ...props
}: $TSFixMe) {
    return (
        <div
            className="Box-root Box-root Box-root Flex-flex"
            style={{ ...props.style, marginBottom: '10px' }}
        >
            <div
                onClick={handleClick}
                style={{
                    margin: '3px',
                    borderRadius: '5px',
                    display: 'inline-block',
                    cursor: 'pointer',
                    width: '27px',
                    height: '27px',
                    borderColor: '#bd5858',
                    borderWidth: '1px',
                }}
                id={props.id}
            >
                <div
                    style={{
                        padding: '3px',
                        width: '25px',
                        height: '25px',
                        borderRadius: '5px',
                        boxShadow: 'rgba(0, 0, 0, 0.1) 0px 0px 1px 1px',
                        background: `rgba(${color && color.r ? color.r : 0}, ${
                            color && color.g ? color.g : 0
                        }, ${color && color.b ? color.b : 0}, ${
                            color && color.a ? color.a : 1
                        })`,
                    }}
                />
            </div>
            {displayColorPicker && currentColorPicker === props.id && (
                <div style={{ position: 'absolute', zIndex: '2' }}>
                    <div
                        onClick={handleClose}
                        style={{
                            position: 'fixed',
                            top: '0px',
                            right: '0px',
                            bottom: '0px',
                            left: '0px',
                        }}
                    />
                    <SketchPicker color={color} onChange={handleChange} />
                </div>
            )}
            <div
                style={{
                    marginLeft: '8px',
                    marginTop: '5px',
                    marginRight: '15px',
                }}
            >
                <span>{props.title}</span>
            </div>
        </div>
    );
}

Color.displayName = 'Color';

Color.propTypes = {
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    currentColorPicker: PropTypes.string,
    handleClick: PropTypes.func,
    handleChange: PropTypes.func,
    handleClose: PropTypes.func,
    displayColorPicker: PropTypes.bool,
    color: PropTypes.object,
    style: PropTypes.object,
};

export default Color;
