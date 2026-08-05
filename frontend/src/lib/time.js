// Frontend time helpers.
//
// The backend stores absolute instants (inAt/outAt/createdAt) in UTC and
// date-only columns (timesheet.date etc.) as UTC-midnight of the IST calendar
// day. Formatting must therefore be explicit:
//   - instants  → format in IST (Asia/Kolkata)  → fmtIST()
//   - date-only → format in UTC                 → fmtDateUTC()
// This keeps the UI correct regardless of the viewer's browser timezone.

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const IST = 'Asia/Kolkata';

/** Format an absolute instant (UTC Date/ISO string) in IST. */
export const ist = (d) => dayjs(d).tz(IST);

/** Format a date-only value (UTC-midnight of the IST day) in UTC. */
export const dayUTC = (d) => dayjs(d).utc();

/** Punch/instant time, e.g. '09:15 AM'. Falls back to '-'. */
export const fmtIST = (d, fmt = 'hh:mm A') => (d ? ist(d).format(fmt) : '-');

/** Date-only column, e.g. '05 Aug 2026'. Falls back to '-'. */
export const fmtDateUTC = (d, fmt = 'DD MMM YYYY') => (d ? dayUTC(d).format(fmt) : '-');

/** Instant with full date + time in IST, e.g. '05 Aug 2026, 09:15 AM'. */
export const fmtDateTimeIST = (d, fmt = 'DD MMM YYYY, hh:mm A') => (d ? ist(d).format(fmt) : '-');
