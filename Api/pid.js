// /api/pid — proxy for Golemio vehicle positions
// Reads GOLEMIO_API_KEY from Vercel environment variables.

const GOLEMIO_URL = "https://api.golemio.cz/v2/public/vehiclepositions?limit=10000";

let cacheBody = null;
let cacheTime = 0;
const CACHE_MS = 8000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const key = process.env.GOLEMIO_API_KEY || process.env.GOLEMIO_KEY || "";
  if (!key) return res.status(503).json({ error: "missing_api_key", hint: "Set GOLEMIO_API_KEY in Vercel env vars" });

  const now = Date.now();
  if (cacheBody && now - cacheTime < CACHE_MS) {
    res.setHeader("X-Cache", "hit");
    return res.status(200).json(cacheBody);
  }

  let upstream;
  try {
    upstream = await fetch(GOLEMIO_URL, { headers: { "X-Access-Token": key } });
  } catch {
    return res.status(502).json({ error: "upstream_unreachable" });
  }
  if (!upstream.ok) {
    return res.status(502).json({ error: "upstream_error", status: upstream.status });
  }

  const data = await upstream.json();
  const feats = Array.isArray(data?.features) ? data.features : [];

  // Compact: [lat, lng, bearing, delaySec, routeType, routeName]
  const vehicles = [];
  for (const f of feats) {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const p = f?.properties ?? {};
    const lp = p.last_position ?? {};
    const trip = p.trip ?? {};
    const gtfs = trip.gtfs ?? {};
    let delay = lp?.delay?.actual;
    if (typeof delay !== "number") delay = typeof lp?.delay === "number" ? lp.delay : 0;
    let routeType = gtfs.route_type;
    if (typeof routeType !== "number") routeType = trip?.vehicle_type?.id ?? 3;
    vehicles.push([
      Math.round(c[1] * 1e5) / 1e5,
      Math.round(c[0] * 1e5) / 1e5,
      Math.round(lp.bearing ?? 0),
      Math.round(delay),
      routeType,
      String(gtfs.route_short_name ?? ""),
    ]);
  }

  cacheBody = { t: now, n: vehicles.length, v: vehicles };
  cacheTime = now;
  res.setHeader("X-Cache", "miss");
  res.setHeader("Cache-Control", "s-maxage=8, stale-while-revalidate=4");
  return res.status(200).json(cacheBody);
}
