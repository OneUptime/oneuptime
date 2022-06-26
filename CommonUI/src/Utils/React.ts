import React, { useState, useEffect, FunctionComponent as FC, ReactElement as RE } from 'react';

export default {
    React,
    useState,
    useEffect
}

export type FunctionComponent<T = {}> = FC<T>;
export type ReactElement<T = {}> = RE<T>;