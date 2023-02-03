import type React from 'react';

export type MouseEventProp = React.MouseEvent<HTMLElement>;
export type MouseOnClick = (e?: MouseEventProp) => void;

export type KeyboardEventProp = KeyboardEvent;
export type KeyboardKeyDown = (e?: KeyboardEventProp) => void;
