# AnimeVerse Community Interaction Upgrade

## What changed

The Community section now behaves like a real navigable discussion surface instead of a static card grid.

### Post deep links
- Every community post has a dedicated public route: `/community/:postId`.
- Post titles, bodies, images, reply counts, and author identities link to real destinations.
- Author avatars/names link to `/c/:username`.
- Type chips link to shareable filters such as `/community?type=poll`.

### Real discussion threads
- Added a dedicated `CommunityComment` model instead of reusing video comments.
- Signed-in users can reply to a post or reply to another comment.
- Replies are kept one level deep for readability.
- Users can delete their own replies.
- If a root reply already has child replies, deletion leaves a `[deleted]` placeholder instead of deleting other people's replies.
- Feed cards now show the real reply count from MongoDB.

### Poll interaction state
- Poll votes remain stored server-side in the existing voter arrays.
- Public API responses never expose voter IDs.
- Signed-in responses include only `selectedPollOption` for the current viewer.
- The selected option is visibly marked with a check and highlighted state.
- The post detail page shows vote counts, percentages, total votes, and the user's selected choice.
- Voting for another option moves the user's vote instead of duplicating it.

### Upvote interaction state
- Feed/detail responses now include `hasUpvoted` for the current viewer.
- Upvoted hearts are filled/highlighted.
- Toggling an upvote updates the visible count and state.
- Raw upvote user IDs stay private.

### Auth-aware caching
- Community feed and post caches are scoped by the signed-in user ID.
- A guest, User A, and User B do not reuse each other's poll/upvote UI state.

### Public browsing
- Posts and discussion threads remain readable while logged out.
- Clicking vote/upvote/reply actions while logged out routes through the existing sign-in messaging instead of pretending the action happened.

## New API routes

- `GET /api/v1/community/posts/:postId`
- `GET /api/v1/community/posts/:postId/comments`
- `POST /api/v1/community/posts/:postId/comments`
- `DELETE /api/v1/community/posts/:postId/comments/:commentId`

Existing upvote and poll-vote endpoints were kept and now return viewer state suitable for immediate UI updates.

## Files changed

### Backend
- `backend/src/models/community.model.js`
- `backend/src/controllers/community.controller.js`
- `backend/src/routes/community.routes.js`
- `backend/tests/communityInteractions.test.mjs`

### Frontend
- `frontend/src/features/community/CommunityPreview.jsx`
- `frontend/src/features/community/hooks.js`
- `frontend/src/pages/CommunityPage.jsx`
- `frontend/src/pages/CommunityPostPage.jsx`
- `frontend/src/routes/AppRoutes.jsx`
- `frontend/src/routes/paths.js`
- `frontend/src/services/index.js`
- `frontend/src/lib/api.js`

## Verification

- Backend changed modules pass `node --check`.
- 4 focused community interaction tests pass.
- All changed JS/JSX files parse successfully with Babel parser.
- A full Vite build could not run in the Linux sandbox because the uploaded project contains Windows Rollup binaries (`@rollup/rollup-linux-x64-gnu` is absent). Run the final build on the Windows development machine.

## Manual test flow

1. Open Community while signed in.
2. Upvote a card and confirm the heart becomes filled.
3. Vote in a poll and confirm the selected option is marked.
4. Refresh and confirm both states persist.
5. Click the reply count or post title and confirm `/community/:postId` opens.
6. Add a reply and confirm the real reply count increases.
7. Reply to another comment and confirm it appears under the root thread.
8. Click an author and confirm their channel opens.
9. Click a type chip and confirm the filtered Community URL is shareable.
10. Sign out and confirm posts remain readable while write actions require sign-in.
