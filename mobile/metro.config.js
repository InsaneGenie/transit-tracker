// The app shares its vehicle helpers with the website in ../web/src, so Metro has to watch that folder too.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../web/src')];

module.exports = config;
