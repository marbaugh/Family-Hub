# Changelog

## v1.1.0 — 2026-03-28

### New Features

#### Calendar Event Detail Popover
- Tap any event dot on the calendar to see a full detail card
- Shows title, date/time, location, description, and person/family tag
- Location is a tappable link that opens Google Maps directly
- Delete button in the popover
- Color bar at the top matches the event's person color
- Works for all-day, multi-day, and timed events

#### Event Location Support
- Location field now synced from Google Calendar on every sync
- Location shown in the event detail popover as a Google Maps link
- Location field added to the Add Event modal (pushed to Google Calendar)

#### Camera Fullscreen Cycling
- Opening a camera fullscreen now shows all cameras, not just one
- Prev/next arrow buttons to cycle between cameras
- Dot indicators showing current position
- Keyboard arrow keys supported
- Touch swipe gestures (left/right) supported

#### Quick-Compose Message from Dashboard
- ✏️ button on the message preview pill opens a compose modal in-place
- Post a family message without navigating away from the dashboard

#### Tomorrow's Weather Forecast
- Dashboard weather widget now shows tomorrow's high/low and precipitation chance
- Powered by Open-Meteo (free, no API key required)

#### Dashboard Auto-Refresh
- Dashboard refreshes events, chores, lunch, weather, and messages every 5 minutes
- No manual reload needed on a wall-mounted display

#### PWA / Home Screen Install
- Added `manifest.json` with app icons
- Install Family Hub to your tablet's home screen via browser
- Launches full-screen in landscape with no browser chrome

### Improvements
- Stock ticker restyled as a slim banner (was a full-width card taking too much space)
- Message preview pill always visible; separated compose (✏️) from navigate (tap text)

### Bug Fixes
- **Chore duplication**: Each recurring chore was showing 2–3× on the chores page. Root cause: `isTodayChore` used `due_date <= today` matching all past instances. Fixed to `due_date === today`.
- **Chore streaks at night**: Streaks showed 0 after ~8 PM because `datetime.utcnow()` returned the next UTC day. Fixed by using the configured app timezone throughout the streak calculation.
- **Alarm buttons cut off**: "Arm Away" button was clipped on smaller screens. Fixed with `flex-wrap` on the alarm button row.
- **Dark mode garage cards**: Garage/alarm state cards had hardcoded white backgrounds in dark mode. Fixed with `rgba()` tint overrides in the dark theme.

---

## v1.0.0 — 2026-03-24

Initial release.

### Features
- Dashboard with Up Next events, Chores Today, Lunch Menu, weather, stocks, and HA status
- Calendar with Google Calendar sync (family + per-member)
- Chores with recurrence, points, streaks, and Chore Champions leaderboard
- Family Messages board (sticky-note style, 7-day auto-expire)
- Security page with HA camera feeds (MJPEG proxy), garage door control, alarm panel
- Dark mode (time-based auto-switch) and Auto-dim (inactivity overlay)
- Settings: family members, Home Assistant, timezone, weather, lunch, stocks, slideshow, Google Calendar
- Photo slideshow with upload and configurable interval
- PWA-ready (manifest + icons)
