# Disabled patches

`build.patches` applies only `*.patch` files directly inside `patches/`. Nothing in this directory is applied or counted in the customization digest.

## 0007-inline-file-selection-snapshot.patch

Disabled for Onyx v5.0.0-beta.2 and kept for reference.

- The patch no longer applies to b80667827 (`patch --dry-run`: hunk #1 FAILED at 68).
- Upstream appears to have fixed the bug itself. `handleFileSelect` in `InlineFileManagement.tsx` now copies the `FileList` with `Array.from(selectedFiles)` before clearing the input, with the comment "resetting the input below empties this live FileList before the updater runs".

If needed, re-check the FileList bug in the UI (script `native-save-controls-file`). If the bug still reproduces, port the patch and move it back to `patches/`.
