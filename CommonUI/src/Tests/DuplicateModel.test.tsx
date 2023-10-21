import React from 'react';
import BaseModel from 'Common/Models/BaseModel';
import TableMetaData from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import DuplicateModel from '../Components/DuplicateModel/DuplicateModel';
import ObjectID from 'Common/Types/ObjectID';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import { act } from 'react-test-renderer';
import Route from 'Common/Types/API/Route';

@TableMetaData({
    tableName: 'Foo',
    singularName: 'Foo',
    pluralName: 'Foos',
    icon: IconProp.Wrench,
    tableDescription: 'A test model'
})
@CrudApiEndpoint(new Route('/testModel'))
class TestModel extends BaseModel {
    public changeThis?: string = 'original';
};

jest.mock('../Utils/ModelAPI/ModelAPI', () => {
    return {
        getItem: jest.fn().mockResolvedValueOnce({
            changeThis: 'changed',
            setValue: function (key:'changeThis', value: string) {
                this[key] = value;
            },
            removeValue: jest.fn(),
        }).mockResolvedValueOnce({
            changeThis: 'changed',
            setValue: function (key:'changeThis', value: string) {
                this[key] = value;
            },
            removeValue: jest.fn(),
        }).mockResolvedValueOnce(undefined),
        create: jest.fn().mockResolvedValueOnce({
            data: {
                id: 'foobar',
                changeThis: 'changed',
            },
        }).mockResolvedValueOnce(undefined),
    };
});

jest.mock('../Utils/Navigation',() => {
    return {
        navigate: jest.fn()
    }
});

describe('DuplicateModel', () => {
    const fieldsToDuplicate = {};
    const fieldsToChange = [{
        field: {
            changeThis: true
        },
        title: 'Change This',
        required: false,
        placeholder: 'You can change this'
    }];
    it('renders correctly', () => {
        render(
            <DuplicateModel
                modelType={TestModel}
                modelId={new ObjectID('foo')}
                fieldsToDuplicate={fieldsToDuplicate}
                fieldsToChange={fieldsToChange}
            />
        );
        expect(document.body).toMatchSnapshot();
    });
    it('shows confirmation modal when duplicate button is clicked',() => {
        render(
            <DuplicateModel
                modelType={TestModel}
                modelId={new ObjectID('foo')}
                fieldsToDuplicate={fieldsToDuplicate}
                fieldsToChange={fieldsToChange}
            />
        );
        const button = screen.getByRole('button',{name: 'Duplicate Foo'});
        fireEvent.click(button);
        expect(screen.getByRole('dialog')).toMatchSnapshot();
    });
    it('duplicates item when confirmation button is clicked',async () => {
        const onDuplicateSuccess = jest.fn();
        render(
            <DuplicateModel
                modelType={TestModel}
                modelId={new ObjectID('foo')}
                fieldsToDuplicate={fieldsToDuplicate}
                fieldsToChange={fieldsToChange}
                onDuplicateSuccess={onDuplicateSuccess}
                navigateToOnSuccess={new Route('/done')}
            />
        );
        const button = screen.getByRole('button',{name: 'Duplicate Foo'});
        act(() => {
            fireEvent.click(button);
        });
        const dialog = screen.getByRole('dialog');
        const confirmationButton = within(dialog).getByRole('button',{name: 'Duplicate Foo'});
        act(() => {
            fireEvent.click(confirmationButton);
        });
        await waitFor(
            () => expect(
                onDuplicateSuccess
            ).toBeCalledWith(
                {
                    id: 'foobar',
                    changeThis: 'changed',
                },
            )
        );
        await waitFor(
            () => expect(
                require('../Utils/Navigation').navigate
            ).toBeCalledWith(
                new Route('/done/foobar')
            )
        );
    });
    it('closes confirmation dialog when close button is clicked',() => {
        const onDuplicateSuccess = jest.fn();
        render(
            <DuplicateModel
                modelType={TestModel}
                modelId={new ObjectID('foo')}
                fieldsToDuplicate={fieldsToDuplicate}
                fieldsToChange={fieldsToChange}
                onDuplicateSuccess={onDuplicateSuccess}
                navigateToOnSuccess={new Route('/done')}
            />
        );
        const button = screen.getByRole('button',{name: 'Duplicate Foo'});
        act(() => {
            fireEvent.click(button);
        });
        const dialog = screen.getByRole('dialog');
        const closeButton = within(dialog).getByRole('button',{name: 'Close'});
        act(() => {
            fireEvent.click(closeButton);
        });
        expect(screen.queryByRole('dialog')).toBeFalsy();
    });
    it('handles could not create error correctly',async () => {
        const onDuplicateSuccess = jest.fn();
        render(
            <DuplicateModel
                modelType={TestModel}
                modelId={new ObjectID('foo')}
                fieldsToDuplicate={fieldsToDuplicate}
                fieldsToChange={fieldsToChange}
                onDuplicateSuccess={onDuplicateSuccess}
                navigateToOnSuccess={new Route('/done')}
            />
        );
        const button = screen.getByRole('button',{name: 'Duplicate Foo'});
        act(() => {
            fireEvent.click(button);
        });
        const dialog = screen.getByRole('dialog');
        const confirmationButton = within(dialog).getByRole('button',{name: 'Duplicate Foo'});
        act(() => {
            fireEvent.click(confirmationButton);
        });
        await screen.findByText('Duplicate Error');
        expect(screen.getByRole('dialog')).toMatchSnapshot();
    });
    it('handles item not found error correctly',async () => {
        const onDuplicateSuccess = jest.fn();
        render(
            <DuplicateModel
                modelType={TestModel}
                modelId={new ObjectID('foo')}
                fieldsToDuplicate={fieldsToDuplicate}
                fieldsToChange={fieldsToChange}
                onDuplicateSuccess={onDuplicateSuccess}
                navigateToOnSuccess={new Route('/done')}
            />
        );
        const button = screen.getByRole('button',{name: 'Duplicate Foo'});
        act(() => {
            fireEvent.click(button);
        });
        const dialog = screen.getByRole('dialog');
        const confirmationButton = within(dialog).getByRole('button',{name: 'Duplicate Foo'});
        act(() => {
            fireEvent.click(confirmationButton);
        });
        await screen.findByText('Duplicate Error');
        expect(screen.getByRole('dialog')).toMatchSnapshot();
    });
    it('closes error dialog when close button is clicked',async () => {
        const onDuplicateSuccess = jest.fn();
        render(
            <DuplicateModel
                modelType={TestModel}
                modelId={new ObjectID('foo')}
                fieldsToDuplicate={fieldsToDuplicate}
                fieldsToChange={fieldsToChange}
                onDuplicateSuccess={onDuplicateSuccess}
                navigateToOnSuccess={new Route('/done')}
            />
        );
        const button = screen.getByRole('button',{name: 'Duplicate Foo'});
        act(() => {
            fireEvent.click(button);
        });
        const dialog = screen.getByRole('dialog');
        const confirmationButton = within(dialog).getByRole('button',{name: 'Duplicate Foo'});
        act(() => {
            fireEvent.click(confirmationButton);
        });
        await screen.findByText('Duplicate Error');
        const errorDialog = screen.getByRole('dialog');
        const closeButton = within(errorDialog).getByRole('button',{name: 'Close'});
        act(() => {
            fireEvent.click(closeButton);
        });
        expect(screen.queryByRole('dialog')).toBeFalsy();
    });
});