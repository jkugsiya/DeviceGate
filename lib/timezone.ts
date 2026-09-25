/**
 * Calendar maths in the gateway's timezone. Quota days start at local midnight, weeks on Monday,
 * and the admin shows times in this zone. Set `TIMEZONE` to an IANA name ("Europe/Berlin");
 * without it the server's own zone is used.
 *
 * Days are named by `YYYY-MM-DD` keys and converted to instants per zone, never by adding 24 h,
 * so a day that DST makes 23 or 25 hours long still starts and ends at local midnight.
 */

export const TIME_ZONE = resolveTimeZone(process.env.TIMEZONE);

function resolveTimeZone(name: string | undefined): string {
  if (!name) return Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`TIMEZONE="${name}" is not a valid IANA timezone (e.g. "Europe/Berlin")`);
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The zone's wall-clock time at `at`, read back as if it were UTC. */
function wallClock(at: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(at)) p[type] = Number(value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** `YYYY-MM-DD` of the local day containing `at`. */
export function dayKey(at: number, tz = TIME_ZONE): string {
  return new Date(wallClock(at, tz)).toISOString().slice(0, 10);
}

/** Epoch ms of local midnight on the day `key`. */
export function dayStartOf(key: string, tz = TIME_ZONE): number {
  const midnight = Date.parse(`${key}T00:00:00Z`);
  // First guess uses the offset at UTC midnight; the second corrects it if that guess landed on
  // the other side of a DST change.
  let t = midnight - (wallClock(midnight, tz) - midnight);
  t = midnight - (wallClock(t, tz) - Math.floor(t / 1000) * 1000);
  return t;
}

/** Epoch ms of local midnight on the day containing `at`. */
export function dayStartAt(at: number, tz = TIME_ZONE): number {
  return dayStartOf(dayKey(at, tz), tz);
}

export const HOUR_MS = 3_600_000;

/**
 * Epoch ms of the start of the local hour containing `at`. Not simply a multiple of an hour: in a
 * +05:30 zone local hours begin at :30 UTC.
 */
export function hourStartAt(at: number, tz = TIME_ZONE): number {
  const offset = wallClock(at, tz) - Math.floor(at / 1000) * 1000;
  const local = at + offset;
  return at - (((local % HOUR_MS) + HOUR_MS) % HOUR_MS);
}

/** The day key `n` days after `key` (negative goes back). */
export function addDays(key: string, n: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Days since Monday for a day key: Monday is 0, Sunday is 6. */
export function weekdayFromMonday(key: string): number {
  return (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Short zone label for table headers, e.g. "GMT+5:30" or "EDT". */
export function zoneLabel(at = Date.now(), tz = TIME_ZONE): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? tz
  );
}
