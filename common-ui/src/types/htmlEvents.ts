import React from 'react';

export interface MouseEventProp extends React.MouseEvent<HTMLElement> { };
export type MouseOnClick = (e?: MouseEventProp) => void;

export interface KeyboardEventProp extends KeyboardEvent { };
export type KeyboardKeyDown = (e?: KeyboardEventProp) => void;
