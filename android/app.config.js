// Build-time configuration, following Tera's Android flow.
//
// A signed release is the production app (com.gigworkhq.android); every other build is the preview app
// (com.gigworkhq.android.preview), signed with Expo's development key. They are two different apps to Android, each
// with its own GitHub release and update manifest, so neither can update into the other. The app reads its channel
// from its own application ID (src/update.ts).
//
// REQUEST_INSTALL_PACKAGES lets the app hand a verified, downloaded APK to Android's installer for in-app updates.
// Both channels are direct downloads from the GigWork site (there is no Play Store listing), so both request it.
module.exports = ({ config }) => {
  const release = process.env.GIGWORK_SIGNED_RELEASE === "true";
  return {
    ...config,
    name: release ? "GigWork" : "GigWork Preview",
    updates: { enabled: false },
    android: {
      ...config.android,
      package: release ? "com.gigworkhq.android" : "com.gigworkhq.android.preview",
      versionCode: Number(process.env.GIGWORK_VERSION_CODE || process.env.GITHUB_RUN_NUMBER || 1),
      permissions: [...(config.android.permissions ?? []), "android.permission.REQUEST_INSTALL_PACKAGES"],
      blockedPermissions: [...config.android.blockedPermissions, "android.permission.SYSTEM_ALERT_WINDOW"],
    },
  };
};
