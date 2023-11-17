import React from 'react';
import { faker } from '@faker-js/faker';
import { render, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';

import ComponentMetadata, {
    ComponentCategory,
    ComponentType,
} from 'Common/Types/Workflow/Component';
import IconProp from 'Common/Types/Icon/IconProp';

import ComponentsModal from '../../Components/Workflow/ComponentsModal';

/// @dev we use different UUID for (id & title), description, and category to ensure that the component is unique
const getComponentMetadata: Function = (
    category?: string
): ComponentMetadata => {
    const id: string = faker.datatype.uuid();
    return {
        id,
        title: id,
        description: faker.datatype.uuid(),
        category: category || faker.datatype.uuid(),
        iconProp: IconProp.Activity,
        componentType: ComponentType.Component,
        arguments: [],
        returnValues: [],
        inPorts: [],
        outPorts: [],
    };
};

const getComponentCategory: Function = (name?: string): ComponentCategory => {
    return {
        name: name || faker.datatype.uuid(),
        description: `Description for ${name}`,
        icon: IconProp.Activity,
    };
};

describe('ComponentsModal', () => {
    const mockedCategories: ComponentCategory[] = [
        getComponentCategory(),
        getComponentCategory(),
        getComponentCategory(),
        getComponentCategory(),
    ];

    const mockedComponents: ComponentMetadata[] = [
        getComponentMetadata(mockedCategories[0]?.name),
        getComponentMetadata(mockedCategories[1]?.name),
        getComponentMetadata(mockedCategories[2]?.name),
        getComponentMetadata(mockedCategories[3]?.name),
    ];

    const mockOnCloseModal: jest.Mock = jest.fn();
    const mockOnComponentClick: jest.Mock = jest.fn();

    it('should render without crashing', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );
    });

    it('should display search input', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );
        expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    });

    it('should display categories and components', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );
        for (const cat of mockedCategories) {
            expect(screen.getByText(cat.name)).toBeInTheDocument();
        }
        for (const comp of mockedComponents) {
            expect(screen.getByText(comp.title)).toBeInTheDocument();
        }
    });

    it('should call onCloseModal when the close button is clicked', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );
        fireEvent.click(screen.getByText('Close panel'));
        expect(mockOnCloseModal).toHaveBeenCalled();
    });

    it('should call onComponentClick when a component is selected', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );
        for (const [idx, comp] of mockedComponents.entries()) {
            // simulate selecting a component
            fireEvent.click(screen.getByText(comp.title));
            expect(screen.getByText('Create')).not.toBeDisabled();

            // simulate submitting
            fireEvent.click(screen.getByText('Create'));

            // check if onComponentClick was called with the selected component's metadata
            expect(mockOnComponentClick).toHaveBeenNthCalledWith(idx + 1, comp);
        }
    });

    it('should display a message when no components are available', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={[]}
                categories={mockedCategories}
            />
        );
        expect(
            screen.getByText(
                'No components that match your search. If you are looking for an integration that does not exist currently - you can use Custom Code or API component to build anything you like. If you are an enterprise customer, feel free to talk to us and we will build it for you.'
            )
        ).toBeInTheDocument();
    });

    it('should not display categories when there are no categories', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={[]}
            />
        );
        mockedCategories.forEach((category: ComponentCategory) => {
            expect(screen.queryByText(category.name)).not.toBeInTheDocument();
        });
    });

    it('should display no components message when search yields no results', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );
        fireEvent.change(screen.getByPlaceholderText('Search...'), {
            target: { value: 'Non-existent Ccmponent' },
        });
        expect(
            screen.getByText(
                'No components that match your search. If you are looking for an integration that does not exist currently - you can use Custom Code or API component to build anything you like. If you are an enterprise customer, feel free to talk to us and we will build it for you.'
            )
        ).toBeInTheDocument();
    });

    it('should disable submit button prop when no component is selected', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );
        const submitButton: HTMLElement = screen.getByText('Create');
        expect(submitButton).toBeDisabled();
    });

    it('should change submitButtonDisabled to false when a component is selected', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );
        for (const comp of mockedComponents) {
            fireEvent.click(screen.getByText(comp.title));
            const submitButton: HTMLElement = screen.getByText('Create');
            expect(submitButton).not.toBeDisabled();
        }
    });

    // search tests

    it('should filter components based on search input', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );

        mockedComponents.forEach((comp: ComponentMetadata) => {
            const partialTitle: string = comp.title.substring(
                0,
                comp.title.length - comp.title.length / 2
            );
            fireEvent.change(screen.getByPlaceholderText('Search...'), {
                target: { value: partialTitle },
            });
            expect(screen.getByText(comp.title)).toBeInTheDocument();

            // check other components are not displayed
            mockedComponents
                .filter((c: ComponentMetadata) => {
                    return c.title !== comp.title;
                })
                .forEach((c: ComponentMetadata) => {
                    return expect(
                        screen.queryByText(c.title)
                    ).not.toBeInTheDocument();
                });
        });
    });

    it('should filter components based on description when searching', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );
        mockedComponents.forEach((comp: ComponentMetadata) => {
            fireEvent.change(screen.getByPlaceholderText('Search...'), {
                target: { value: comp.description },
            });
            expect(screen.getByText(comp.title)).toBeInTheDocument();

            // check other components are not displayed
            mockedComponents
                .filter((c: ComponentMetadata) => {
                    return c.title !== comp.title;
                })
                .forEach((c: ComponentMetadata) => {
                    return expect(
                        screen.queryByText(c.title)
                    ).not.toBeInTheDocument();
                });
        });
    });

    it('should filter components based on category when searching', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );
        mockedComponents.forEach((comp: ComponentMetadata) => {
            fireEvent.change(screen.getByPlaceholderText('Search...'), {
                target: { value: comp.category },
            });
            expect(screen.getByText(comp.title)).toBeInTheDocument();

            // check other components are not displayed
            mockedComponents
                .filter((c: ComponentMetadata) => {
                    return c.category !== comp.category;
                })
                .forEach((c: ComponentMetadata) => {
                    return expect(
                        screen.queryByText(c.title)
                    ).not.toBeInTheDocument();
                });
        });
    });

    it('should show all components when search is cleared', () => {
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );
        mockedComponents.forEach((comp: ComponentMetadata) => {
            const searchInput: HTMLElement =
                screen.getByPlaceholderText('Search...');
            fireEvent.change(searchInput, { target: { value: comp.title } });
            fireEvent.change(searchInput, { target: { value: '' } }); // clear search

            mockedComponents.forEach((c: ComponentMetadata) => {
                return expect(screen.getByText(c.title)).toBeInTheDocument();
            });
        });
    });

    it('should return multiple components when similar titles match', () => {
        // we add a new component where its title is a substring of another component's title
        const commonWord: string =
            mockedComponents[0]?.title.substring(0, 5) || '';
        const newComponent: ComponentMetadata = getComponentMetadata(
            mockedCategories[1]?.name
        );
        newComponent.title += commonWord;
        mockedComponents.push(newComponent);
        const componentsWithCommonWord: ComponentMetadata[] =
            mockedComponents.filter((comp: ComponentMetadata) => {
                return comp.title.includes(commonWord);
            });

        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('Search...'), {
            target: { value: commonWord },
        });
        componentsWithCommonWord.forEach((comp: ComponentMetadata) => {
            expect(screen.getByText(comp.title)).toBeInTheDocument();
        });
    });

    it('should return return components with similar descriptions', () => {
        // we add a new component where its title is a substring of another component's description
        const partialDescription: string =
            mockedComponents[0]?.description.substring(0, 10) || '';
        const newComponent: ComponentMetadata = getComponentMetadata(
            mockedCategories[1]?.name
        );
        newComponent.title = partialDescription || '';
        mockedComponents.push(newComponent);
        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('Search...'), {
            target: { value: partialDescription },
        });
        expect(
            screen.getAllByText(new RegExp(partialDescription, 'i'))
        ).toHaveLength(2);
    });

    it('should return components with the same category', () => {
        // we add two components with the same category as the first component
        const commonCategory: string | undefined =
            mockedComponents[0]?.category;
        mockedComponents.push(getComponentMetadata(commonCategory));
        mockedComponents.push(getComponentMetadata(commonCategory));
        const componentsInCommonCategory: ComponentMetadata[] =
            mockedComponents.filter((comp: ComponentMetadata) => {
                return comp.category === commonCategory;
            });

        render(
            <ComponentsModal
                componentsType={ComponentType.Component}
                onCloseModal={mockOnCloseModal}
                onComponentClick={mockOnComponentClick}
                components={mockedComponents}
                categories={mockedCategories}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('Search...'), {
            target: { value: commonCategory },
        });
        componentsInCommonCategory.forEach((comp: ComponentMetadata) => {
            expect(screen.getByText(comp.title)).toBeInTheDocument();
        });
    });
});
