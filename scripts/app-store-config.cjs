const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const plist = require("@expo/plist").default;
const xcode = require("xcode");

const BUNDLE_ID = "com.softdev.orderbook";
const unquote = (value) => String(value).replace(/^"|"$/g, "");
const readPlist = (file) => plist.parse(fs.readFileSync(file, "utf8"));
const writePlist = (file, value) => fs.writeFileSync(file, plist.build(value));

function buildNumber(run, attempt) {
  if (!/^\d+$/.test(String(run)) || !/^\d+$/.test(String(attempt)))
    throw new Error("Invalid GitHub run number or attempt");
  run = Number(run);
  attempt = Number(attempt);
  if (!Number.isSafeInteger(run) || run < 1 || run >= 999900 || attempt < 1 || attempt > 99)
    throw new Error("GitHub counter exceeds the supported CFBundleVersion range");
  // Each run and full rerun gets a unique, increasing Apple 4.2.2 build version.
  return `${Math.floor(run / 100) + 1}.${run % 100}.${attempt}`;
}

function validateProfile(profile, team, now = new Date()) {
  if (!/^[A-Z0-9]{10}$/.test(team || "")) throw new Error("Invalid APPLE_TEAM_ID");
  if (!/^[A-F0-9-]{36}$/i.test(profile.UUID || "")) throw new Error("Invalid profile UUID");
  if (!(new Date(profile.ExpirationDate) > now)) throw new Error("Provisioning profile has expired");
  const entitlements = profile.Entitlements || {};
  const applicationId = entitlements["application-identifier"];
  const matchesApp = (profile.ApplicationIdentifierPrefix || []).some(
    (prefix) => applicationId === `${prefix}.${BUNDLE_ID}`,
  );
  if (!matchesApp || !profile.TeamIdentifier?.includes(team) || entitlements["com.apple.developer.team-identifier"] !== team)
    throw new Error("Profile must belong to APPLE_TEAM_ID and the explicit Stakan bundle ID");
  if (!profile.Platform?.includes("iOS") || "ProvisionedDevices" in profile || profile.ProvisionsAllDevices || entitlements["get-task-allow"] !== false || entitlements["beta-reports-active"] !== true)
    throw new Error("An App Store Connect distribution profile is required, not Development/Ad Hoc/Enterprise");
  return profile.UUID;
}

function signingCertificate(profile, identities) {
  for (const certificate of profile.DeveloperCertificates || []) {
    const hash = createHash("sha1").update(Buffer.from(certificate)).digest("hex").toUpperCase();
    if (identities.split("\n").some((line) => line.includes(hash) && line.includes('"Apple Distribution:')))
      return hash;
  }
  throw new Error("No valid Apple Distribution identity with a private key matches the profile");
}

function configureProject(project, { team, uuid, certificate, version }) {
  const targets = Object.values(project.pbxNativeTargetSection()).filter(
    (target) => typeof target === "object" && target.isa === "PBXNativeTarget",
  );
  const apps = targets.filter((target) => unquote(target.productType) === "com.apple.product-type.application");
  if (apps.length !== 1 || targets.some((target) => unquote(target.productType).includes("extension")))
    throw new Error("Expected one app with no extensions; additional signed targets need their own profiles");
  const target = apps[0];
  const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
  const configs = project.pbxXCBuildConfigurationSection();
  const release = list.buildConfigurations.map(({ value }) => configs[value]).find((config) => unquote(config.name) === "Release");
  if (!release) throw new Error("Release app configuration not found");
  const settings = release.buildSettings;
  if (unquote(settings.PRODUCT_BUNDLE_IDENTIFIER) !== BUNDLE_ID)
    throw new Error("Generated app bundle ID does not match Stakan");
  // Scope provisioning to the application target, never to Pods/resource bundles.
  Object.assign(settings, {
    DEVELOPMENT_TEAM: team,
    CODE_SIGN_STYLE: "Manual",
    CODE_SIGN_IDENTITY: certificate,
    '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"': certificate,
    PROVISIONING_PROFILE_SPECIFIER: uuid,
    CURRENT_PROJECT_VERSION: `"${version}"`,
    IPHONEOS_DEPLOYMENT_TARGET: "15.1",
    SKIP_INSTALL: "NO",
  });
  delete settings.PROVISIONING_PROFILE;
  return { scheme: unquote(target.name), info: unquote(settings.INFOPLIST_FILE) };
}

function exportOptions(team, uuid, certificate) {
  return {
    method: "app-store-connect",
    destination: "export",
    signingStyle: "manual",
    teamID: team,
    signingCertificate: certificate,
    provisioningProfiles: { [BUNDLE_ID]: uuid },
    manageAppVersionAndBuildNumber: false,
    stripSwiftSymbols: true,
    uploadSymbols: true,
  };
}

function validateBundle(info, entitlements, profile, team, version) {
  validateProfile(profile, team);
  if (info.CFBundleIdentifier !== BUNDLE_ID || info.CFBundleVersion !== version)
    throw new Error("Archive/export bundle ID or build number mismatch");
  if (!/^\d{4,}$/.test(String(info.DTXcode)) || Number(info.DTXcode) < 2600 || !/^iphoneos\d/.test(info.DTSDKName || "") || Number(info.DTSDKName.match(/^iphoneos(\d+)/)?.[1]) < 26)
    throw new Error("Archive/export must be built with Xcode 26+ and iOS SDK 26+");
  if (info.MinimumOSVersion !== "15.1") throw new Error("Unexpected minimum iOS version");
  if (entitlements["get-task-allow"] === true || entitlements["application-identifier"] !== profile.Entitlements["application-identifier"] || entitlements["com.apple.developer.team-identifier"] !== team)
    throw new Error("Invalid distribution signing entitlements");
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "verify") {
    validateBundle(readPlist(args[0]), readPlist(args[1]), readPlist(args[2]), process.env.APPLE_TEAM_ID, process.env.IOS_BUILD_NUMBER);
    return;
  }
  if (command !== "prepare") throw new Error("Use prepare or verify");
  const [projectPath, profilePath, identitiesPath, exportPath] = args;
  const team = process.env.APPLE_TEAM_ID;
  const profile = readPlist(profilePath);
  const uuid = validateProfile(profile, team);
  const certificate = signingCertificate(profile, fs.readFileSync(identitiesPath, "utf8"));
  const version = buildNumber(process.env.GITHUB_RUN_NUMBER, process.env.GITHUB_RUN_ATTEMPT);
  const project = xcode.project(projectPath);
  project.parseSync();
  const { scheme, info } = configureProject(project, { team, uuid, certificate, version });
  const root = path.dirname(path.dirname(projectPath));
  const infoPath = path.resolve(root, info);
  if (!infoPath.startsWith(path.resolve(root) + path.sep)) throw new Error("Unexpected Info.plist path");
  const appInfo = readPlist(infoPath);
  appInfo.CFBundleVersion = version;
  writePlist(infoPath, appInfo);
  fs.writeFileSync(projectPath, project.writeSync());
  writePlist(exportPath, exportOptions(team, uuid, certificate));
  if (!/^[\w-]+$/.test(scheme)) throw new Error("Unexpected scheme name");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `scheme=${scheme}\nprofile_uuid=${uuid}\nbuild_number=${version}\n`);
  console.log(`Configured ${BUNDLE_ID}, Release ${version}, iOS 15.1; export method app-store-connect.`);
}

module.exports = { buildNumber, validateProfile, signingCertificate, configureProject, exportOptions, validateBundle };
if (require.main === module) main();
