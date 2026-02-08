# Finish Developer ID Certificate Setup and Notarized Release

## Meta
- Owner: Conrad Brown
- Date: 2026-01-22
- Tier: 1
- Status: Draft

## Problem
Developer ID Application certificate import fails with error `-25294`, blocking code signing and notarization for a direct-download macOS release.

## Goals / Non-Goals

**Goals**
- Resolve certificate import error and get a valid Developer ID Application identity in Keychain.
- Establish a repeatable signing + notarization flow for the Electron app.
- Produce a notarized DMG/ZIP ready for distribution.

**Non-Goals**
- Mac App Store distribution.
- Auto-update (Sparkle) integration.

## Hard Requirements
- [ ] Developer ID Application certificate is present in Keychain with its private key.
- [ ] `codesign` verifies the app bundle with a valid Developer ID identity.
- [ ] Notarization completes successfully and is stapled to the DMG (and/or app).
- [ ] The release artifacts can be opened on a clean macOS machine without Gatekeeper warnings.

## Proposed Solution
1. Diagnose the `-25294` import error:
   - Confirm Keychain login is unlocked and writable.
   - Verify whether the Developer ID cert already exists.
   - Ensure the CSR was created on the same Mac (or obtain a `.p12` if not).
2. Install the Developer ID Application certificate properly:
   - If CSR was created here: re-download the `.cer` and import.
   - If CSR was created elsewhere: import a `.p12` with private key.
3. Set up signing + notarization scripts:
   - Configure `electron-builder` for macOS signing (hardened runtime).
   - Add notarization environment variables (Apple ID + app-specific password).
4. Build and notarize:
   - Run `npm run build:desktop`.
   - Verify notarization, staple, and validate with `spctl`.

## Data & Interfaces
- Data model changes: none.
- API/contracts: none.
- Migrations: none.

## UX / Behavior
- Primary flow: user installs the DMG and launches the app without security warnings.
- Edge cases:
  - Keychain locked or read-only.
  - CSR created on another machine (missing private key).
  - Incorrect Apple ID credentials or missing app-specific password.
- Errors:
  - `-25294` when importing certificate.
  - Notarization failures due to missing entitlements or identity.

## Rollout & Risks
- Flags: none.
- Backwards compatibility: no runtime changes.
- Risks:
  - Wrong cert type (Developer ID Installer vs Application).
  - CI/local machine mismatch for signing credentials.
  - Notarization delays or rejections.

## Testing & Verification
- `security find-identity -v -p codesigning` shows Developer ID Application identity.
- `codesign --verify --deep --strict` passes on the `.app`.
- `xcrun notarytool submit ... --wait` succeeds.
- `xcrun stapler staple` succeeds.
- `spctl -a -t exec -vv` reports "accepted" for the app.

## Open Questions
- Was the CSR created on this same Mac, or do we need the `.p12` from another machine?
- Do we want to automate signing/notarization in a script or keep it manual?

## Sign-off
- Approved by:
- Date:
- Notes:
