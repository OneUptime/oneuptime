/** Shared geometry keeps content clear of the floating navigation on any device. */
export const layout: Readonly<{
  gutter: number;
  cardRadius: number;
  controlHeight: number;
  tabBarHeight: number;
  tabBarGap: number;
  contentEndSpace: number;
}> = {
  gutter: 20,
  cardRadius: 16,
  controlHeight: 48,
  tabBarHeight: 72,
  tabBarGap: 12,
  contentEndSpace: 40,
} as const;

export function getTabBarBottom(bottomInset: number): number {
  return Math.max(bottomInset, layout.tabBarGap);
}

export function getScreenBottomPadding(
  bottomInset: number,
  tabBar: boolean = true,
): number {
  return tabBar
    ? layout.tabBarHeight +
        getTabBarBottom(bottomInset) +
        layout.contentEndSpace
    : bottomInset + layout.contentEndSpace;
}
