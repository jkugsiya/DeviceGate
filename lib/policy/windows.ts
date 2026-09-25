import { addDays, dayKey, dayStartOf, TIME_ZONE, weekdayFromMonday } from "../timezone";

// Quota windows in the gateway's timezone (see lib/timezone.ts).
// Day = local 00:00–24:00, week = Monday 00:00 onward. All values are UTC epoch ms.
export type Windows = { dayStart: number; nextDay: number; weekStart: number; nextWeek: number };

// Every proxied request asks for its windows; they only change at midnight.
let last: { tz: string; w: Windows } | undefined;

export function windowsAt(now: number, tz = TIME_ZONE): Windows {
  if (last && last.tz === tz && now >= last.w.dayStart && now < last.w.nextDay) return last.w;
  const day = dayKey(now, tz);
  const week = addDays(day, -weekdayFromMonday(day));
  const w = {
    dayStart: dayStartOf(day, tz),
    nextDay: dayStartOf(addDays(day, 1), tz),
    weekStart: dayStartOf(week, tz),
    nextWeek: dayStartOf(addDays(week, 7), tz),
  };
  last = { tz, w };
  return w;
}
