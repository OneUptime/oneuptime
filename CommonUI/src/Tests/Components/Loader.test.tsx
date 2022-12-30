import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Loader, { LoaderType } from '../../Components/Loader/Loader';
import Color from 'Common/Types/Color';

describe('Loader tests', () => {
    test('it should render if bar loader show up', () => {
        render(
            <Loader
                size={50}
                color={new Color('#000000')}
                loaderType={LoaderType.Bar}
            />
        );
        const barLoader: HTMLElement = screen.getByRole('bar-loader');
        expect(barLoader).toBeInTheDocument();
    });
    test('it should render if beats loader show up', () => {
        render(
            <Loader
                size={50}
                color={new Color('#000000')}
                loaderType={LoaderType.Beats}
            />
        );
        const beatLoader: HTMLElement = screen.getByRole('beat-loader');
        expect(beatLoader).toBeInTheDocument();
    });
});
