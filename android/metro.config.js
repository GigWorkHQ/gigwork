// Metro resolution for what the app shares with the web app.
//
// The status vocabulary, amount validation and formatting live once, in ../src/live.js, and the mascots in
// ../public/assets/mascots. Both surfaces read the same files, so a status renamed on the web can't drift on the phone.
// watchFolders is what lets Metro read those paths outside this project; without it the import fails loudly.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");
const config = getDefaultConfig(projectRoot);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nativeBuild = path.join(projectRoot, "android").split(/[\\/]/).map(escape).join("[\\\\/]");

config.watchFolders = [...(config.watchFolders || []), path.join(repoRoot, "src"), path.join(repoRoot, "public", "assets", "mascots")];
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList].filter(Boolean)),
  new RegExp(`^${nativeBuild}(?:[\\\\/]|$)`),
];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
module.exports = config;
