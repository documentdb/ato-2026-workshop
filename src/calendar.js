import { WorkshopError } from "./errors.js";

export function escapeCalendarText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

export function foldCalendarLine(line) {
  const parts = [];
  let current = "";
  for (const character of line) {
    if (Buffer.byteLength(current + character, "utf8") > 75) {
      parts.push(current);
      current = " ";
    }
    current += character;
  }
  parts.push(current);
  return parts.join("\r\n");
}

function timestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new WorkshopError(422, "INVALID_CALENDAR_TIME", "A favorite has an invalid session time.");
  }
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function createCalendar(sessions, catalog, now = new Date()) {
  if (sessions.length === 0) {
    throw new WorkshopError(400, "NO_FAVORITES", "Save at least one favorite before exporting.");
  }
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ATO DocumentDB Workshop//Session Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const session of sessions) {
    const prefix = catalog.kind === "practice" ? "[PRACTICE - NOT ATO SCHEDULE] " : "";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${session.id}@ato-2026-workshop.invalid`,
      `DTSTAMP:${timestamp(now)}`,
      `DTSTART:${timestamp(session.startsAt)}`,
      `DTEND:${timestamp(session.endsAt)}`,
      `SUMMARY:${escapeCalendarText(prefix + session.title)}`,
      `LOCATION:${escapeCalendarText(session.room)}`,
      `DESCRIPTION:${escapeCalendarText(`${catalog.title}\nSchedule snapshot: ${catalog.snapshotDate}\n${catalog.kind === "official" ? "Times cover the published program block. Multiple talks may run in sequence within this window. A favorite is not event registration.\n" : ""}Check the official source for updates: ${session.url}`)}`,
      `URL:${session.url}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldCalendarLine).join("\r\n") + "\r\n";
}
