// expo-widgets' own Metro setup for widget code, with expo-widgets itself swapped for stub.ts.
const path = require('path');
const config = require('expo-widgets/metro.config.js');
const base = config.resolver.resolveRequest;
const relative = /^\.\.?(?:$|[\\/])/;
config.resolver = {
  ...config.resolver,
  resolveRequest(context, moduleName, platform) {
    if (path.win32.isAbsolute(moduleName) || relative.test(moduleName)) return base(context, moduleName, platform);
    if (moduleName === 'expo-widgets') return { type: 'sourceFile', filePath: path.join(__dirname, 'stub.ts') };
    if (moduleName === 'metro-runtime/src/modules/asyncRequire' || moduleName === 'expo/internal/async-require-module') {
      return { type: 'sourceFile', filePath: require.resolve('expo-widgets/bundle/async-require-stub.ts') };
    }
    return { type: 'empty' };
  },
};
module.exports = config;
