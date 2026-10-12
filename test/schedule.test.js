import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildScheduleCatalog, publishedTimeToUtc, SCHEDULE_URL } from "../scripts/import-schedule.mjs";
import { readCatalog, validateCatalog } from "../src/catalog.js";
import { createCalendar } from "../src/calendar.js";
import { findConflicts } from "../src/planner.js";

async function readSource() {
  return JSON.parse(await readFile(new URL("../data/schedule-source.json", import.meta.url), "utf8"));
}

test("the checked-in catalog and audit report reproduce the complete captured source", async () => {
  const snapshot = await readSource();
  const { catalog, report } = buildScheduleCatalog(snapshot);
  const savedCatalog = JSON.parse(await readFile(new URL("../data/catalog.json", import.meta.url), "utf8"));
  const savedReport = JSON.parse(await readFile(new URL("../data/schedule-import-report.json", import.meta.url), "utf8"));
  assert.deepEqual(savedCatalog, catalog);
  assert.deepEqual(savedReport, report);
  assert.equal(catalog.kind, "official");
  assert.equal(report.sourceRows, 274);
  assert.equal(report.duplicateRows, 57);
  assert.equal(report.importedOccurrences, 216);
  assert.equal(report.sourceRows, report.duplicateRows + report.importedOccurrences + report.excluded.length);
  assert.equal(report.uniqueSourceSessions, 190);
  assert.equal(report.roomsNotListed, 23);
  assert.equal(new Set(catalog.sessions.map((session) => session.id)).size, 216);
  assert.equal(report.sections.length, 8);
  assert.equal(report.excluded[0].start, "12:00 pm");
  assert.equal(report.excluded[0].end, "12:15 am");
  assert.ok(catalog.sessions.some((session) => session.url.includes("post_type=os_session&p=28885")));
});

test("Eastern dates convert correctly across noon, midnight, and the UTC day boundary", () => {
  assert.equal(publishedTimeToUtc("2026-10-19", "9:00 am"), "2026-10-19T13:00:00.000Z");
  assert.equal(publishedTimeToUtc("2026-10-19", "12:00 pm"), "2026-10-19T16:00:00.000Z");
  assert.equal(publishedTimeToUtc("2026-10-19", "12:15 am"), "2026-10-19T04:15:00.000Z");
  assert.equal(publishedTimeToUtc("2026-10-18", "8:30 pm"), "2026-10-19T00:30:00.000Z");
  assert.throws(() => publishedTimeToUtc("2026-11-19", "9:00 am"), /conference dates/);
  assert.throws(() => publishedTimeToUtc("2026-10-19", "13:00 pm"), /clock time/);
});

test("the actual workshop has the user-confirmed 105-minute slot and exports without practice labels", async () => {
  const catalog = await readCatalog();
  const workshop = catalog.sessions.find((session) => session.id === "ato-2026-27925-20261019-1");
  assert.ok(workshop);
  assert.equal(workshop.room, "304");
  assert.equal(workshop.startsAt, "2026-10-19T13:00:00.000Z");
  assert.equal(workshop.endsAt, "2026-10-19T14:45:00.000Z");
  assert.equal((Date.parse(workshop.endsAt) - Date.parse(workshop.startsAt)) / 60000, 105);
  const parallel = catalog.sessions.find((session) =>
    session.url.endsWith("/from-zero-to-secure-agent-building-and-hardening-ai-agents-with-open-source-tools"));
  assert.equal(findConflicts([workshop, parallel]).length, 1);
  const calendar = createCalendar([workshop], catalog).replace(/\r\n /g, "");
  assert.match(calendar, /DTSTART:20261019T130000Z/);
  assert.match(calendar, /DTEND:20261019T144500Z/);
  assert.match(calendar, /published program block/);
  assert.doesNotMatch(calendar, /PRACTICE/);
});

test("cross-listing order does not change occurrence IDs or the catalog fingerprint", async () => {
  const source = await readSource();
  const expected = validateCatalog(buildScheduleCatalog(source).catalog);
  for (const day of source.days) {
    day.sections.reverse();
    for (const section of day.sections) {
      section.blocks.reverse();
      for (const block of section.blocks) block.sessions.reverse();
    }
  }
  source.days.reverse();
  assert.deepEqual(validateCatalog(buildScheduleCatalog(source).catalog), expected);
});

test("different slots remain separate and exact cross-listings collapse", async () => {
  const { catalog } = buildScheduleCatalog(await readSource());
  const workshopParts = catalog.sessions.filter((session) =>
    session.url.endsWith("/ai-agents-vibe-coding"));
  assert.equal(workshopParts.length, 2);
  assert.notEqual(workshopParts[0].id, workshopParts[1].id);
  const sharedTalk = catalog.sessions.filter((session) =>
    session.url.endsWith("/the-future-of-science-depends-on-open-source-engineers"));
  assert.equal(sharedTalk.length, 1);
});

test("a filtered capture, unexpected timezone, or conflicting duplicate cannot replace the catalog", async () => {
  const snapshot = await readSource();
  assert.throws(() => buildScheduleCatalog({ ...snapshot, renderedRowCount: 1 }), /rendered full schedule/);
  assert.throws(() => buildScheduleCatalog({ ...snapshot, timezoneLabels: ["UTC"] }), /timezone/);
  assert.throws(() => buildScheduleCatalog({ ...snapshot, sourceUrl: `${SCHEDULE_URL}#day=monday` }), /full official schedule/);
  const duplicate = structuredClone(snapshot);
  const block = duplicate.days[0].sections[0].blocks[0];
  block.sessions.push({ ...block.sessions[0], room: "A conflicting room" });
  duplicate.renderedRowCount++;
  assert.throws(() => buildScheduleCatalog(duplicate), /Conflicting cross-listings/);
});
