const { withInfoPlist } = require("expo/config-plugins");

module.exports = function withOrderBookPermissions(config) {
  return withInfoPlist(config, (result) => {
    // Remove permissions left by the previous camera app when reusing ios/.
    delete result.modResults.NSCameraUsageDescription;
    delete result.modResults.NSMicrophoneUsageDescription;
    return result;
  });
};
