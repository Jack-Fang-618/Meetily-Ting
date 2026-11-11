# Ting floating captions

2026-11-10 development preview. Open **Floating captions** beside the recording controls or in Settings → Recordings.

- Independent desktop window, initially 680 × 220, frameless dark panel, rounded transparent corners and always-on-top enabled.
- Drag its header; resize from the window edges. Use −/+ for 18–40 px text, pin to toggle always-on-top, × to close only the caption window.
- Works with existing local `transcript-update` events and cloud Streaming drafts/finals. Local models display text when their own recognition completes; the window cannot make a batch model emit faster.
- Finals replace the previous sentence; cloud drafts appear below the previous final. Duplicate/out-of-order final events cannot replace newer text. Long captions scroll to the latest text instead of hiding it outside the viewport.
- Opening mid-recording loads the latest retained transcript after subscribing, guarded against racing newer events. Caption text is not stored separately.
- The `/captions` route uses a minimal root shell. It does not mount onboarding, analytics, recording providers, import dialogs or credential settings.
- Window capability is limited to listening/unlistening and close/drag/always-on-top controls. No filesystem, clipboard or credential permissions are added to this window.

Validation: TypeScript/production export and Rust compilation passed; 62 frontend tests passed, including caption order/deduplication and font bounds. Browser component preview checked layout, size controls and pin state. Actual native dragging, transparency, resizing and always-on-top across other apps remain manual acceptance items on macOS; Windows/Linux have not been tested.

This is a caption display, not live translation. Font/position persistence and click-through mode are not included in this first version.

## 2026-11-10 appearance update

User accepted cloud live transcription and the original native floating window. Added macOS native HUD vibrancy (active even when unfocused), 16px rounded effect and matching web surface, plus Appearance controls for text/background colors, 45–100% opacity and Reset. Preferences persist in local webview storage; no caption content is stored. Settings remain legible with custom caption colors. Browser preview verified settings, opacity persistence after reload and reset. Native vibrancy still needs user visual acceptance; this does not add translation.

Appearance update validation: 62 frontend tests, TypeScript and production export passed; full Rust suite 269 passed / 7 ignored. Component preview confirmed automatic persistence and Reset; preview screenshot is local under `experiments/ui-cloud-preview/caption-appearance.png` (not part of production assets).

## Sentence translation

See [caption translation](caption-translation.md) for implementation, model selection, measured latency and limitations. The window now opens at 720×340 (minimum 380×280) to accommodate source + translation and model controls. Earlier statements that translation is absent describe the initial version only.

## Frost revision (2026-11-10)

The current macOS effect is active Popover vibrancy with a 16px radius and a transparent native window plus transparent HTML/body. Default surface tint is now 28%; Appearance allows 0–100%. The appearance storage key moved to v2 so the previous opaque default does not mask the effect. This resets earlier appearance preferences once. Text itself remains opaque. Native desktop blur and accessibility Reduce Transparency behavior require visual acceptance on the target Mac; browser CSS preview cannot establish native vibrancy.

## Full-screen Spaces follow-up

Tao's `visible_on_all_workspaces` sets only CanJoinAllSpaces. Caption creation now also sets FullScreenAuxiliary and, on macOS 13+, CanJoinAllApplications, preserving unrelated flags and removing mutually exclusive roles. Native changes run on the main thread and affect only the caption window. Keep the pin enabled for topmost behavior. Compilation verifies API integration; other-app fullscreen and desktop switching still need native acceptance. Reference: https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications

## Full-screen panel revision and local captions

The prior NSWindow collection flags passed compilation but **failed the user's fullscreen test**. Replaced that approach with a nonactivating NSPanel through tauri-nspanel pinned to commit 3ffa93ed14e0f8e857e43619b4157f2a685d35a4. Only the caption window is converted; the main app remains a normal Dock application. Panel conversion/show/close run on the AppKit main thread; closing restores the original Tauri window class/ownership first. Cmd-W follows the same cleanup path. The panel stays visible when the app deactivates and joins full-screen spaces. This revision still requires actual fullscreen/close/reopen/resize/pin acceptance on the user's Mac; compilation does not establish success.

Local captions retain the most recent five segments. Scrolling up pauses auto-follow until the reader returns to the bottom. Cloud draft presentation is unchanged.

## Unified scrollback (2026-11-10)

User confirmed NSPanel fullscreen visibility and bounded local subtitle delivery. Original captions now retain the latest 50 final segments for both local and cloud ASR; the cloud draft remains a separate updating line. Translation modes retain up to 50 matched source/translation pairs. Sentence jobs use recording/sequence IDs; direct live translation uses session/item IDs, so deltas replace their own entry and late originals update the correct earlier pair. Scroll up to pause follow; **Back to latest** or scrolling to the bottom restores it. Histories are memory-only and reset on a new recording/translation configuration or window close; pause/resume preserves history. This is recent scrollback, not a complete translated transcript: the existing bounded sentence translation queue can skip intermediate jobs if the model cannot keep up.

Validation: browser component test confirmed top position remained 0 while a new pair arrived; Back to latest restored bottom-follow for subsequent pairs. Frontend regression covers bounded histories, repeated sentences with distinct IDs, and incremental updates. Native fullscreen had already passed user acceptance before this change.

On 2026-11-11, a local Qwen recording contained intelligible English across the saved audio, while live VAD submitted only 1.15 seconds to recognition. Local Qwen capture now feeds consecutive six-second windows and submits the remaining audio on stop. The worker retains its near-silence check. This trades some extra inference on background sound for coverage when the speech detector misses speech. The rolling caption history and sentence-translation queue still operate separately.
