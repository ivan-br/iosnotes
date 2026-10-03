# OrderBook Bug and Performance Audit

Date: 2026-10-03
Scope: current Expo SDK 54 / React Native 0.81 application
Primary implementation reviewed: `app/index.tsx`

Revision: implementation and verification update, 2026-10-03. Original audit source commit: `f9590fd13a5710481876ecb1fd79e050ed0872ef`. The findings and proposed plan below are retained as historical evidence. Current implementation status is recorded first. Changes have not been committed.

## Implementation results

The fixes now live in `app/index.tsx`, `src/market/`, and `src/components/`. The app retains Expo Router, SDK 54, TypeScript, standard React Native controls, the existing terminal colors, Spot/Futures and Book/Long-Short views, full symbol search, and custom price-step Apply. No backend or user-account integration was introduced.

| Findings | Implemented changes | Verification |
| --- | --- | --- |
| R1, R3, A14, A22-A25, A41 | Virtualized full-catalog picker in a dismissible native Modal, keyboard-aware bounds, explicit dismissal, disabled autocorrection, separator-insensitive search, empty result feedback, local input drafts, validation, roles/selection states and focus restoration. | Live browser selection and Enter dismiss the picker; invalid steps retain the applied value; Enter applies a valid step and clears focus. Physical iOS keyboard and VoiceOver checks remain pending. |
| R2, A1-A2, A4-A5, A7, A16-A19 | One transport owner per instrument; generation guards; abortable 15-second HTTP requests; bounded synchronization buffers; exponential retry with jitter and cooldown; complete teardown; AppState stop/resume; Binance replay validation; Bybit stream-first snapshots, acknowledgement handling and heartbeat. Quiet Binance books use a small freshness request rather than repeated full snapshots. | Fake-clock/transport tests cover gaps, obsolete callbacks, failed snapshots, timeout, cooldown, duplicates, Bybit resets, cleanup and foreground restart. Live Binance and Bybit streams both reached LIVE. |
| A3, A9-A11, A24-A28, A37 | Instrument-keyed sessions, integer price ticks with explicit safe bounds, price-dependent defaults (BTC approximately 200, a 0.1-priced coin approximately 0.01, smaller steps for micro prices), metadata precision, atomic payload validation, raw spread/mid, actual quantity-scaled bars, and a loaded-depth coverage notice. | Exact decimal boundaries, invalid payloads, fractional ticks, micro values, raw spread, overflow and incremental projection tests pass. No old book appears while a new instrument is loading. |
| R4, A13-A14, A27, A29 | Raw maps and incremental bucket totals live outside React; publications coalesce to at most 10 Hz; unchanged rows retain object identity; controls and ratio charts do not subscribe to row updates; hidden book has no projection publications; order rows use FlatList with initial best-price positioning and scroll anchoring. | Deterministic replay matches an independent reference for all 1,200 projected updates. Hidden-publication and burst tests pass. CPU measurements are below; device frame-rate/input-latency claims remain unmeasured. |
| A6, A20-A23 | Complete validated paginated catalogs, encoded cursors, repeated-cursor rejection, cancellation, automatic retry and periodic/foreground refresh. No BTC fallback when switching market. Temporary failures are kept distinct from a missing symbol. | Later-page failure/cursor tests pass. Live BTC/TRY Spot to Futures keeps BTCTRY and shows Not found without old book rows. |
| A8, A12, A30-A36, A40 | Independently refreshed ratio series with cancellation and no overlapping poll for a series; identity-keyed state; correct all-account versus top-position labels; latest percentages, numeric ratios and times for both charts; explicit unavailable Bybit top series; responsive columns and a connected ratio line; true zero shares and unavailable zero-denominator ratios. Sampling stays fixed with no period selector. | Live Binance exposes both series, Bybit exposes the all-account series and an honest top-series limitation. Independent endpoint-error/invalid payload tests pass. Both chart axes and the line fit a 320-pixel viewport. |
| A15, A38-A39 | SDK-compatible Router peers and patches; Node version file; application-level workspace/scheme discovery; bundle validation; tests/typecheck in CI; prebuild permission cleanup for the previous camera application. Bundle identity and JSC/legacy runtime are preserved. | Typecheck, SDK dependency check and iOS JavaScript export pass. Prebuild updates OrderBook display name and URL scheme and removes stale camera/microphone permissions. Native compilation/install is blocked by the local toolchain described below. |

Additional issues caught while implementing: dated futures contracts had indistinguishable base/quote labels; labels now include their contract suffix. Empty aggregate buckets could survive as floating residuals after deleting their last member; bucket membership now controls removal. Unsafe rounded bucket prices are rejected before changing the applied step. Missing instruments no longer display an endless CONNECTING badge.

### Measured engine performance

Command: `node tests/benchmark.cjs`. Node 24 on this Mac; synthetic, deterministic 10,000-level initial book, 20 changed levels per event, 200 warm-up updates and 1,000 measured updates. The reference reproduces the old full-sort/aggregate pipeline. It excludes React rendering, network latency and native frame timing. Every projected price and quantity was checked against the reference.

| Processing per update | Old pipeline reference | Current engine |
| --- | --- | --- |
| p50 | 1.122 ms | 0.178 ms |
| p95 | 3.420 ms | 0.474 ms |
| Total over 1,000 updates | 2062.7 ms | 242.8 ms |

This demonstrates reduced engine work on this fixture, not an iPhone FPS guarantee. The initial source-depth limits remain Binance Spot 5,000 per side, USD-M 1,000, and Bybit stream depth 1,000. The loaded book can still be incomplete beyond its snapshot coverage; the UI now states that limitation.

### Validation and remaining limits

- `npm test`: 19 deterministic tests passed in the final full run. The test command uses Node's built-in test runner and the existing TypeScript compiler; no test-framework dependency was added.
- Live Expo web checks passed for selection dismissal, outside-tap dismissal, Enter dismissal, separator search, empty search results, missing-market selection preservation, invalid-step feedback, Enter-to-Apply and focus removal, Binance/Bybit LIVE books, and ratio layout at 320/428 pixels. No browser runtime errors were recorded. A mobile preview is saved at `dist/verification/orderbook-mobile.png` (ignored build output).
- `npm run typecheck`: passed. `npx expo install --check`: dependencies are up to date.
- `npx expo export --platform ios --output-dir dist/ios-verification`: produced the iOS JavaScript bundle and assets. This is not an IPA or native launch test.
- `npx expo prebuild --platform ios --no-install`: passed using the existing ignored native project. Its internal Xcode project name can remain LooksmaxingProMax; the display name is OrderBook, and build scripts now discover the actual scheme.
- `bash -n scripts/build-altstore-ipa.sh scripts/verify-ios-bundle.sh`: passed.
- `expo-doctor`: 17/18 passed. The remaining failure is the local CocoaPods version check. Full native compilation is also unavailable with the currently selected Xcode 15.2; SDK 54 requires Xcode 16.1 or newer. No claim of an installed-iPhone regression pass is made.
- Compatible dependency repairs reduced npm's audit from 41 findings (including one critical) to 35 (11 moderate, 24 high). Remaining upstream/tooling advisories are not resolved by the SDK-54-compatible update; forced SDK/Router downgrades suggested by npm were not applied.
- Pending device acceptance: iPhone background/foreground on Wi-Fi and cellular, keyboard/outside-tap behavior with the real iOS keyboard, VoiceOver/Dynamic Type, sustained memory/frame-rate profiling, and a release IPA launch. No physical-device baseline or 30-minute device soak was available in this environment.
- Bybit does not expose the requested top-trader position series through the adapter's public API. The app labels it unavailable; it does not substitute account data or fabricate positions.
- Public exchange depth remains limited by the exchange's advertised depth and access restrictions. COIN-M/inverse contracts are outside the existing USD-M/linear Futures scope.

The original audit and proposed implementation plan follow for traceability. Their statements about unmodified code and future work describe the earlier audit, not the current working tree.

## Executive summary

The code contains defects and expensive paths consistent with the reported keyboard, foreground-resume, symbol-menu, and lag symptoms. This is a static audit with small arithmetic checks, not an iPhone runtime reproduction or performance profile. The exact cause of a complete UI freeze and its relative contributors remain unmeasured. Live depth updates share a React state owner with controls, search, and charts, so each published update can cause the screen subtree to render.

The most serious additional findings are:

1. Failed snapshots can create multiple simultaneous WebSocket connections and reconnect timers.
2. The Binance pre-snapshot event buffer is unbounded and can grow indefinitely.
3. Switching symbol, exchange, or market can temporarily show the previous order book under the new symbol label.
4. Binance futures buffered events are applied without the required sequence validation, so the displayed book can be incorrect.
5. Very low-priced symbols are aggregated and formatted incorrectly, sometimes producing a zero bid or identical-looking prices.
6. A single transient instrument-list request failure permanently disables that market until the app is restarted.
7. Required Expo Router peer dependencies are missing from the direct dependencies.

## Audit method

- Reviewed the full application screen, configuration, dependency manifest, and screenshots supplied with the issue.
- Initial audit ran `npx tsc --noEmit`: passed. This revision reran the installed compiler with `npx --no-install tsc --noEmit`: passed.
- Initial audit ran `npx expo-doctor`: 14/17 checks passed; three checks failed. This revision preserves that result; it did not rerun dependency installation or the doctor.
- Compared lifecycle behavior with React Native 0.81 documentation.
- Compared local order-book synchronization with current Binance and Bybit public API documentation.
- No application code was modified and no device-side profiling instrumentation was added.
- Read-only arithmetic checks reproduced the current rounding and bar-width formulas; outputs are recorded below. No test or application files were created.
- Reviewed `app/_layout.tsx`, `app.json`, `package.json`, the lockfile, the local IPA script, GitHub workflow, and existing ignored iOS project configuration. No native build, simulator session, or live exchange fault injection was performed.

## Evidence and corrections to the first report

- **Code-confirmed** means a reachable path or formula exists in this revision, not that it was reproduced on the user's phone. Race findings specify the required event ordering.
- **Reported / needs device verification** applies to actual keyboard behavior, a completely frozen app, touch delivery, memory termination, and measured frame loss. Missing lifecycle handling is confirmed; it does not alone prove the cause of every freeze.
- **Opportunity / limitation** applies to optimizations and unavailable features such as Bybit top-trader data. Do not treat these as measured regressions.
- R4: React can batch state setters. Three setters do not prove three commits, and reconciliation does not mean every native row is destroyed/recreated. The confirmed costs are array allocation, sorting, aggregation, and component render work. Buffered replay still repeats synchronous sorting even when React batches its commits.
- R1: selecting a symbol unmounts the search input, which normally removes its focus. `keyboardShouldPersistTaps="handled"` supports selecting a result on the first tap and should not simply be removed. Apply/outside-tap dismissal is the clearer defect; verify any keyboard remaining after selection on iOS.
- A10: identical-looking rows can be caused by insufficient formatting precision. A duplicate bucket caused only by floating-point residue has not been demonstrated, so that claim is removed.
- A12: the current Bybit adapter supplies no top-trader series. This is an explicit capability limitation, not proof that a documented top-trader endpoint exists and was overlooked.
- A15: undeclared peers and patch mismatches are release risks, not a demonstrated crash or lag diagnosis. The third doctor failure was the local CocoaPods version check; it is a build-environment issue.
- Current documentation accepts Bybit depth 1000 for Spot and linear markets, and Binance's futures `/public/stream` path. Do not replace either on the basis of older API assumptions. See [Bybit REST depth](https://bybit-exchange.github.io/docs/v5/market/orderbook) and [Binance futures stream routes](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams).
- The earlier suggestion to throttle to the display frame rate was imprecise: a 60/120 Hz loop can increase work relative to a 10 Hz feed. The plan below uses dirty-state publication at no more than the existing feed cadence, with no idle renders.

## Reported bugs and supporting code findings

### R1. Keyboard sometimes does not disappear

Severity: Medium
Evidence: `app/index.tsx:600-656`

- Neither symbol selection nor the Apply action calls `Keyboard.dismiss()` or explicitly blurs the active input.
- The symbol list uses `keyboardShouldPersistTaps="handled"`; a handled tap does not itself dismiss the keyboard, although selecting a symbol also unmounts this input and normally ends focus.
- There is no screen-level outside-tap keyboard dismissal.
- The price-step field uses `decimal-pad`; on iOS this keyboard does not reliably provide the submit flow implied by `returnKeyType="done"` and `onSubmitEditing`.
- Symbol search also leaves autocorrect/predictive text enabled, which is inappropriate for exchange symbols and is visible in the supplied screenshot.

Expected result: selecting a symbol, tapping Apply, closing the menu, or tapping outside should consistently remove input focus and dismiss the keyboard.

### R2. App can become stuck after backgrounding and reopening

Severity: High
Evidence: `app/index.tsx:262-453`

- There is no `AppState` subscription anywhere in the project.
- WebSockets, reconnect timers, and ratio timers are not explicitly suspended when the app backgrounds or restarted when it becomes active.
- There is no last-message timestamp or stale-feed watchdog. A socket can still be treated as `LIVE` even after it silently stopped delivering updates.
- Bybit has no application-level heartbeat even though its API recommends sending a ping every 20 seconds.

Expected result: backgrounding should pause/close live work; foregrounding should create a fresh snapshot and subscription, and stale feeds should transition away from `LIVE`.

### R3. Token dropdown sometimes does not disappear

Severity: Medium
Evidence: `app/index.tsx:509-530`, `app/index.tsx:560-637`

- The menu closes only when its button is toggled, a symbol is selected, or exchange/market is changed.
- There is no backdrop, outside-press handler, blur handler, Escape/back handling, or lifecycle close behavior.
- Switching Book/Long/Short uses `setView` directly and does not close the menu.
- The menu is an absolutely positioned `View`, not a modal/popover with a dismiss layer.

Expected result: outside taps, tab changes, keyboard dismissal, and backgrounding should close the menu.

### R4. Overall UI is slow and visibly lags

Severity: High
Evidence: `app/index.tsx:385-434`, `app/index.tsx:757-787`, `app/index.tsx:1173-1205`

For every depth update, currently as often as every 100 ms:

1. Both full `Map` objects are converted to arrays and sorted.
2. Two React state arrays and the update ID are published.
3. Both arrays are bucketed and sorted again.
4. Up to 240 row components are rendered/reconciled inside a non-virtualized `ScrollView`; stable keys can preserve native views.
5. The whole screen component re-renders, including controls, an open symbol menu, and the ratio view.

React Native documents that `ScrollView` renders all children at once and has a performance cost for long lists. This implementation also keeps the book stream active while the Long/Short tab is visible, so hidden order-book updates continuously re-render the charts.

## Additional bugs found

### A1. Snapshot failures can leak sockets and create reconnect storms

Severity: High
Evidence: `app/index.tsx:285-381`, `app/index.tsx:444-452`

`loadInitialSnapshot()` schedules `connect()` after 1.8 seconds when REST fails, but it does not close the already-open socket. `connect()` then overwrites the single `socket` variable with a new connection. Older sockets can remain active and are no longer reachable for cleanup. Multiple timers can also overwrite the single `reconnectTimer` reference.

For Bybit, the original socket subscribes in `.finally()` even when the REST snapshot failed, while a reconnect has already been scheduled. This makes duplicate live subscriptions especially likely.

Impact: duplicated updates, increasing CPU/network usage, inconsistent state, and worsening lag after network interruptions. Repeated Binance spot snapshots request 5,000 levels, whose documented request weight is 250 per call, so the fixed 1.8-second retry can also exhaust API limits quickly.

### A2. Pre-snapshot event buffer has no size or time limit

Severity: High
Evidence: `app/index.tsx:279-324`, `app/index.tsx:349-381`

While a Binance snapshot is pending, every depth event is appended to `eventBuffer`. There is no cap, timeout, deduplication, or abort path. If REST hangs or repeatedly fails while one or more sockets remain open, the array grows indefinitely.

Impact: rising memory use, long catch-up work, UI freezes, and possible iOS termination under memory pressure.

### A3. Old market data is shown under a newly selected symbol

Severity: High
Evidence: `app/index.tsx:262-274`, `app/index.tsx:509-530`

The previous `rawBids` and `rawAsks` are cleared only when the new symbol is unavailable. For a valid symbol/exchange/market switch, the old arrays remain visible until the new snapshot finishes. The labels change immediately, so users can see BTC data labeled as another asset. The automatic price step can also be calculated from the old asset's mid-price during this window.

Expected result: the old book should never be presented as data for a newly selected instrument.

### A4. Binance futures buffered-event validation is incomplete

Severity: High
Evidence: `app/index.tsx:363-369`, `app/index.tsx:385-403`

All buffered Binance events are applied with `isBuffered=true`. That bypasses the futures `pu === previous u` continuity check. The implementation also does not explicitly locate and validate the required first buffered event whose `[U, u]` range contains the snapshot update ID.

Impact: packet gaps during startup can produce a locally inconsistent futures order book while the UI still reports `LIVE`.

### A5. Stale data can remain marked LIVE indefinitely

Severity: High
Evidence: `app/index.tsx:333-345`, `app/index.tsx:403-404`, `app/index.tsx:424-427`

Status changes to `LIVE` when a message is processed, but there is no freshness deadline. `onerror` only changes status to `OFFLINE`; it does not guarantee socket closure or reconnection. If the native socket silently stops receiving without an immediate close event, the last book remains on screen and the status can stay `LIVE` forever.

### A6. One metadata failure permanently disables a market

Severity: High
Evidence: `app/index.tsx:217-253`, `app/index.tsx:515-518`, `app/index.tsx:569-575`

All four symbol catalogs are fetched once at mount. Any network error is converted to `unavailable`, and unavailable market buttons are disabled. There is no retry, foreground refresh, or distinction between "exchange does not support this market" and "request temporarily failed."

Impact: launching offline or during a transient Binance/Bybit error can leave Spot or Futures disabled until a full app restart. The displayed `Not found` message is also misleading for network failures.

### A7. Requests have no timeout or cancellation

Severity: Medium
Evidence: `app/index.tsx:217-253`, `app/index.tsx:349-381`, `app/index.tsx:947-1092`

None of the catalog, snapshot, or ratio requests use an `AbortController` or timeout. Switching symbol/exchange leaves obsolete requests running. A stalled request can keep market availability in `loading`, delay Bybit subscription, or overlap with later attempts.

### A8. Ratio refresh requests can overlap and overwrite newer data

Severity: Medium
Evidence: `app/index.tsx:455-491`

`setInterval` starts a new request every 30 seconds without checking whether the previous request completed. Slow requests can overlap, and an older response may arrive last and replace newer chart data. Cleanup prevents a post-unmount state update but does not cancel network work already in progress.

### A9. Low-priced symbols produce invalid aggregation and display

Severity: High
Evidence: `app/index.tsx:1269-1315`, `app/index.tsx:1342-1348`

- Automatic step bottoms out at `0.0001`, even for instruments priced below that value.
- Non-BTC/ETH prices are always formatted to four decimals.
- A symbol around `0.00001` can therefore be bucketed into `0.0000` bids and `0.0001` asks, hiding the real book.
- Exchange-provided tick size/price scale is not loaded or used.

Impact: support for "all spot symbols" is functionally incorrect for micro-priced tokens.

### A10. Floating-point bucket boundaries can place orders in the wrong row

Severity: Medium
Evidence: `app/index.tsx:1179-1190`

Bucket keys use binary floating-point division plus `Math.floor`/`Math.ceil`. Read-only evaluation of the current formulas produced `floor(0.3 / 0.1) * 0.1 = 0.2` and `ceil(0.07 / 0.01) * 0.01 = 0.08`. Both exact decimal boundaries land in the wrong bucket. Identical-looking prices from display rounding are a separate finding.

Expected result: bucketing should use exchange tick units or integer-scaled decimal arithmetic.

### A11. Displayed spread is the bucket spread, not the market spread

Severity: Medium
Evidence: `app/index.tsx:191-193`, `app/index.tsx:493-502`, `app/index.tsx:771-775`

Best bid/ask are calculated after rounding into the selected price step. With a BTC step of 200, a real spread of a few cents can be displayed as 200 or 400. The central price is also computed from bucket boundaries rather than raw best bid/ask.

Impact: the label `Spread` presents an aggregation artifact as if it were the live market spread.

### A12. Bybit Top Traders chart can never contain data

Severity: Medium
Evidence: `app/index.tsx:836-843`, `app/index.tsx:1075-1077`

The Bybit response mapper always returns `topPositions: []`, but the interface always renders the Top Traders Position Ratio section. For Bybit it permanently displays `No public data`, regardless of connection health. Classify this as unsupported by the current integration and represent it explicitly; do not substitute account ratios and call them top positions.

### A13. Hidden book work continues on the Long/Short tab

Severity: High
Evidence: `app/index.tsx:262-453`, `app/index.tsx:671-689`

The order-book effect does not depend on `view` and is never paused when Long/Short is selected. High-frequency book state updates therefore keep re-rendering the entire ratio screen even though the data is invisible.

Impact: unnecessary CPU, battery, network, and chart render work; this can make the supposedly low-frequency ratio screen lag.

### A14. Symbol picker rendering and search add avoidable input lag

Severity: Medium
Evidence: `app/index.tsx:209-215`, `app/index.tsx:608-635`

Every search change filters the complete symbol catalog and renders up to 80 rows in a `ScrollView`. Because the picker is part of the same component receiving depth updates, those 80 rows can also be reconciled on every market event. Long symbol labels have no `numberOfLines`/shrink behavior and can collide with the chevron or price-step column.

### A15. Expo Router installation is incomplete for standalone builds

Severity: High for distribution, Low for current UI lag
Evidence: `package.json:8-20`

`expo-doctor` reports missing direct peer dependencies `expo-constants` and `expo-linking`, both required by `expo-router`. It warns that the app may crash outside Expo Go. It also reports patch mismatches: installed `expo` 54.0.34 vs expected 54.0.37, and `expo-router` 6.0.23 vs expected 6.0.24.

This does not explain every runtime lag, but it is a separate release reliability defect and is especially relevant to AltStore/standalone builds.

## Further findings from the second review

Priorities: P1 = address early for correctness, recovery, or major responsiveness; P2 = functional or usability defect; P3 = lower-impact polish or maintenance. Conditions and checks below are proposed reproduction steps unless an arithmetic result is explicitly recorded.

### A16. Ordinary reconnect retains initialized state

P1, code-confirmed. Evidence: `app/index.tsx:279-288`, `339-345`, `322-327`.

After a normal server close, `connect()` does not reset `isInitialized`, maps, update ID, or buffer. Only `restartStream()` resets initialization. On the replacement Binance connection, deltas arriving before REST completes can be applied to the old book or repeatedly trigger another close. Check: initialize, close the transport normally, delay the second snapshot, then deliver a delta. Each connection needs its own synchronization generation and must buffer until its snapshot is validated.

### A17. Snapshot replay ignores its own restart decision

P1, code-confirmed. Evidence: `app/index.tsx:367-376`, `395-398`, `436-439`.

A buffered Spot gap calls `restartStream()`, but the caller continues replaying and then unconditionally sets `isInitialized=true`, publishes, and sets `LIVE`. Check: snapshot ID 100 followed by buffered event U=110, u=120. A failed replay must abort the whole snapshot transaction and never publish it as synchronized.

### A18. Old callbacks and responses can mutate a replacement connection

P1, code-confirmed race. Evidence: `app/index.tsx:285-300`, `349-380`, `444-452`.

The `isActive` guard identifies the effect lifetime, not a connection attempt. A snapshot for socket A may finish after socket B is created and replace B's maps. Bybit's callback sends through the mutable `socket` variable rather than the socket that initiated the request, without checking `readyState`; a closed/connecting target can throw from an unhandled `.finally()` promise. An overwritten timer can call `connect()` after cleanup because `connect()` itself does not check `isActive`. Test delayed responses, two pending retry callbacks, and teardown between them. Use generation-scoped socket/request/timer ownership.

### A19. Bybit unnecessarily waits for REST and ignores subscription rejection

P1 for false LIVE state; performance opportunity for startup. Evidence: `app/index.tsx:290-297`, `374-376`, `407-412`, `1128-1139`.

REST must finish before subscription is sent, although the [Bybit stream supplies an initial snapshot](https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook). REST already marks the feed LIVE before a streaming snapshot arrives. A subscription rejection without an `orderbook.*` topic is silently discarded, leaving a static snapshot looking live. Check delayed REST and a failed subscribe acknowledgement. Prefer the stream snapshot as the authoritative Bybit initialization; handle acknowledgements, errors, heartbeat, and a subscription deadline.

### A20. Bybit pagination silently accepts an incomplete catalog

P2, code-confirmed. Evidence: `app/index.tsx:975-997`.

An HTTP-success response with a nonzero `retCode` on a later page executes `break`, then returns earlier symbols as a successful complete list. Missing later symbols are consequently reported as Not found. A repeated cursor also has no termination guard. Check one valid page followed by an API error or repeated cursor; reject incomplete results and retain the last known complete catalog.

### A21. Symbol catalogs never refresh during the session

P2, code-confirmed. Evidence: `app/index.tsx:217-253`, `961-995`.

Successful catalogs are loaded once too. Listings, suspensions, and delistings cannot update the picker until a remount. A removed symbol can keep retrying; a new one cannot be found. Refresh stale catalogs on demand/foreground with a modest freshness interval, and distinguish a missing symbol in a complete current catalog from an unknown catalog state.

### A22. Browsing the picker stops after 80 symbols

P2, code-confirmed. Evidence: `app/index.tsx:209-215`, `618-635`.

Filtering always slices to 80 and there is no load-more behavior. With an empty query, scrolling cannot reach the rest of the catalog; a broad query also silently drops matches. Exact search can still find a later symbol, so this is not a claim that only 80 symbols are loaded. Virtualize the full filtered catalog and provide an explicit empty-result state.

### A23. Search does not match the displayed pair notation

P2, code-confirmed. Evidence: `app/index.tsx:212`, `610-635`, `1338-1339`.

The app displays `BTC/USDT` but searches raw `BTCUSDT` with `includes()`. Pasting the displayed pair returns no results. An empty result renders only the input, which looks broken in the supplied second screenshot; that screenshot alone does not prove why QNTUSDT returned no results. Normalize separators for search and show loading/error/no matches distinctly. Keep exchange symbol IDs unchanged for API calls.

### A24. Automatic step changes can overwrite an in-progress edit

P2, code-confirmed. Evidence: `app/index.tsx:186-189`, `255-260`, `1269-1299`.

Before Apply, `isCustomPriceStep` remains false. A price crossing a tier boundary changes `automaticPriceStepInput`, which overwrites both the draft and applied value. Around 100, for example, the automatic step changes between 0.1 and 1 and can oscillate. Set the initial default from the first valid instrument price; keep a focused/dirty draft independent, and make later automatic adjustments stable and deliberate.

### A25. Step input silently changes meaning and has no tick validation

P2, code-confirmed. Evidence: `app/index.tsx:532-545`, `643-652`, `1327-1335`.

Malformed pasted `1.2.3` is silently rewritten to `1.23`; `-1` becomes positive `1`. Invalid zero input silently resets the setting. Values below tick size or steps exceeding the whole coin price are accepted, potentially producing zero bid buckets. Input is capped at eight fractional digits without consulting metadata. Custom mode also compares strings: `200.0` is custom while numerically identical `200` is automatic. Validate numeric meaning and supported precision, preserve a valid draft on failure, and normalize by value.

### A26. Cross-quote prices and small quantities lose essential precision

P1 for price correctness, code/formula-confirmed. Evidence: `app/index.tsx:1342-1360`.

Any symbol containing BTC or ETH gets only two decimals, even `ETHBTC`. Formula check: 0.03567 displays as `0.04`. The same rule can render a valid custom step as `0.00`. Small positive quantities round to `0.0000`, and very large quantities have only a `k` abbreviation, risking overflow. Preserve price precision from tick size and quantity precision from lot metadata; clearly distinguish nonzero values below display precision. This extends A9 beyond micro-priced USDT tokens.

### A27. Depth bars distort sizes below one unit

P2, formula-confirmed. Evidence: `app/index.tsx:504-506`, `799-801`.

The scale maximum is forced to at least 1, and every nonempty bar is forced to at least 1%. Quantities 0.001 and 0.005 both render at 1%, despite a 5x difference. With an actual largest size 0.2, the largest bar reaches only 20%. Normalize to the actual positive maximum and treat any minimum visible marker separately from the proportional fill.

### A28. Far depth is incomplete, yet totals imply complete coverage

P1 for data interpretation, code-confirmed limitation. Evidence: `app/index.tsx:1005-1038`, `1153-1205`.

REST loads a finite number of price levels, not a fixed percentage/price range. Binance diff updates can subsequently introduce prices outside the initial boundary while unchanged prices there remain unknown. Bucketing those scattered prices produces incomplete distant bucket totals. Increasing `MAX_VISIBLE_ROWS` to 120 only changes display capacity; it cannot widen snapshot coverage or reconstruct unknown orders. Track fully covered price boundaries and partially covered edge buckets. Do not show an isolated distant update as proof of a complete price interval. Reconnects can legitimately remove previously observed far levels; indicate coverage instead of retaining unverified old depth.

### A29. Small steps can push the current market far below the first screen

P2, code-confirmed layout behavior. Evidence: `app/index.tsx:757-787`, `1619-1622`.

The highest displayed ask is the first row, with up to 120 asks before the spread. At 28 points per row this puts the spread roughly 3,360 points down the list. No initial centering, price anchor, or scroll restoration exists; inserting/removing asks also moves the spread relative to the viewport. Check a fine step producing 120 ask buckets, then change the step and switch tabs. Preserve manual scrolling while anchoring the initial/current-market view and retaining a stable visible price across updates.

### A30. Old ratio data is relabeled as a new asset or exchange

P1, code-confirmed. Evidence: `app/index.tsx:459-472`, `825-867`.

Loading changes only `status`, preserving both old arrays. Switching between two supported symbols/venues changes labels immediately while the previous series remains visible; if the new request fails, it stays indefinitely. A switch from Binance to Bybit can temporarily display Binance top-trader data under Bybit. Key ratio data by venue/symbol/metric and never render data with mismatched identity.

### A31. Account ratio is labeled as position-size ratio

P1 for metric correctness, confirmed against endpoint definitions. Evidence: `app/index.tsx:845-851`, `1044-1057`.

The global Binance endpoint returns account-count ratios, but the UI calls them All Positions and labels the bars Long/Short Position %. It is a different statistic from top-trader position sizes. Preserve both series, label each metric accurately, and retain each venue's definition. See [Binance metric definitions](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio) and [Bybit ratio fields](https://bybit-exchange.github.io/docs/v5/market/long-short-ratio).

### A32. One failed ratio endpoint suppresses the other successful series

P2, code-confirmed. Evidence: `app/index.tsx:1044-1057`.

Binance top and global requests share one all-or-nothing success check and one status. If one fails or its JSON is malformed, the successful series is discarded too. Track each metric's loading/error/unsupported state independently. Check one 200 response and one 429/403 response; the successful current series should remain available.

### A33. Ratio view mixes Spot selection with Futures availability

P2, code-confirmed. Evidence: `app/index.tsx:180-208`, `477-481`, `569-595`, `1042-1062`.

The picker and first Not found checks use the selected market, but ratios always use Futures. In Spot mode a valid futures-only symbol can show a Not found banner alongside valid futures ratio data. Conversely, a failed futures catalog can produce empty charts without a useful reason while Spot remains available. Bind the ratio picker/notices to futures support while retaining the user's separate Book market selection. Do not silently reset the symbol to BTC.

### A34. Top-trader ratio has no readable numeric value or time context

P2, code-confirmed feature gap. Evidence: `app/index.tsx:825-826`, `864-865`, `881-942`.

The only numeric ratio summary reads `global`; top-trader ratio exists only as unlabelled dots. Neither chart shows sample timestamps or a ratio axis, so its time span, latest observation age, and top ratio cannot be read. Display the latest value and timestamp for each series within the existing sections. Keep the requested fixed interval and do not reintroduce a range selector.

### A35. Chart width exceeds common iPhone viewports

P2, layout risk confirmed by dimensions; screenshot verification pending. Evidence: `app/index.tsx:1682`, `1707-1734`.

Thirty columns at width 7 with 29 gaps of 5 consume 355 points. Adding the 48-point axis inset and 32 points of section padding requires 435 points, wider than a 428-point iPhone 13 Pro Max viewport and smaller iPhones. Fixed bars can intrude into the labels/edges. Size bars and gaps from measured plot width. Also check Dynamic Type, keyboard height, and iPad split view.

### A36. Ratio bars exaggerate extremes and the ratio range is distorted

P2, code-confirmed. Evidence: `app/index.tsx:884-885`, `912-921`, `1079-1086`.

Each share is given a minimum 2% height: 99%/1% becomes 99%/2%, and zero receives a visible share. The chart's min/max always include 1, compressing variation when all samples are near (for example) 1.15. A zero short share is mapped to a long/short ratio of zero, the opposite of a very large/undefined ratio. Use valid proportions, an explicit undefined-ratio state, and a labelled meaningful axis; never invent a percentage to make a segment visible.

### A37. Payload checks can admit invalid data or fail without resynchronizing

P2, defensive correctness gap. Evidence: `app/index.tsx:1017`, `1035-1038`, `1106-1168`, `1219-1225`.

Type casts do not validate JSON. Snapshot update IDs and tuple shapes are not verified; missing Bybit arrays/ID default to empty data/zero. Hydration accepts Infinity, updates accept a nonpositive finite price or infinite quantity, and ratio checks accept negative or greater-than-one shares. A malformed event can mark status offline while partially changed maps survive for the next event. Validate the complete message before applying it, distinguish empty valid books from invalid payloads, and resynchronize on invalid state. Do not require Bybit update IDs to advance by exactly one without protocol support.

### A38. Local IPA script points at a nonexistent scheme

P2, code and local project confirmed. Evidence: `scripts/build-altstore-ipa.sh:9-11`, `35-37`.

The script hardcodes `mynotesappsdk54`, while the existing native project and shared scheme are `LooksmaxingProMax`; clean generation for the current app may use another name. It fails before producing the intended IPA when the expected workspace is absent. Detect and verify the application workspace/scheme, exclude Pods and nested project workspaces, and derive the packaged executable/name from built metadata.

### A39. Existing native project still contains old app settings

P2, local configuration confirmed; installed-build impact conditional. Evidence: `ios/LooksmaxingProMax/Info.plist:9-10`, `25-32`, `48-51`; `app.json:3-5`.

The ignored local iOS project still names LooksmaxingProMax, registers its old scheme rather than `orderbook`, and contains obsolete camera/microphone descriptions. Direct builds using these files can differ from the clean GitHub prebuild. Compare generated output against app config during release preparation and remove obsolete settings through the supported generation process. This does not prove that the user's installed IPA used these stale files.

### A40. Error detail is discarded at every recovery boundary

P2, diagnostic and recovery gap. Evidence: `app/index.tsx:238-241`, `328-336`, `377-380`, `470-473`, `1048-1050`.

Catch blocks drop exception details; HTTP status is collapsed into generic UI states. Authentication/region restrictions, rate limits, malformed payloads, missing symbols, and network loss cannot be distinguished, and retries do not honor server cooldowns. Retain structured error categories and bounded development diagnostics (attempt, venue, market, last message age, snapshot latency). Keep implementation logs out of normal UI; expose a concise actionable state.

### A41. Controls lack explicit accessibility semantics

P2 for accessibility, code-confirmed; VoiceOver testing pending. Evidence: `app/index.tsx:574-605`, `610-616`, `643-655`, `701-715`.

Tabs/buttons do not specify roles or selected/expanded states. The price input's visible text label is not explicitly linked or exposed as an accessibility label. VoiceOver users cannot reliably determine selected venue/market or whether the picker is open. Add names/roles/states and predictable focus restoration when dismissing the picker; verify adequate touch targets and that live book updates do not repeatedly announce the entire table.

## Improvements and unresolved checks

- **Native dropdown hit testing:** the absolutely positioned menu extends outside a short ancestor's layout bounds (`598-637`, `1474-1516`). High z-index alone does not establish a native overlay's touch area. Test the lowest rows on iOS; if taps fall through, use a measured modal/portal with the same visual layout. This is a candidate contributor to R3, not an independently reproduced failure.
- **Catalog startup cost:** four venue/market catalogs start simultaneously, including unused venues. Each venue publishes independently, so there is no global Promise.all gate blocking the first ready book. Prioritizing the selected venue and deferring others is an optimization to measure, not proof of startup blockage.
- **Coverage scope:** current Futures means Binance USD-M and Bybit linear. Inverse/COIN-M markets are absent. Preserve this scope in the performance work and document it accurately; expanding markets is a separate feature.
- **Ratio polling:** fixed 5-minute samples are fetched every 30 seconds and always replace arrays even when unchanged. Compare series identity/timestamps before publishing. Schedule the next refresh after completion. Only reduce request frequency after verifying whether the latest sample changes within its interval.
- **Session growth:** Binance maps retain every observed positive level, including far levels, until deletions/reset. Measure level counts and heap growth. Any limit must preserve a declared complete coverage window; blindly truncating the map makes data incorrect.
- **Chart semantics:** dots are shown for a legend drawn as a line, without interconnecting segments. Either use a matching dot legend or later draw a line using an existing supported approach. Avoid adding a large chart dependency for this alone.
- **Build workflow checks:** workspace search in `.github/workflows/build-ios-ipa.yml` is recursive; ensure it selects the application workspace rather than Pods or an inner `.xcodeproj/project.xcworkspace`. Missing URL types currently log successfully because of `|| true`; verify the actual `orderbook` scheme as a release acceptance check. These are reliability gaps, not a claim that the current workflow is failing.
- **Tooling:** the first doctor's CocoaPods check failed. Verify installed Xcode/CocoaPods separately when implementing distribution fixes. No runtime speed claim follows from this tooling failure.
- **Testing gap:** no project-owned test/spec files or test script were found. Add focused protocol and lifecycle tests with the engine extraction; TypeScript alone cannot catch these races.
- **Runtime comparison:** app config uses JSC and the legacy architecture, while Expo Go may use a different runtime configuration. Measure a release build on the target phone before attributing lag to an engine. Hermes/new-architecture changes are optional later experiments with separate build validation, not prerequisites for these fixes.

## How to speed up the application

Let N be the raw levels on both sides, B the aggregated buckets, V the rows rendered, and K the changed levels in one event. The current visible path allocates/sorts roughly O(N log N), then aggregates/sorts O(N + B log B), then renders O(V) per publication. N can start around 10,000 for Binance Spot; V can reach 240 plus 80 menu options. During buffered catch-up, the raw sorting repeats for every buffered event before the final publication. These are structural costs, not measured timing estimates.

| Priority | Change | Expected benefit | Guardrail |
| --- | --- | --- | --- |
| First | Single connection owner, bounded recovery, correct synchronization | Prevents duplicate network work and repeated large snapshots | Validate sequence before exposing data |
| First | Separate controls/search/ratio state from the book subscriber | Typing and chart interactions stop rerendering with every tick | Moving code into a hook in the same screen is insufficient |
| First | Mutate raw maps outside React; publish an atomic display snapshot | Eliminates full raw arrays as screen state and coalesces bursts | Apply every delta; never debounce away data events |
| First | Aggregate directly from maps at publication, sort buckets once | Removes redundant full raw-level sorts | Obtain raw best bid/ask separately, preserve totals |
| First | Virtualize book and symbol rows; stabilize props/keys | Mount/render cost scales with the viewport | Preserve row heights, all symbols, scroll anchors and styling |
| Next | Reuse unchanged display rows and memoize components | Avoids repeated text formatting/reconciliation | Cumulative totals and changing depth scale legitimately invalidate rows |
| Next | Freeze hidden-book presentation; isolate chart calculations | Ratio tab does not render on book ticks | Continue a valid foreground raw feed or resnapshot before showing the book |
| Next | Bybit stream-first initialization | Removes serial REST dependency and redundant hydration | Wait for the authoritative stream snapshot and handle subscribe errors |
| Next | Publish only on dirty state, initially at most once per 100 ms | Bounds screen updates without slowing the current Binance cadence | Do not create 60/120 renders per second or poll unchanged state |
| Profile-gated | Incremental bucket totals using old/new quantity differences | Changes aggregation from full scans toward O(K) | Rebuild on step change/snapshot; guard rounding and quantity drift |
| Profile-gated | Prioritized catalog loading and session metadata reuse | Less startup parsing and repeat network work | Show loading until complete; refresh stale metadata |

Keep the wide initial depth: Binance Spot 5,000 levels/side, USD-M 1,000, and the currently supported Bybit 1,000 stream. Fetch depth is not the same as displayed range. Rendering fewer native views must not reduce loaded levels or available scroll rows. Preserve the user's selected symbol when switching Spot/Futures; only a complete catalog can establish Not found.

## Original implementation plan (historical)

All paths below are proposed future edits. Keep Expo Router, TypeScript, standard React Native components, current styling, exchange tabs, Book/Long-Short tabs, symbol search, and custom step Apply. No backend, account connection, or new state/chart library is needed. Small label/error corrections described above address incorrect behavior rather than redesigning the screen.

### Phase 0. Establish a comparable baseline

Effort: small. Dependencies: none. Covers R2/R4 and all performance hypotheses.

Record a release build on the user's iPhone 13 Pro Max, its actual iOS/runtime version, network, Low Power Mode, thermal state, and instrument/step. Compare with Expo Go separately. Profile cold start, first synchronized book, steady trading, typing in the picker, price-step Apply, scrolling, ratio view, network loss, and foreground resume. Use local development diagnostics and profiling tools; do not add remote analytics.

Record p50/p95 input latency, main/JS frame stalls, publication/commit counts, snapshot latency, buffer/map sizes, active sockets/timers/requests, memory, and resynchronizations. Use a fixed event replay later for repeatable comparisons; production live feeds alone are not reproducible benchmarks. Exit: saved baseline observations and an agreed data fixture for each venue/market.

### Phase 1. Repair input and picker behavior

Effort: small to medium. Dependencies: none; can precede engine work. Covers R1/R3, A22-A25, A35/A41 and dropdown hit-testing risk.

Extract `src/components/SymbolPicker.tsx` and `src/components/PriceStepInput.tsx`; keep their current appearance. Give search and draft-step edits local state. Add explicit dismissal on Apply, selection, outside tap, view change, and backgrounding; preserve first-tap selection. Disable symbol autocorrect/spellcheck, normalize search separators, render all matches using FlatList, and display empty/loading states. Use keyboard-aware available height and a real overlay if native hit testing requires it. Add accessibility names/states and return focus to the opening control.

Separate a focused/dirty draft from the applied numeric value and automatic mode. Validate before Apply; keep invalid text editable with a compact error. Freeze the default during typing. Exit: automated state checks plus physical-device keyboard/picker checks, including no results, rapid tabs, and tapping low menu rows.

### Phase 2. Make stream ownership and synchronization correct

Effort: large; highest-risk work. Dependencies: Phase 0 baseline; independent of most Phase 1 work. Covers R2, A1/A2/A4/A5/A7, A16-A19, A37/A40.

Extract exchange protocol adapters into `src/market/binance.ts` and `src/market/bybit.ts`, an HTTP helper into `src/market/http.ts`, and lifecycle ownership into `src/market/orderBookSession.ts` plus `src/hooks/useOrderBook.ts`. Keep the two venue protocols explicit. Each session has an instrument identity, monotonically changing generation, at most one owned socket, snapshot request, reconnect timer, heartbeat timer, and publication timer.

Every callback validates generation and disposed state; every new attempt begins unsynchronized. Abort old requests, close old transports, and clear owned timers before retrying. Start with configurable 15-second HTTP/connection deadlines and a buffer age/count cap (for example 15 seconds or 1,000 events, whichever is reached first); tune from the baseline. If a cap is hit, discard that synchronization attempt and retry, never truncate deltas into a supposedly valid book. Use exponential backoff with jitter, a ceiling, and server rate-limit cooldowns. Reset backoff after a stable synchronized connection.

Binance Spot: buffer, fetch snapshot, discard superseded events, establish continuity, replay once, and atomically publish. A gap aborts replay. Futures: apply its documented snapshot bridging rule including equality at the boundary, then validate each subsequent `pu`, buffered or live. Bybit: subscribe immediately, validate acknowledgement/topic/symbol and wait for a stream snapshot, then apply deltas and replacement snapshots. Handle duplicate/stale messages using documented IDs; do not assume consecutive integer IDs across all protocols. Publish LIVE only after synchronization.

Observe AppState. Close network work in background and start a fresh generation on return, retaining only same-instrument display data marked stale until revalidated. A missed heartbeat/connection deadline triggers recovery; use venue-specific liveness so a quiet symbol is not repeatedly disconnected just because there are no order changes. Inspect error category before retrying. Exit: deterministic delayed-response, gap, teardown, timeout, and reconnection tests; zero old-generation mutations and no more than one owned active session.

### Phase 3. Fix numeric accuracy, identity, and depth coverage

Effort: medium to large. Dependencies: Phase 2 adapters. Covers A3/A9-A11/A24-A28/A37.

Retain base/quote assets, tick size, lot precision, and contract information from catalogs. Add `src/market/priceMath.ts` and `src/market/orderBook.ts` for validated raw maps and presentation projection. Use decimal-string parsing into safe integer tick units; check safe-integer bounds explicitly. Use an exact wider representation only where bounds require it and verify its SDK 54/JSC support. Do not fix boundaries with an arbitrary epsilon.

Select a tick-aligned default from the first valid price: retain representative BTC=200 and a 0.1-priced coin approximately 0.01, but extend below 0.0001 and support non-USDT quotes. Freeze the initial default for the instrument session; custom steps remain user-controlled. Format price and quantity from metadata, calculate spread/mid from raw best levels, and normalize bars using the actual maximum.

Atomically associate snapshot, status, update ID, step, and coverage with venue/market/symbol. Preserve stale data only for that same identity. Mark partially known depth accurately; do not claim that 120 rows widen source coverage. Exit: exact-boundary, small-price, cross-quote, quantity, partial-depth, zero-side, and symbol-switch tests, including the arithmetic cases in this report.

### Phase 4. Reduce rendering and computation

Effort: medium to large. Dependencies: Phases 2-3. Covers R4/A13/A14/A27-A29/A35 and performance opportunities.

Raw maps belong to the session, outside React state. Process every event in order and set dirty flags, then publish one coherent display snapshot on the bounded cadence. Aggregate directly from maps and sort buckets only; do not sort thousands of raw entries merely to aggregate them again. Replay buffered updates before publishing once. Reuse unchanged row objects and formatted values; keep the fast-changing update ID in a small subscribed view.

Extract `src/components/OrderBookView.tsx`, memoized `BookRow.tsx`, and independent `LongShortView.tsx`. Place book subscription state at the book boundary rather than in the screen that owns the inputs. Split status publication from row publication when needed. Use one FlatList for asks/spread/bids, stable instrument/side/tick keys, appropriate initial/window sizes, and measured row layout. Only use fixed `getItemLayout` values when Dynamic Type and the spread row are accounted for. Keep viewport anchors stable during updates and expose best levels initially without fighting manual scroll.

While Long/Short is visible, the default plan retains one valid foreground raw feed for fast tab return but stops book projection/publication and all chart renders caused by book events. Backgrounding closes it. If profiling shows idle foreground network/CPU remains excessive, evaluate disconnecting the hidden stream with a fresh snapshot on return as a separate tradeoff, without showing stale data as live.

Start with a maximum publication rate of 10 Hz for the current Binance feed and naturally at most 5 Hz for Bybit's 1,000-level feed. Coalesce bursts only at presentation; never drop required deltas. RequestAnimationFrame may align an already-due publication, not drive a continuous render loop. Avoid deep equality of every raw book on every event. Add incremental bucket maintenance only if full scans remain a measured bottleneck, using quantity differences and a full rebuild on snapshot/step changes.

Exit: input edits do not render book rows; book ticks do not render picker/ratio sections; mounted book rows scale with the viewport; loaded data coverage and totals match an independently verified straightforward projection, not the current buggy rounding formulas.

### Phase 5. Recover catalogs and correct ratio behavior

Effort: medium. Dependencies: Phase 2 HTTP ownership and Phase 3 metadata. Covers A6/A8/A12/A20-A23/A30-A36/A40.

Add `src/hooks/useInstruments.ts` and `src/hooks/useLongShort.ts` with bounded request lifetimes. Prioritize the selected catalog, retain complete session metadata, refresh on expiry/resume, reject partial pagination, and prevent repeated cursors. Separate loading, transient failure, actual unsupported capability, and absent symbol. Preserve selection across exchange/market changes; do not automatically fall back to BTC.

Key ratio state by venue/symbol/metric/period. Use per-series success/error handling, schedule refresh after completion, and avoid publishing identical arrays. Render only matching identity; retain stale data for the same identity with a freshness indicator. Correct global-account versus top-position labels, show the latest value/time for each, and state the Bybit top-series limitation honestly. Keep 5-minute sampling fixed with no interval/range selector. Ensure ratio selectors/notices represent Futures, while returning to Book restores its prior market.

Make chart widths responsive, preserve real shares including zero, define unavailable ratios explicitly, and supply readable time/ratio context within the current sections. Exit: independent endpoint-failure tests, out-of-order response tests, paginated catalog error tests, accurate labels, and small-screen/accessibility checks.

### Phase 6. Validate the native build and finish regression testing

Effort: medium. Dependencies: previous phases for the final build; dependency checks can be prepared earlier. Covers A15/A38/A39 and release gaps.

Review SDK 54-compatible direct Router peers and patch versions, then update package manifest/lockfile together. Verify native autolinking and CocoaPods; do not infer that a passing Expo Go session validates a standalone build. Reconcile the existing iOS configuration using the project's prebuild process, preserving intended bundle identity and any intentional native changes. Verify name, icon, URL scheme, runtime, executable, and bundled JavaScript in the actual IPA.

Fix workspace/scheme discovery in the local IPA script and workflow. Keep code/performance fixes separate from an optional runtime migration to make regressions attributable. Run the release app through network interruption, background/resume, and sustained market updates on the physical phone. Exit: functional acceptance table below passes, no new doctor failures attributable to the change, and baseline comparisons document actual improvements and remaining limitations.

## Verification targets and acceptance matrix

Targets below are proposed acceptance goals, not measured results or promised speedups. Record before/after on the same phone/build mode and repeat using deterministic replay. A 60 Hz frame budget is about 16.7 ms and a 120 Hz budget about 8.3 ms; record actual refresh behavior instead of assuming ProMotion always runs at 120 Hz.

| Scenario | Acceptance condition |
| --- | --- |
| Input and menu | p95 input-to-visible-feedback under 100 ms during replay; Apply/selection/outside tap dismiss reliably; no book renders caused by each keystroke |
| Data correctness | Every required delta applied exactly once in order; displayed rows equal the reference projection; gaps never produce LIVE |
| Regular feed | At most 10 book publications/sec at the initial setting; no idle publications; normal live delivery visible within 250 ms after receipt (target) |
| Heavy update burst | Latest consistent state published without replaying every intermediate screen state; no repeated JS tasks over 50 ms attributable to book processing in steady replay |
| Scroll | Responsive scrolling with bounded mounted rows; initial view includes best levels; manual anchor remains stable across deltas |
| Foreground recovery | After connectivity is restored, synchronize within connection + snapshot deadlines; show stale/reconnecting until verified; no force quit required |
| Resource lifecycle | One owned socket and retry chain per session; zero owned sockets/requests/timers after disposal; capped synchronization buffers |
| Soak | 30-minute replay plus 50 symbol/tab switches and 20 background/resume cycles; no continuing growth in abandoned sessions, listeners, timers, or buffers; document raw-map growth separately |
| Catalog | All matches can be browsed; temporary failure can recover; a partial catalog never proves Not found |
| Numeric cases | Exact 0.3/0.1 bid and 0.07/0.01 ask boundaries; micro prices; ETHBTC; custom fractional steps; quantities below 0.0001; zero short share |
| Ratios | Each series retains correct venue/symbol identity, metric label and timestamp; one failed endpoint does not erase the other |
| Native release | Correct OrderBook metadata and scheme; launch/resume verified in the installed release IPA as well as Expo Go |

Tests should target real failure sequences: obsolete snapshot response after reconnect; two scheduled retries; cleanup before a timer fires; a buffered gap; failed subscription; server snapshot reset; hung fetch; rate limit; later-page catalog error; ratio responses arriving out of order. Use fake transport and fake time for those tests when implementation starts. No test scaffolding has been added in this audit.

## Suggested regression checks

- Open the symbol picker, type, select a result, tap outside, switch tabs, background/foreground, and verify both keyboard and picker state every time.
- Background for 10 seconds, 2 minutes, and 10 minutes on Wi-Fi and cellular; verify a fresh snapshot and valid venue-specific sequence continuity after every resume. Account for documented server resets instead of requiring update IDs to increase across every new session.
- Disable network during snapshot loading for 30 seconds, restore it, and confirm there is exactly one socket and one retry chain.
- Rapidly switch Binance/Bybit, Spot/Futures, and symbols; ensure no old prices appear under a new label.
- Test a high-price symbol, a sub-dollar symbol, and a micro-priced symbol against exchange tick sizes.
- Keep Book open for 30 minutes and compare JS frame rate, memory, socket count, and update latency at start/end.
- Keep Long/Short open and verify hidden order-book updates do not cause screen renders.
- Force catalog and ratio requests to timeout, return 429, and return malformed JSON; verify recovery without restarting.

## Reference documentation

- Expo SDK 54 reference: https://docs.expo.dev/versions/v54.0.0/
- React Native 0.81 AppState: https://reactnative.dev/docs/0.81/appstate
- React Native 0.81 Keyboard: https://reactnative.dev/docs/0.81/keyboard
- React Native 0.81 ScrollView performance notes: https://reactnative.dev/docs/0.81/scrollview
- Binance Spot local order book procedure: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
- Binance USD-M futures local order book procedure: https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly
- Binance Spot order-book request weights: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#order-book
- Bybit WebSocket connection/heartbeat guidance: https://bybit-exchange.github.io/docs/v5/ws/connect
- Bybit order-book snapshot/delta rules: https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook
