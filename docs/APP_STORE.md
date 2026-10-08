# Stakan: App Store / TestFlight builds

## Audit (2026-10-04)

Apple requires uploads built with Xcode 26+ and the iOS 26 SDK+ since April 28, 2026. Re-signing an old iOS 18.5 binary does not change its build SDK. A new native build is required. SDK version and minimum deployment target are different: this pipeline keeps iOS 15.1 support.

The existing `.github/workflows/build-ios-ipa.yml` deliberately disables signing and ZIPs `Payload/*.app`. It remains the **AltStore-only** workflow. It does not perform an App Store archive/export and must not be used for store uploads.

The supplied IPA summary does not fully match this checkout: `app.json` selects **JSC**, `newArchEnabled: false`, and `package.json` does not include `expo-updates`. No IPA was provided for a fresh binary inspection during this change. This pipeline preserves the source configuration; it does not switch to Hermes, add OTA updates, change dependencies, or remove privacy manifests. If the source later switches engine intentionally, prebuild will honor that configuration.

## Files

- `.github/workflows/build-ios-app-store.yml`: independent, manually dispatched signed build, export, artifact and optional upload jobs.
- `scripts/app-store-config.cjs`: validate profile/certificate, configure only the generated app Release target, set build number, generate `exportOptions.plist`, verify archive/export metadata.
- `scripts/verify-app-store-bundle.sh`: verify bundle contents, embedded distribution profile, signature, arm64, SDK and privacy manifest.
- `tests/app-store.test.cjs`: credential-validation and release-configuration tests using synthetic data only.
- `.gitignore`: exclude release artifacts and additional signing-material formats.
- This guide. Existing AltStore workflow, package versions and native runtime settings are unchanged.

## Registered app (2026-10-08)

The App Store Connect listing is **Stakan**, using the registered explicit bundle ID `com.softdev.orderbook`. Expo config, signing validation and both IPA verification paths now use this ID. The installed display name and app header are **Stakan**. Internal workflow artifact names retain OrderBook, and the `orderbook` URL scheme is preserved. Existing AltStore installations using the old ID are separate apps; this change does not migrate their local data. CI regenerates the ignored native project from Expo config; an existing local `ios/` project must also be regenerated before building the new ID.

## Apple prerequisites

1. Active paid Apple Developer Program membership and an explicit App ID `com.softdev.orderbook` belonging to your team.
2. Create the matching app record in App Store Connect before uploading. Keep marketing version `1.0.0` unless changing it deliberately in `app.json`.
3. An **Apple Distribution** certificate exported from Keychain Access **with its private key**, as a password-protected `.p12`.
4. An **App Store Connect** provisioning profile for this exact App ID and certificate. Development, Personal Team, Ad Hoc, wildcard and Enterprise profiles are rejected before archiving.
5. For optional upload, a **team App Store Connect API key**, with issuer ID and permission to upload builds (Developer, App Manager or Admin as appropriate). An individual key without issuer ID is not supported by this workflow.

Never send private keys or certificates in chat, put them in app config, or commit them. `.gitignore` is a safeguard, not a substitute for checking staged files.

## GitHub Secrets

Create GitHub environments `app-store` and `app-store-upload` under repository Settings -> Environments. Restrict allowed branches to trusted release branches; add required reviewers where your GitHub plan supports them. Environment secrets are preferred; repository-level Actions secrets also work. Do not run a signing workflow from an untrusted branch: prebuild/Pods execute repository and dependency code.

Build secrets in **app-store**:

| Secret | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Your 10-character Apple Developer team ID. |
| `APPLE_DISTRIBUTION_P12_BASE64` | Base64 of the Apple Distribution `.p12`, including its private key. |
| `APPLE_DISTRIBUTION_P12_PASSWORD` | Password used when exporting that `.p12`. |
| `APP_STORE_PROFILE_BASE64` | Base64 of the matching App Store `.mobileprovision`. |

Optional upload secrets in **app-store-upload**:

| Secret | Value |
| --- | --- |
| `ASC_API_KEY_ID` | 10-character App Store Connect team API key ID. |
| `ASC_API_ISSUER_ID` | Issuer UUID from App Store Connect. |
| `ASC_API_PRIVATE_KEY_BASE64` | Base64 of `AuthKey_<KEY_ID>.p8`. |

Example macOS commands to copy encoded files directly into the clipboard; substitute your local paths and paste into the corresponding GitHub secret field:

```bash
base64 -i /path/to/AppleDistribution.p12 | pbcopy
base64 -i /path/to/AppStore.mobileprovision | pbcopy
base64 -i /path/to/AuthKey_YOURKEYID.p8 | pbcopy
```

No keychain-password secret is needed. The job generates a random masked temporary keychain password. Signing material is installed only in the disposable runner and cleaned up with `always()` steps. Artifacts contain the signed IPA, dSYMs and build logs, not `.p12`, `.p8`, decoded secret files or the keychain. The IPA necessarily contains its public provisioning profile and signature.

## Run

1. Push the reviewed files to a trusted branch. For a newly added manual workflow, GitHub must first know the workflow on the default branch. No changes were committed or pushed by this implementation.
2. Open Actions -> **Build iOS App Store** -> Run workflow.
3. Leave **upload_to_testflight** unchecked for a build/export-only run. Signing secrets are still required.
4. Download `OrderBook-AppStore-<build_number>` for the signed IPA and retain its matching dSYMs for crash symbolication.
5. Once upload secrets and the app record exist, enable **upload_to_testflight**. The separate upload job validates and uploads the signed artifact using `altool` and the API key. Without the secrets it fails explicitly; it never falls back to an unsigned build or Apple-ID password login.

The runner is `macos-26`, with `DEVELOPER_DIR` explicitly set to Xcode **26.2** (iOS SDK **26.2**). Both Xcode and SDK versions are checked before compilation; archive and exported IPA metadata are checked again. If GitHub retires that installed Xcode version, select another installed **stable 26+** version after testing; there is intentionally no silent fallback to the runner default or a beta.

`ios/` is ignored and generated fresh with `expo prebuild --clean --no-install`, followed by `pod install`. Expo plugins and the lockfile remain the JS/native dependency source of truth. The generated app target gets manual signing; Pods are not assigned the app's provisioning profile. This workflow intentionally fails if extensions/additional apps appear, because each additional signed bundle needs its own provisioning profile and export mapping.

Release uses `archive` for `generic/platform=iOS`, then `-exportArchive` with `method: app-store-connect`, `destination: export`, manual signing and the explicit bundle/profile mapping. Nothing ZIPs a raw `.app` into a store IPA. The generated export-options plist is temporary and contains no private key.

## Build numbers

`CFBundleVersion = (1 + floor(GITHUB_RUN_NUMBER / 100)).(GITHUB_RUN_NUMBER % 100).GITHUB_RUN_ATTEMPT`.

Examples: run 1/attempt 1 -> `1.1.1`; rerun -> `1.1.2`; run 100 -> `2.0.1`. The script enforces Apple's traditional 4/2/2-digit component bounds and writes both the generated app Info.plist and Release build settings. Export is forbidden from silently changing the number. Verification checks it in both archive and IPA.

Use this workflow as the sole build-number authority for this app/version. Existing builds from another pipeline must be checked before the first upload; there is no App Store API lookup of its latest build. Do not rerun an old build after a newer run was uploaded: start a new workflow run. For a fresh binary use **Re-run all jobs**, not just the upload job. Retrying only upload reuses the same IPA/build number and can be rejected if Apple already received it. Counter reset/workflow recreation or more than 99 attempts require an explicit versioning adjustment.

## Verification and remaining release work

Local checks:

```bash
node --test tests/app-store.test.cjs
npm test
npm run typecheck
bash -n scripts/verify-app-store-bundle.sh
```

The configured local Xcode is 15.2. An actual Xcode 26 archive, certificate import, IPA export and Apple validation/upload cannot be verified on this machine without the newer toolchain and signing credentials. The first GitHub signed run remains the native end-to-end acceptance test. Configuration/unit tests are not proof of App Store acceptance.

Implementation checks passed: 7 release-configuration tests, 25 application tests, TypeScript, all 12 workflow shell blocks plus the verification script (`bash -n`), and `actionlint` 1.7.11. A copy of the existing generated Xcode project was configured, serialized and parsed again successfully; only the app Release configuration received provisioning settings. No private credentials were used for these tests.

Upload success is not an App Store publication or even completed TestFlight processing. Check processing errors and export-compliance questions in App Store Connect, assign testers (external testing may require Beta App Review), and test on physical devices. For production, supply store screenshots, description, support and privacy-policy URLs, age rating, accurate App Privacy disclosures (including third-party exchange access), and submit for App Review. A bundled privacy manifest is necessary where required, but alone does not establish compliant disclosures or approval. No answers to legal/export/privacy questionnaires are fabricated by this workflow.

Sources:
- [Apple minimum SDK requirement](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)
- [Expo SDK 54 and Xcode 26 compatibility](https://expo.dev/blog/app-store-connect-minimum-sdk-26)
- [GitHub macOS 26 image and installed Xcode versions](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md)
- [GitHub signing on macOS runners](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)
- [Apple build uploads](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)
