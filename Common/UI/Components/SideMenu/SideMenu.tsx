import React, { 
  FunctionComponent, 
  ReactElement, 
  useState, 
  useEffect 
} from "react";
import Button, { ButtonStyleType } from "../Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import useComponentOutsideClick from "../../Types/UseComponentOutsideClick";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  className?: string | undefined;
}

const SideMenu: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [isMobileMenuVisible, setIsMobileMenuVisible] = useState<boolean>(false);
  
  // Use the existing outside click hook for mobile menu
  const {
    ref: mobileMenuRef,
    isComponentVisible: isMobileMenuOpen,
    setIsComponentVisible: setIsMobileMenuOpen,
  } = useComponentOutsideClick(false);

  // Sync local state with hook state
  useEffect(() => {
    setIsMobileMenuVisible(isMobileMenuOpen);
  }, [isMobileMenuOpen]);

  // Check if we're on mobile
  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  // Close mobile menu when clicking on a menu item
  const handleMenuItemClick = () => {
    if (isMobile && isMobileMenuVisible) {
      setIsMobileMenuOpen(false);
    }
  };

  let children: Array<ReactElement> = [];
  if (!Array.isArray(props.children)) {
    children = [props.children];
  } else {
    children = props.children;
  }

  // Mobile view
  if (isMobile) {
    return (
      <div className="md:hidden mb-6">
        {/* Mobile toggle button */}
        <div className="flex items-center justify-between w-full mb-4 px-4 py-3 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-medium text-gray-900">Navigation</h3>
          <Button
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={() => {
              setIsMobileMenuOpen(!isMobileMenuVisible);
            }}
            className="p-2"
            icon={isMobileMenuVisible ? IconProp.Close : IconProp.Bars3}
            dataTestId="mobile-sidemenu-toggle"
            tooltip={isMobileMenuVisible ? "Close navigation menu" : "Open navigation menu"}
          />
        </div>

        {/* Mobile collapsible menu */}
        {isMobileMenuVisible && (
          <div
            ref={mobileMenuRef}
            className="bg-white rounded-lg shadow-lg border border-gray-200 py-4 px-4 mb-6 transition-all duration-200 ease-in-out"
            role="navigation"
            aria-label="Main navigation"
          >
            <nav className="space-y-3" onClick={handleMenuItemClick}>
              {children.map((child: ReactElement, index: number) => {
                return React.cloneElement(child, { key: index });
              })}
            </nav>
          </div>
        )}
      </div>
    );
  }

  // Desktop view
  return (
    <aside 
      className={`hidden md:block py-6 px-2 sm:px-6 lg:col-span-2 md:col-span-3 lg:py-0 lg:px-0 mb-10 ${props.className || ""}`}
      role="navigation"
      aria-label="Main navigation"
    >
      <nav className="space-y-3">
        {children.map((child: ReactElement, index: number) => {
          return React.cloneElement(child, { key: index });
        })}
      </nav>
    </aside>
  );
};

export default SideMenu;
