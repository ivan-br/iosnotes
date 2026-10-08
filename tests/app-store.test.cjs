const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const YAML = require("yaml");
const plist = require("@expo/plist").default;
const {
  buildNumber,
  validateProfile,
  signingCertificate,
  configureProject,
  exportOptions,
  validateBundle,
} = require("../scripts/app-store-config.cjs");

const team = "TESTTEAM01";
const uuid = "00000000-0000-0000-0000-000000000001";
const applicationId = `${team}.com.softdev.orderbook`;
const profile = {
  UUID: uuid,
  ExpirationDate: new Date("2099-01-01"),
  TeamIdentifier: [team],
  ApplicationIdentifierPrefix: [team],
  Platform: ["iOS"],
  Entitlements: {
    "application-identifier": applicationId,
    "com.apple.developer.team-identifier": team,
    "get-task-allow": false,
    "beta-reports-active": true,
  },
};
const info = {
  CFBundleIdentifier: "com.softdev.orderbook",
  CFBundleVersion: "1.1.1",
  DTXcode: "2620",
  DTSDKName: "iphoneos26.2",
  MinimumOSVersion: "15.1",
};

test("Expo config and IPA checks use the registered App Store bundle ID", () => {
  const { expo } = JSON.parse(fs.readFileSync("app.json", "utf8"));
  assert.equal(expo.ios.bundleIdentifier, info.CFBundleIdentifier);
  assert.equal(expo.name, "Stakan");
  assert.equal(expo.scheme, "orderbook");
  const verifier = fs.readFileSync("scripts/verify-ios-bundle.sh", "utf8");
  assert.ok(verifier.includes(`plist.CFBundleDisplayName !== "${expo.name}"`));
  assert.ok(verifier.includes(`plist.CFBundleIdentifier !== "${expo.ios.bundleIdentifier}"`));
  assert.throws(() => validateProfile({
    ...profile,
    Entitlements: { ...profile.Entitlements, "application-identifier": `${team}.com.softddev.iosnotes` },
  }, team));
});

test("build numbers distinguish runs and reruns within Apple's component limits", () => {
  assert.equal(buildNumber("1", "1"), "1.1.1");
  assert.equal(buildNumber("1", "2"), "1.1.2");
  assert.equal(buildNumber("99", "1"), "1.99.1");
  assert.equal(buildNumber("100", "1"), "2.0.1");
  assert.equal(buildNumber("999899", "99"), "9999.99.99");
  for (const args of [["0", "1"], ["999900", "1"], ["2", "100"], ["NaN", "1"], ["2", "-1"]])
    assert.throws(() => buildNumber(...args));
});

test("only a current explicit App Store profile for the correct team is accepted", () => {
  assert.equal(validateProfile(profile, team), uuid);
  for (const bad of [
    { ...profile, ExpirationDate: new Date("2000-01-01") },
    { ...profile, ProvisionedDevices: [] },
    { ...profile, ProvisionsAllDevices: true },
    { ...profile, TeamIdentifier: ["OTHERTEAM1"] },
    { ...profile, UUID: "../../profile" },
    { ...profile, Entitlements: { ...profile.Entitlements, "get-task-allow": true } },
    { ...profile, Entitlements: { ...profile.Entitlements, "beta-reports-active": false } },
    { ...profile, Entitlements: { ...profile.Entitlements, "application-identifier": `${team}.*` } },
  ]) assert.throws(() => validateProfile(bad, team));
  // Older accounts can legitimately have an App ID prefix different from Team ID.
  assert.equal(validateProfile({ ...profile, ApplicationIdentifierPrefix: ["OLDPREFIX1"], Entitlements: { ...profile.Entitlements, "application-identifier": "OLDPREFIX1.com.softdev.orderbook" } }, team), uuid);
});

test("the profile certificate must match an imported valid distribution identity", () => {
  const certificate = Buffer.from("synthetic test data, not a certificate");
  const hash = createHash("sha1").update(certificate).digest("hex").toUpperCase();
  const fixture = { ...profile, DeveloperCertificates: [certificate] };
  assert.equal(signingCertificate(fixture, `1) ${hash} "Apple Distribution: Test"`), hash);
  assert.throws(() => signingCertificate(fixture, `1) ${hash} "Apple Development: Test"`));
  assert.throws(() => signingCertificate(fixture, "0 valid identities found"));
});

test("signing is applied only to app Release, preserving native engine settings", () => {
  const configs = {
    debug: { name: "Debug", buildSettings: { CODE_SIGN_STYLE: "Automatic" } },
    release: { name: "Release", buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: '"com.softdev.orderbook"', INFOPLIST_FILE: "Stakan/Info.plist", OTHER_LDFLAGS: ["-ObjC", "-lc++"] } },
    pods: { name: "Release", buildSettings: { CODE_SIGNING_ALLOWED: "NO" } },
  };
  const targets = { app: { isa: "PBXNativeTarget", productType: '"com.apple.product-type.application"', name: "Stakan", buildConfigurationList: "list" } };
  const project = {
    pbxNativeTargetSection: () => targets,
    pbxXCConfigurationList: () => ({ list: { buildConfigurations: [{ value: "debug" }, { value: "release" }] } }),
    pbxXCBuildConfigurationSection: () => configs,
  };
  const before = structuredClone(configs);
  assert.deepEqual(configureProject(project, { team, uuid, certificate: "A".repeat(40), version: "1.1.1" }), { scheme: "Stakan", info: "Stakan/Info.plist" });
  assert.deepEqual(configs.debug, before.debug);
  assert.deepEqual(configs.pods, before.pods);
  assert.deepEqual(configs.release.buildSettings.OTHER_LDFLAGS, before.release.buildSettings.OTHER_LDFLAGS);
  assert.equal(configs.release.buildSettings.CODE_SIGN_STYLE, "Manual");
  assert.equal(configs.release.buildSettings.PROVISIONING_PROFILE_SPECIFIER, uuid);
  assert.equal(configs.release.buildSettings.IPHONEOS_DEPLOYMENT_TARGET, "15.1");
  targets.extension = { isa: "PBXNativeTarget", productType: '"com.apple.product-type.app-extension"' };
  assert.throws(() => configureProject(project, { team, uuid, certificate: "A", version: "1.1.1" }));
});

test("export plist is App Store Connect with manual signing and no implicit renumbering", () => {
  const options = plist.parse(plist.build(exportOptions(team, uuid, "A".repeat(40))));
  assert.equal(options.method, "app-store-connect");
  assert.equal(options.destination, "export");
  assert.equal(options.signingStyle, "manual");
  assert.equal(options.manageAppVersionAndBuildNumber, false);
  assert.equal(options.provisioningProfiles[info.CFBundleIdentifier], uuid);
});

test("bundle verification rejects old SDKs, wrong versions and debug signatures", () => {
  assert.doesNotThrow(() => validateBundle(info, profile.Entitlements, profile, team, "1.1.1"));
  for (const patch of [{ DTXcode: "1640" }, { DTSDKName: "iphoneos18.5" }, { DTSDKName: "iphonesimulator26.2" }, { MinimumOSVersion: "26.0" }, { CFBundleVersion: "1" }, { CFBundleIdentifier: "com.other.app" }])
    assert.throws(() => validateBundle({ ...info, ...patch }, profile.Entitlements, profile, team, "1.1.1"));
  assert.throws(() => validateBundle(info, { ...profile.Entitlements, "get-task-allow": true }, profile, team, "1.1.1"));
});

test("architecture check puts the executable before lipo's variadic architecture list", () => {
  const source = fs.readFileSync("scripts/verify-app-store-bundle.sh", "utf8");
  assert.ok(source.split("\n").includes('xcrun lipo "$APP_PATH/$EXECUTABLE" -verify_arch arm64'));
});

test("workflow keeps signed archive/export and optional upload separate from AltStore", () => {
  const source = fs.readFileSync(".github/workflows/build-ios-app-store.yml", "utf8");
  const workflow = YAML.parse(source);
  assert.equal(workflow.on.workflow_dispatch.inputs.upload_to_testflight.default, false);
  assert.equal(workflow.jobs.build["runs-on"], "macos-26");
  assert.equal(workflow.jobs.upload.needs, "build");
  assert.equal(workflow.jobs.upload.if, "${{ inputs.upload_to_testflight }}");
  assert.match(source, /-exportArchive/);
  assert.match(source, /-archivePath/);
  assert.doesNotMatch(source, /CODE_SIGNING_ALLOWED=NO|zip -.*Payload/);
  assert.equal(workflow.jobs.build.steps.at(-1).if, "always()");
  const altstore = fs.readFileSync(".github/workflows/build-ios-ipa.yml", "utf8");
  assert.match(altstore, /CODE_SIGNING_ALLOWED=NO/);
});
