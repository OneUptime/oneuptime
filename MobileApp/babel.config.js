module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      "nativewind/babel",
      [
        "module-resolver",
        {
          root: ["./src"],
          extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
          alias: {
            "@/api": "./src/api",
            "@/components": "./src/components",
            "@/context": "./src/context",
            "@/hooks": "./src/hooks",
            "@/navigation": "./src/navigation",
            "@/screens": "./src/screens",
            "@/types": "./src/types",
            "@/utils": "./src/utils",
            Common: "../Common"
          }
        }
      ]
    ]
  };
};
