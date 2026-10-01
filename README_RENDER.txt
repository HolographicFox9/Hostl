HOSTL — FULL RENDER PROJECT — SERVER 591 / GAME 663 / RULES 615

This package contains the browser game and authoritative multiplayer/account server for HOSTL.

BUILD CONTENTS
- public/index.html      Game 663 browser client
- WorldRoom.js          Server 591 Colyseus multiplayer room
- index.js              Express + account/economy/auth API + Colyseus launcher
- package.json          Node start/dependency configuration
- render.yaml           Free/test Render web-service configuration
- render-persistent-example.yaml  Optional paid persistent-disk Blueprint example

SERVER 570 / GAME 642 STARTER STAGE FIX
- Player Skill XP is now always visible directly above the hotbar instead of living in the crafting menu.
- The Skill bar fills left-to-right with a lighter fill and reacts immediately whenever validated XP is earned.
- Skill can grow from combat hits and kills, resource/chest hits, taming, successful breeding, chest completion,
  and other validated survival actions. Multiplayer XP is authoritative on the server.
- Skill has no five-level cap. At Skill 10, 20, 30, 40, and every 10 levels after that, choose one stackable
  run boost: +8% movement speed, +8% survivor melee/bow damage, or 8% less incoming damage.
- Existing crafting upgrades now unlock from the visible Skill level instead of using a second hidden crafting XP track.
- Multiplayer movement, damage, and defense validation use the same Skill boost ranks as the browser client.
- Trees, rocks, logs, bushes, gold, walls, towers, chests, the player, Hostls, the gameplay HUD, and gameplay menus
  now use stronger near-black ink outlines, flatter colors, and simple cel-shaded highlights to match the pet art language.

SERVER 568 / GAME 640 SECURITY + PRODUCTION FIX PASS
- Permanent account economy is no longer writable through the generic profile-save route.
- Gold Cubits, species cards, pet unlocks, permanent pet stages, pet stat upgrades, starter purchases,
  achievements, and rewarded-ad rewards now use server-validated mutations.
- Logged-in multiplayer ignores client-claimed permanent pet stat upgrades and pet starting stages.
  The server loads the verified account entitlements instead.
- Starter pets are verified server-side before spawning for logged-in players.
- Owned/account pet stages are capped at Super Boss. Old Big Momma account starter-stage data is
  normalized down to Super Boss; Big Momma remains a wild-animal stage.
- Online achievement rewards are recorded by the authoritative world server before permanent
  account currency/cards are granted. Offline signed-in play cannot mint permanent account rewards.
- Survive-the-night credit requires the player to actually be alive during Night or Midnight.
- Rewarded theme and daily-chest grants require a replay-protected server-signed ad completion proof.
  If the rewarded-ad integration is not configured, those reward buttons stay unavailable instead
  of handing out unverified rewards.
- Forest Chest display price and server price now both use 600 Gold Cubits.
- The account snapshot from the server replaces logged-in permanent progression in the browser;
  edited localStorage values are not merged upward into the account.
- Four named worlds remain available in the world selector and retain deterministic world seeds.
- Health/config endpoints report rewarded-ad and persistent-storage configuration status.

IMPORTANT EXTERNAL SETUP
Two production dependencies cannot be created by game code itself:
1. Durable Render storage: the included render.yaml stays on Render Free for testing. Render Free
   web services cannot attach persistent disks. For production, upgrade the web service and mount a
   persistent disk (see render-persistent-example.yaml), or use another durable database/storage service.
   Set HOSTL_DATA_DIR to the mounted directory. See PERSISTENT_ACCOUNT_STORAGE.txt.
2. Rewarded ads: connect an ad provider/backend and return a server-signed completion proof only after
   a completed ad. See REWARDED_AD_SETUP.txt. Until then, rewarded-ad grants intentionally stay locked.

RENDER DEPLOYMENT
1. Put the project files at the root of your GitHub repository.
2. Connect the repository to Render as a Web Service / Blueprint.
3. Build command: npm install
4. Start command: npm start
5. Health check path: /healthz
6. Keep HOSTL_SESSION_SECRET private and stable. render.yaml generates one for a Blueprint deployment.
7. For durable accounts, mount persistent storage and set HOSTL_DATA_DIR as described in
   PERSISTENT_ACCOUNT_STORAGE.txt.
8. Open the Render HTTPS service URL. The root redirects to /index.html?server=self and the game
   connects back to that service over secure WebSocket.

BUILD CHECK
/healthz should report:
- serverBuild: 575
- gameBuild: 645
- rulesVersion: 600
- rewardedAdsConfigured: true/false
- accountStoragePersistent: true/false

/status reports the live connected-player count used by the home screen.


STARTER PET STAGE FIX (570/642)
- The configured permanent starter stage is now authoritative on offline spawn, multiplayer join, and starter repair.
- Existing lower-stage starter pets are promoted to the configured stage instead of blocking repair.
- Legacy Viper progression stored under `viper` is migrated to the internal `snake` key.
- Authenticated multiplayer uses the verified account starter selection and effective stage.


SERVER 572 / GAME 644 — SHOP POPUP + HOME CLEANUP PASS
- Home screen now uses the same thick-ink, flat/cel-shaded UI language as the in-game pet/world art while preserving selectable theme palettes.
- Home/menu buttons use stable Theme-card-style hover/focus feedback.
- Rotating material stock uses much smaller tall cards so more items fit at once.
- Clicking a material selects it and opens a full detail/purchase panel instead of putting a large Buy button on every card.
- Purchased items use a short glowing-circle reward reveal with temporary placeholder item art.
- Material purchasing immediately shows a Purchasing state and avoids one redundant UI rebuild.
- Account JSON writes are compact rather than pretty-printed, reducing disk work on purchase/progression saves.


SERVER 575 / GAME 647 — ALL-BUTTON STABILITY + RELIABLE VECTOR PURCHASE ITEM REVEAL
- Shop controls use fixed hit geometry with no brightness-filter or press movement.
- Child art/text cannot steal pointer targeting from a shop control.
- Purchase reveal lasts 4 seconds.
- Reveal has no dark/fullscreen background, panel, labels, or text: glow circle + purchased item art only.
- Material description still closes for the reveal and returns after the four-second reveal finishes.

GAME 657 art packaging: Clouded Leopard awake/sleep stage SVGs are embedded directly in public/index.html as data URIs. No external animal image files are required by the browser build.

GAME 657 loading fix: initial world placement now updates/queries the spatial collision grid as resources are created, avoiding full-array placement scans during boot. The loading overlay also has an early recovery watchdog.

GAME 658 fast Play restore: Play/Try Again now restores static resources/gold/chests in place so the existing spatial collision grid stays valid instead of cloning thousands of objects and rebuilding every bucket. Wildlife resets in place too, and a cached static-safe spawn pool avoids repeating hundreds of terrain searches at Play time. No world size, resource count, biome detail, wildlife, ponds, or gameplay time was removed.


GAME 659 direct-Play transition:
- Pressing Play no longer reopens the boot/loading overlay. The Home screen remains visible only while an online handshake is unfinished, then the ready world is revealed in one transition.
- game.started stays false until reset/connection/position preparation is complete, so offline AI cannot attack behind an overlay.
- First multiplayer entry uses the server join spawn directly; it no longer chooses a local random spawn and then sends an immediate server respawn, eliminating the visible double teleport.
- Server Rules 611 adds playerReady combat gating: newly joined players and their pets are ignored by hostile targeting/damage/pushes until the client reveals gameplay, then receive a short 1.15-second visible spawn grace.
- The click-time account entitlement refresh is non-blocking because account state is already restored on Home and the multiplayer server independently verifies permanent starter progression.


GAME 661 instant-entry live world:
- Online Home now joins the selected room before Play and renders the actual room's players, pets, wildlife, Hostls, builds and live time state behind the menu.
- Pressing Play preserves that already-visible live world instead of rebuilding/restoring the full map.
- Static server authority streams/binds around the Home camera/player in nearby areas rather than cloning the entire 18,000 x 18,000 resource map on entry.
- Home-preview players remain combat-protected indefinitely until playerReady; the old 30-second hidden-player timeout is removed.
- Rules 613 keeps live Home preview synchronized while making Play a zero-wait handoff into that already-loaded scene.


GAME 661 LIVE WORLD PREVIEW (SUPERSEDED BY GAME 662 PLAY FLOW)
- Online Home can pre-connect to the selected live room and render the real scene behind the menu.
- Game 662 no longer requires that pre-connection to finish before the Play button can be pressed.


GAME 662 PLAY-BUTTON LOADING FLOW
- Play is never disabled just because the selected Online world is still connecting.
- Clicking Play immediately changes that same button to Loading… and completes any remaining room join there.
- No separate Play-time loading popup/overlay is shown. Home remains visible until the live player record exists, then gameplay opens.
- If a Home-preview connection is already running, the Play click waits for that same attempt instead of rejecting the click as “half-loaded.”
- World/player/static synchronization continues after entry; Play only waits for the authoritative room and this player's spawn record, not the full 18,000 x 18,000 world.
- Failed online joins return the same button to Play for retry and do not open a blocking error modal.


Server 591 / Game 663 / Rules 615 — Forest + Rain Forest Island test
- Online Colyseus multiplayer remains server-authoritative and works through the configured Render/WebSocket server, including players on different internet connections.
- Active terrain is temporarily reduced to Forest + Rain Forest only; every animal species remains available while the other biome lands are deferred.
- The 18,000 x 18,000 world now contains one large circular playable island with ocean outside the shoreline. Players/creatures are constrained to land.
- Ocean rendering has layered wave marks and a broad sandy coastal shelf instead of the old square world-edge border.
- Ponds reserve a clear bank before scenery generation, use filled sloped ground shelves with no outline stroke, and visually shrink on-foot players slightly as they move deeper into pond water.
- The initial page opens without generating the full local world or showing the loading overlay. Pressing Play now opens the loading screen, performs the required offline generation or online room join/sync, then puts the player into the game.
- World generation was reduced for this two-biome test (fewer static objects/water systems while keeping useful density) to improve Play-time loading.

ACCOUNT RECOVERY / BUILD 680
- Render Free web services use an ephemeral filesystem, so accounts.json can disappear on a deploy/restart.
- HOSTL keeps HMAC-signed recovery snapshots in each browser as a safety backup.
- Build 680 fixes the "new device logs in first" recovery hole: an older browser can now restore the original account even after a newer blank replacement account was created.
- The browser session-restore flow automatically sends its signed recovery snapshots to /api/account/recover before accepting a replacement account.
- For guaranteed server-side permanence independent of any browser backup, use the persistent-disk blueprint in render-persistent-example.yaml or move account storage to a persistent database.
