import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import BarLoader from 'react-spinners/BarLoader';
import BeatLoader from 'react-spinners/BeatLoader';
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
        expect(BarLoader).toBeInTheDocument();
    });
    test('it should render if beats loader show up', () => {
        render(
            <Loader
                size={50}
                color={new Color('#000000')}
                loaderType={LoaderType.Beats}
            />
        );
        expect(BeatLoader).toBeInTheDocument()
    });
});
