import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../NavigationItems";
import { ProductsMenu, buildProductsMenu } from "./ProductsMenu";
import { ProjectProductsState } from "./ProjectProductsStore";
import { useLoadedProjectProducts } from "./UseProjectProducts";

export interface DashboardProductsMenu extends DashboardNavigationItems {
  // The catalog fitted to the project and the person (ProductsMenu.ts).
  menu: ProductsMenu;
  // The project's products answer it was fitted from.
  products: ProjectProductsState;
}

/*
 * The Dashboard's catalog (useDashboardNavigationItems) and the current
 * project's products, put together: what the products menu, the phone menu
 * and Search list (#6814). The navbar draws it on every project page, so
 * this is where the products are asked for, once per page load
 * (useLoadedProjectProducts); everything else reads what it got.
 */
const useDashboardProductsMenu: () => DashboardProductsMenu =
  (): DashboardProductsMenu => {
    const navigation: DashboardNavigationItems = useDashboardNavigationItems();
    const products: ProjectProductsState = useLoadedProjectProducts();

    return {
      ...navigation,
      menu: buildProductsMenu({
        items: navigation.moreMenuItems,
        answer: products.answer,
        fixedOrderCategories: navigation.moreMenuCategoriesInFixedOrder,
      }),
      products: products,
    };
  };

export default useDashboardProductsMenu;
