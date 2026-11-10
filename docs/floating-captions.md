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
