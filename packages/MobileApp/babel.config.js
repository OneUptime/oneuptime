/*
 * Plain Expo preset, on purpose.
 *
 * This used to route all JSX through NativeWind's runtime. On iOS and Android
 * that runtime folds each component's inline `style` into an object with a
 * spread, which silently drops Pressable style callbacks - so most cards, rows
 * and buttons rendered unstyled on devices while web looked fine. The app is
 * styled with theme tokens and inline styles, never className, so it needs no
 * CSS interop layer. babel-preset-expo adds the worklets plugin itself.
 * See src/__tests__/nativeStyling.test.ts.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
