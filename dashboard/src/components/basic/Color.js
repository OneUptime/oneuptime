import React from 'react';
import PropTypes from 'prop-types';
import { SketchPicker } from 'react-color';

function Color({ currentColorPicker, handleClick, displayColorPicker, color, handleChange, handleClose, ...props }) {
	return (
		<div className="Box-root Box-root Box-root Flex-flex" style={{ ...props.style, marginBottom: '10px' }}>
			<div onClick={handleClick} style={{ padding: '3px', background: '#fff', borderRadius: '1px', boxShadow: '0 0 0 1px rgba(0,0,0,.1)', display: 'inline-block', cursor: 'pointer', width: '36px', height: '27px' }} id={props.id}>
				<div style={{ padding: '3px', width: '30px', height: '20px', borderRadius: '1px', boxShadow: '0 0 0 1px rgba(0,0,0,.1)', background: `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`, }} />
			</div>
			{displayColorPicker && currentColorPicker === props.id && <div style={{ position: 'absolute', zIndex: '2' }}>
				<div onClick={handleClose} style={{ position: 'fixed', top: '0px', right: '0px', bottom: '0px', left: '0px' }} />
				<SketchPicker color={color} onChange={handleChange} />
			</div>
			}
			<div style={{ marginLeft: '8px', marginTop: '5px', marginRight: '15px' }}><span>{props.title}</span></div>
		</div>
	)
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
}

export default Color;
