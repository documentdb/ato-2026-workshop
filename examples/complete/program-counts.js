export function programCountsPipeline(catalogVersion) {
  return [
    { $match: {
      catalogVersion,
      // Monday Oct 19 in America/New_York (EDT = UTC-4), not the current date.
      // startsAt is a normalized ISO UTC string, not a BSON Date in this catalog.
      startsAt: { $gte: "2026-10-19T04:00:00.000Z", $lt: "2026-10-20T04:00:00.000Z" },
    } },
    { $group: { _id: "$track", entries: { $sum: 1 } } },
    { $sort: { entries: -1, _id: 1 } },
  ];
}
