# Admin Training Module Workflow Improvements

## Goals
- Let admins paste a full YouTube URL or a video ID.
- Auto-fetch video duration from a YouTube preview (with optional manual override).
- Improve the admin training UI design (cleaner, clearer, not flashy).
- Enable editing all module fields, including description.
- Make the creation flow lead naturally to assigning modules to machines.

## Current Issues
- Admin form only accepts YouTube IDs, which is error-prone.
- Duration is manual; bad input breaks progress accuracy.
- No preview/validation to confirm the video is real.
- Description cannot be edited after creation.

## Approved Decisions
- Input should accept full YouTube URL or ID.
- Duration should auto-fetch from the YouTube preview.

## Step-by-Step Plan

### 1) UX Spec And Fields
- Add a single input labeled `YouTube URL or ID`.
- Add a preview card that shows the video title, thumbnail, and duration once detected.
- Add a read-only duration field populated from preview, plus a small `Edit` toggle to allow manual override.
- Convert description to a textarea and allow edits in both create and edit modes.
- Add inline guidance text under the YouTube input describing acceptable formats.

### 2) Parsing And Validation (Server)
- Add a shared helper to normalize YouTube URLs or IDs into a clean `youtubeVideoId`.
- Validate `youtubeVideoId` server-side on create and update.
- Return a clear error when invalid.

### 3) Preview + Duration Fetch (Client)
- On input blur or debounce, resolve the video ID and fetch preview metadata.
- Populate title (if empty) and duration from metadata.
- If preview fails, display a non-blocking warning with instructions.

### 4) Admin Training UI Redesign (Clean, Not Flashy)
- Improve form spacing, labels, and error states.
- Add a dedicated preview section so the admin can visually confirm the correct video.
- Make the edit row layout consistent with the create form (use a drawer or inline panel instead of table row edit).
- Keep the style consistent with existing app utility classes; no dramatic visual changes.

### 5) Workflow Continuity
- After module creation, show a call-to-action: `Assign to machines`.
- Optionally show which machines use each module in the list view.

### 6) QA And Verification
- Create a module using full URL.
- Create a module using a raw ID.
- Verify duration populates correctly and progress tracking works.
- Edit description and confirm it persists.
- Confirm inactive modules remain hidden for members.

## Files Likely Affected
- `apps/web/src/routes/admin/training.tsx`
- `apps/web/src/server/api/admin.ts`
- `apps/web/src/components/YouTubePlayer.tsx` (optional, if preview logic is shared)
- `apps/web/src/server/services/training.ts` (only if validation needs shared logic)
- `apps/web/src/routes/admin/machines.$machineId.tsx` (optional for module usage display)

## Notes
- If YouTube metadata requires an API key, consider a lightweight server endpoint and store the key in `.env`.
- If we avoid an API key, use a public oEmbed or iframe metadata approach for preview, with fallback to manual duration.
