# Publish Stakan's privacy page

The static `docs/index.html` page provides privacy information and a support contact. It has no build step, JavaScript, tracking, or remote assets. `docs/icon.png` is a copy of the app icon. This change does not modify the native app or upload a new IPA.

## Owner review before publishing

- Confirm that the support/diagnostic handling and retention commitments match your actual practices. This is a draft policy for your review, not a legal-compliance certification.
- The approved public contact is `ivanrichards111@gmail.com`. No phone number is published.
- The app fetches instrument catalogs from both exchanges on launch. Do not describe it as contacting only the selected exchange.
- Exchange log retention and regional/legal permissions remain unverified. The page discloses this uncertainty; it does not establish permission to redistribute data or decide the App Store privacy questionnaire.
- Review applicable legal obligations, including any additional controller information or lawful-basis disclosures needed for your audience, before release.

## GitHub Pages

After the change is merged into `master` in `ivan-br/iosnotes`:

1. Open the repository's Settings > Pages.
2. Under Build and deployment, select Deploy from a branch.
3. Select `master`, then `/docs`, and save.
4. Wait for the Pages deployment to succeed. Open the URL shown by GitHub without signing in and confirm that the privacy page, icon, navigation, and email link work.

Expected URL, only valid after successful deployment:

`https://ivan-br.github.io/iosnotes/`

Use the verified URL for App Store Connect's Privacy Policy URL. The same page's `#support` section can be used for the Support URL. The optional User Privacy Choices URL can remain blank; the page explains how to email privacy requests.

Publishing `/docs` also exposes other files in that directory. Never put credentials, certificates, provisioning profiles, or private release notes there.

## Remaining app release work

Add an easily accessible link to the verified policy URL inside Stakan, build and upload a new IPA, and select that build for submission. Review App Privacy answers based on actual developer and provider practices; the absence of an analytics SDK does not settle third-party collection. A hosted policy alone does not address exchange authorization or region-blocked APIs.

Sources:
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://developer.apple.com/app-store/review/guidelines/#privacy
- https://developer.apple.com/app-store/app-privacy-details/
