import * as React from 'react';
import { describe, expect } from '@jest/globals';
import renderer, {
    ReactTestInstance,
    ReactTestRenderer,
} from 'react-test-renderer';
import Pill, { PillSize } from '../Components/Pill/Pill';
import Color from 'Common/Types/Color';
import { EnzymePropSelector, configure, shallow } from 'enzyme';
import Adapter from 'enzyme-adapter-react-16';
configure({ adapter: new Adapter() });

describe('<Pill />', () => {
    test('should render the component with className rounded-pill', () => {
        const color: Color = new Color('#807149');
        const testRenderer: ReactTestRenderer = renderer.create(
            <Pill text="Love" color={color} size={PillSize.Small} />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance
                .findByProps({ id: 'pill' })
                .props['className'].includes('rounded-pill')
        ).toBe(true);
    });
    test('Checking text', () => {
        const color: Color = new Color('#807149');
        const testRenderer: ReactTestRenderer = renderer.create(
            <Pill text="Love" color={color} size={PillSize.Small} />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(testInstance.findByProps({ id: 'pill' }).children).toEqual([
            ' ',
            'Love',
            ' ',
        ]);
    });
    test('Test for font-size(Small) ', () => {
        const color: Color = new Color('#807149');
        const wrapper: EnzymePropSelector = shallow(
            <Pill text="Love" color={color} size={PillSize.Small} />
        );
        expect(wrapper.props().style).toHaveProperty('fontSize', '10px');
    });
    test('Test for font-size(Normal) ', () => {
        const color: Color = new Color('#807149');
        const wrapper: EnzymePropSelector = shallow(
            <Pill text="Love" color={color} size={PillSize.Normal} />
        );
        expect(wrapper.props().style).toHaveProperty('fontSize', '13px');
    });
    test('Test for font-size(Large) ', () => {
        const color: Color = new Color('#807149');
        const wrapper: EnzymePropSelector = shallow(
            <Pill text="Love" color={color} size={PillSize.Large} />
        );
        expect(wrapper.props().style).toHaveProperty('fontSize', '15px');
    });
    test('Test for font-size(Extra-Large) ', () => {
        const color: Color = new Color('#807149');
        const wrapper: EnzymePropSelector = shallow(
            <Pill text="Love" color={color} size={PillSize.ExtraLarge} />
        );
        expect(wrapper.props().style).toHaveProperty('fontSize', '18px');
    });
    test('Checking for color #fffff', () => {
        const color: Color = new Color('#ffffff');
        const wrapper: EnzymePropSelector = shallow(
            <Pill text="Love" color={color} size={PillSize.ExtraLarge} />
        );
        expect(wrapper.props().style).toHaveProperty(
            'backgroundColor',
            '#ffffff'
        );
    });
    test('Checking for color #ff0000', () => {
        const color: Color = new Color('#ff0000');
        const wrapper: EnzymePropSelector = shallow(
            <Pill text="Love" color={color} size={PillSize.ExtraLarge} />
        );
        expect(wrapper.props().style).toHaveProperty(
            'backgroundColor',
            '#ff0000'
        );
    });
});
