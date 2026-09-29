# v1.0 live-data audit — 2026-09-30 JST

Base: GitHub main `c318a8472788852e6ac3e7983147dc974457dcc8`.

## Causes found and changes

- The old before endpoint awaited optional venue exhibition together with standard beforeinfo. A slow optional source delayed all standard times/ST. Standard before now has its own source job; live responses stream completed families independently.
- Home oracle, deadline prewarming, detail fetching, and result summaries had separate fetch paths. They now share the same browser race store and source inflight jobs. Detail critical data uses one NDJSON request rather than separate base/before/odds/series requests. Auxiliary analytics/course requests remain independent and delayed.
- Official racelist supplies both card and series. Its origin request is shared. Same official URL is coalesced regardless of the caller's TTL.
- Legacy core could serve exhibition with CDN stale-while-revalidate. Race-live, snapshots, calendar, before and core now bypass CDN response caching; short positive source reuse happens in app-scoped Runtime Cache.
- Empty, partial and malformed exhibition responses are not reused as positive cache hits. A failed refresh keeps the previous observed timestamp and disables live prediction.
- Beforeinfo is parsed from explicit current start-exhibition boat nodes and labelled timing columns. Previous-run ST is never substituted. F/L remain labelled events, not fabricated signed start values.
- BOATCAST metrics are selected by declared labels. Valid partial fields survive, with incomplete status. Kiryu half-lap has its own label/range. Optional straight is not required at Suminoe, Tokuyama or Amagasaki.
- Numeric-order guessing was removed from strict venue fallbacks. Mutable venue pages without verified date identity are not used when the date-bound feed is unavailable.
- Card boat registration/number mapping is verified. UI, model and pre-race predictions share six times plus six ST readiness. Old/failed core sources block prediction. Original stale values are excluded individually from the composed race.
- Series is displayed at all venues. Results remain visible when prediction is unavailable. Historical verification stops before/odds polling after initial loading.

## Cache and polling

| Family | Positive source reuse | Client maximum age for live use | Active polling |
| --- | --- | --- | --- |
| card | 60s | 180s | 120s |
| series | 60s | 180s | 60s |
| before | 10s | 60s | waiting 15s within 15min / 20s within 30min; completed 45s; far 120s |
| original | 20s | 90s | near 45s; far 180s |
| odds | 20s | 90s | near 30s; far 60s |
| result | 20s | 120s | 30s after closing, stop at published |
| schedule | 120s | used with identity/date | 120s |

Runtime cache retains snapshots up to six hours but reuse/freshness is governed by the shorter per-source rules above. Browser session cache is versioned and keyed by exact date/venue/race. Hidden pages pause updates. Home warms six nearest upcoming races, with at most three race requests running concurrently. Full 24×12 races are not continuously fetched.

## Captured official-data checks

`venue-audit-20260930.json` records source URLs and counts for all 24 venues. Twelve venues used 2026-09-29 12R; nonhosting venues used the last completed event date linked by the official monthly schedule. All 24 have six verified card entries and six parsed series entries. Twenty-three races have six standard times/ST and 120 odds. Marugame 2026-09-29 12R has official boat 5 withdrawal, five times/ST and 60 odds: prediction correctly stops, without filling missing values. Miyajima has five finishers in the official result despite six starters. Twenty-three BOATCAST originals parsed; Edogawa's keyed original returned HTTP 403, retained as a fetch failure rather than guessed unavailable data.

Real Kiryu feed declares 半周ラップ. Suminoe, Tokuyama and Amagasaki declare 一周/まわり足 with no straight column. These do not prevent standard-exhibition completion.

## Verification and measurements

- Production build passes. `node scripts/verify-live.mjs` passes ST formats, lane binding, partial original fields, freshness, deadline policies, singleflight, empty-response refetch, error timestamp preservation and nonblocking streaming.
- Local production/browser verification includes desktop Omura 12R and 390×844 mobile Marugame 12R. Mobile document width equals viewport width (390px). The latter shows five exhibition rows with the missing boat left blank, 60/120 odds, no AI final block and official result 1-2-6 / ¥270.
- Baseline production Toda 2026-09-29 12R before request took 8.704s in one observation. Local cold stream of the same race completed in 3.453s: original 0.677s, before 2.246s, card 3.248s, odds 3.444s. These are different environments and single observations, not a guaranteed speed ratio.
- Historical Omura detail critical streamed request took 3.611s cold. Cache reuse renders synchronously from browser store; still requests confirmation only when due.

## Remaining limits / release gates

- No historical/live snapshot proves a sub-one-minute delay from *actual official publication*. Official sources do not provide a verified publication timestamp here. `officialPublished` remains null; detectedAt/apiDetected and client uiUpdated record observed events only.
- Home prewarming works while visitors have an active page and Runtime Cache is shared across visitors. With zero active users, the current Hobby daily cron cannot provide continuous 15–20s autonomous polling. No paid service or invalid high-frequency Hobby cron was added. Cold races must still fetch.
- Date-unbound HTML fallback data is withheld. Dedicated date-bound HTML fallbacks are safer but every possible site layout variation is not proven by the captured BOATCAST feeds. Future unknown labels/layouts remain waiting/parse-error with no prediction from invented values.
- GitHub commit, Vercel READY, production source counts and production latency must be checked separately after publishing these changes. A local build is not evidence of production rollout.

An unconditional “all venues / all publication timings / always prewarmed with no visitors” v1.0 certification is not supported by these checks. The fixes address verified defects and must retain the above monitoring gates.
