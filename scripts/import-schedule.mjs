import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { validateCatalog } from "../src/catalog.js";
import { WorkshopError, reportError } from "../src/errors.js";

export const SCHEDULE_URL = "https://2026.allthingsopen.org/schedule";
export const TIME_ZONE = "America/New_York";

function invalid(message) {
  throw new WorkshopError(422, "INVALID_SCHEDULE_SOURCE", message);
}

function dayDate(text) {
  const match = /^October (18|19|20), 2026$/.exec(text);
  if (!match) invalid(`Unexpected conference date: ${text}. Review the source before importing.`);
  return `2026-10-${match[1]}`;
}

export function publishedTimeToUtc(date, time) {
  if (!/^2026-10-(18|19|20)$/.test(date)) invalid("Only the published 2026 conference dates are supported.");
  const match = /^(1[0-2]|[1-9]):([0-5]\d) ([ap]m)$/.exec(time);
  if (!match) invalid(`Unrecognized published clock time: ${time}.`);
  const hours = Number(match[1]) % 12 + (match[3] === "pm" ? 12 : 0);
  const hh = String(hours).padStart(2, "0");
  const result = new Date(`${date}T${hh}:${match[2]}:00-04:00`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(result).map((part) => [part.type, part.value]));
  if (`${parts.year}-${parts.month}-${parts.day}` !== date || parts.hour !== hh || parts.minute !== match[2]) {
    invalid("The UTC conversion did not round-trip to the published Eastern time.");
  }
  return result.toISOString();
}

function sourceSession(session) {
  if (!session || !Number.isSafeInteger(session.id) || session.id <= 0) {
    invalid("Every source session needs its published numeric identifier.");
  }
  for (const key of ["title", "url", "track"]) {
    if (typeof session[key] !== "string" || !session[key].trim()) {
      invalid(`Published session ${session.id} has no ${key}.`);
    }
  }
  let link;
  try {
    link = new URL(session.url);
  } catch {
    invalid(`Published session ${session.id} has an invalid link.`);
  }
  if (link.origin !== "https://2026.allthingsopen.org" || link.username || link.password || link.hash) {
    invalid(`Published session ${session.id} has an unexpected link origin or credentials.`);
  }
  if (session.room !== null && (typeof session.room !== "string" || !session.room.trim())) {
    invalid(`Published session ${session.id} has an invalid room field.`);
  }
  return session;
}

export function buildScheduleCatalog(snapshot) {
  if (snapshot?.sourceUrl !== SCHEDULE_URL ||
      !Array.isArray(snapshot.timezoneLabels) ||
      snapshot.timezoneLabels.length !== 1 || snapshot.timezoneLabels[0] !== "US/ET") {
    invalid("Expected the full official schedule with its published US/ET timezone.");
  }
  const retrievedAt = new Date(snapshot.retrievedAt);
  if (!Number.isFinite(retrievedAt.getTime()) || typeof snapshot.retrievedAt !== "string" ||
      !snapshot.retrievedAt.endsWith("Z")) invalid("The source needs a valid UTC retrieval timestamp.");
  if (!Array.isArray(snapshot.days) || snapshot.days.length === 0) invalid("The source has no schedule days.");

  let sourceRows = 0;
  let duplicateRows = 0;
  const occurrences = new Map();
  const excluded = [];
  const sections = [];
  for (const day of snapshot.days) {
    const date = dayDate(day.date);
    if (!Array.isArray(day.sections) || !day.sections.length) invalid(`No schedule sections on ${date}.`);
    for (const section of day.sections) {
      if (!Number.isSafeInteger(section.id) || !section.name || !Array.isArray(section.blocks)) {
        invalid(`Invalid schedule section on ${date}.`);
      }
      let sectionRows = 0;
      for (const block of section.blocks) {
        const startsAt = publishedTimeToUtc(date, block.start);
        const endsAt = publishedTimeToUtc(date, block.end);
        if (!Array.isArray(block.sessions)) invalid(`Missing session array in ${section.name}.`);
        for (const item of block.sessions) {
          const session = sourceSession(item);
          sourceRows++;
          sectionRows++;
          if (sourceRows > 2000) invalid("The source exceeds the bounded schedule import size.");
          if (endsAt <= startsAt) {
            excluded.push({
              sourceId: session.id, title: session.title, url: session.url,
              date, section: section.name, start: block.start, end: block.end,
              reason: "The published end is not after the start on this date; no overnight rollover or typo correction was inferred.",
            });
            continue;
          }
          const row = {
            sourceId: session.id, date, title: session.title, url: session.url,
            room: session.room, track: session.track, startsAt, endsAt,
          };
          const key = JSON.stringify([session.id, date, startsAt, endsAt]);
          const previous = occurrences.get(key);
          if (previous) {
            if (JSON.stringify(previous) !== JSON.stringify(row)) {
              invalid(`Conflicting cross-listings for session ${session.id} on ${date}; choose neither silently.`);
            }
            duplicateRows++;
          } else {
            occurrences.set(key, row);
          }
        }
      }
      sections.push({ date, name: section.name, sourceRows: sectionRows });
    }
  }
  if (!Number.isSafeInteger(snapshot.renderedRowCount) || sourceRows !== snapshot.renderedRowCount) {
    invalid("Captured source rows do not match the rendered full schedule. Capture again without a filter.");
  }

  const ordered = [...occurrences.values()].sort((a, b) =>
    a.sourceId - b.sourceId || a.date.localeCompare(b.date) ||
    a.startsAt.localeCompare(b.startsAt) || a.endsAt.localeCompare(b.endsAt));
  const counters = new Map();
  const sessions = ordered.map((row) => {
    const key = `${row.sourceId}-${row.date}`;
    const slot = (counters.get(key) || 0) + 1;
    counters.set(key, slot);
    return {
      id: `ato-2026-${row.sourceId}-${row.date.replaceAll("-", "")}-${slot}`,
      title: row.title,
      room: row.room ?? "Room not listed",
      track: row.track,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      url: row.url,
    };
  });
  const missingRooms = ordered.filter((row) => row.room === null).length;
  const snapshotDate = retrievedAt.toISOString().slice(0, 10);
  const report = {
    sourceUrl: snapshot.sourceUrl, retrievedAt: snapshot.retrievedAt,
    sourceRows, duplicateRows, importedOccurrences: sessions.length,
    uniqueSourceSessions: new Set(ordered.map((row) => row.sourceId)).size,
    roomsNotListed: missingRooms, sections, excluded,
  };
  const catalog = {
    kind: "official",
    title: "All Things Open 2026",
    timeZone: TIME_ZONE,
    version: `ato-2026-${retrievedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
    source: `${SCHEDULE_URL} - ${sessions.length} published schedule entries. Times are program-block windows, not guaranteed individual talk durations. ${missingRooms} entries have no published room. ${excluded.length} invalid time range(s) excluded; see the import report.`,
    snapshotDate,
    sessions,
  };
  validateCatalog(catalog);
  return { catalog, report };
}

async function main() {
  if (process.argv.length !== 2) {
    invalid("This offline importer reads data/schedule-source.json; it takes no arguments and performs no network requests.");
  }
  const snapshot = JSON.parse(await readFile(new URL("../data/schedule-source.json", import.meta.url), "utf8"));
  const { catalog, report } = buildScheduleCatalog(snapshot);
  await writeFile(new URL("../data/catalog.json", import.meta.url), JSON.stringify(catalog, null, 2) + "\n");
  await writeFile(new URL("../data/schedule-import-report.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    reportError(error);
    if (error instanceof WorkshopError) console.error(error.message);
    process.exitCode = 1;
  });
}
