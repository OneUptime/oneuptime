// Libraries
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';

// Components
import SideMenuItem, {
    ComponentProps,
} from '../../Components/SideMenu/SideMenuItem';
import * as Navigation from '../../Utils/Navigation';

// Types
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import { BadgeType } from '../../Components/Badge/Badge';

const highlightClassList: string =
    'bg-gray-100 text-indigo-600 hover:bg-white group rounded-md px-3 py-2 flex items-center text-sm font-medium';

jest.mock('../../Utils/Navigation.ts', () => {
    return {
        isOnThisPage: jest.fn().mockReturnValue(false),
        navigate: jest.fn(),
    };
});

describe('Side Menu Item', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    const defaultProps: ComponentProps = {
        link: {
            title: 'Home',
            to: new Route('/home'),
        },
    };

    it('Should render the main link with given title', () => {
        render(<SideMenuItem {...defaultProps} />);

        const mainLink: HTMLAnchorElement | null = screen
            .getByText(defaultProps.link.title)
            .closest('a');
        expect(mainLink).toBeInTheDocument();
    });

    it('Should call navigate function when clicked', () => {
        render(<SideMenuItem {...defaultProps} />);

        const mainLink: HTMLAnchorElement = screen
            .getByText(defaultProps.link.title)
            .closest('a') as HTMLAnchorElement;

        fireEvent.click(mainLink);

        expect(Navigation.default.navigate).toHaveBeenCalledTimes(1);
    });

    it('Should render icon if provided', () => {
        render(<SideMenuItem {...defaultProps} icon={IconProp.Home} />);

        expect(screen.getByRole('icon')).toBeInTheDocument();
    });

    it('Should render the sub item link with given title and Icon', () => {
        const subLink: {
            title: string;
            to: Route;
        } = {
            title: 'Sub Page',
            to: new Route('/sub-page'),
        };
        render(
            <SideMenuItem
                {...defaultProps}
                subItemLink={subLink}
                icon={IconProp.Home}
                subItemIcon={IconProp.ExternalLink}
            />
        );

        const subLinkElement: HTMLAnchorElement | null = screen
            .getByText(subLink.title)
            .closest('a');

        expect(subLinkElement).toBeInTheDocument();
        expect(screen.getAllByRole('icon')).toHaveLength(2);
    });

    it('Should render link badge if provided', () => {
        const badgeCount: number = 2;
        render(
            <SideMenuItem
                {...defaultProps}
                badge={badgeCount}
                badgeType={BadgeType.SUCCESS}
            />
        );

        expect(screen.getByText(badgeCount)).toBeInTheDocument();
    });

    it('Should show alert', () => {
        render(<SideMenuItem {...defaultProps} showAlert={true} />);

        expect(screen.getByRole('icon')).toBeInTheDocument();
    });

    it('Should show warning', () => {
        render(<SideMenuItem {...defaultProps} showWarning={true} />);

        expect(screen.getByRole('icon')).toBeInTheDocument();
    });

    it('Should highlights the main link when on the same page', () => {
        (Navigation.default.isOnThisPage as jest.Mock).mockReturnValue(true);
        render(<SideMenuItem {...defaultProps} />);

        const mainLink: HTMLAnchorElement | null = screen
            .getByText(defaultProps.link.title)
            .closest('a');
        expect(mainLink).toHaveClass(highlightClassList);
    });

    it('Should highlights sub item link when on the same page', () => {
        const subLink: {
            title: string;
            to: Route;
        } = {
            title: 'Sub Page',
            to: new Route('/sub-page'),
        };
        Navigation.default.isOnThisPage = jest
            .fn()
            .mockImplementation((to: Route) => {
                return to === subLink.to;
            });
        render(
            <SideMenuItem
                {...defaultProps}
                subItemLink={subLink}
                icon={IconProp.Home}
                subItemIcon={IconProp.ExternalLink}
            />
        );

        const subLinkElement: HTMLAnchorElement | null = screen
            .getByText(subLink.title)
            .closest('a');
        expect(subLinkElement).toHaveClass(highlightClassList);
    });
});
