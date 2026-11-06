// Récupération automatique des stats Ligue 1 depuis l'API (non officielle) Sofascore.
// Détecte la prochaine journée à traiter, vérifie qu'elle est complète,
// récupère score / xG / possession / tirs / tirs cadrés, écrit data/jN.json,
// et renseigne les sorties GitHub Actions (action=ready|none|blocked).
//
// Dépendance : aucune (fetch natif Node 18+). Lancé par .github/workflows/auto-stats.yml.

import fs from "node:fs";
import path from "node:path";

const UT = 34;                       // Ligue 1 (unique-tournament Sofascore)
const DATA_DIR = "data";
const STATE = path.join(DATA_DIR, "state.json");
const BASE = "https://api.sofascore.com/api/v1";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  "Referer": "https://www.sofascore.com/",
  "Origin": "https://www.sofascore.com",
};

const out = process.env.GITHUB_OUTPUT;
const emit = (k, v) => { if (out) fs.appendFileSync(out, `${k}=${v}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jget(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.status === 404) { const e = new Error("HTTP 404"); e.notfound = true; throw e; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      last = e;
      if (e.notfound) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

const CANON = [
  ["psg", ["paris saint-germain", "paris sg", "psg"]],
  ["parisfc", ["paris fc"]],
  ["marseille", ["marseille"]],
  ["monaco", ["monaco"]],
  ["lille", ["lille", "losc"]],
  ["lens", ["lens"]],
  ["lyon", ["lyon"]],
  ["nice", ["nice"]],
  ["rennes", ["rennes", "rennais"]],
  ["brest", ["brest"]],
  ["lehavre", ["havre"]],
  ["toulouse", ["toulouse"]],
  ["strasbourg", ["strasbourg"]],
  ["auxerre", ["auxerre"]],
  ["lorient", ["lorient"]],
  ["angers", ["angers"]],
  ["lemans", ["mans"]],
  ["troyes", ["troyes", "estac"]],
];
function canon(name) {
  const s = (name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [k, subs] of CANON) if (subs.some((x) => s.includes(x))) return k;
  return s;
}
function num(v) {
  if (v == null) return null;
  const m = String(v).match(/-?[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}
function statPair(groups, names) {
  const all = groups.find((p) => p.period === "ALL") || groups[0];
  if (!all) return [null, null];
  for (const g of all.groups || []) {
    for (const it of g.statisticsItems || []) {
      const nm = (it.name || "").toLowerCase();
      if (names.some((n) => nm === n || nm.includes(n))) return [num(it.home), num(it.away)];
    }
  }
  return [null, null];
}

async function resolveSeason() {
  const d = await jget(`${BASE}/unique-tournament/${UT}/seasons`);
  const seasons = d.seasons || [];
  const cur = seasons.find((s) => /26\/27|2026/.test(s.year || "")) || seasons[0];
  if (!cur) throw new Error("aucune saison trouvée");
  return cur.id;
}

function fail(round, msg) {
  emit("action", "blocked");
  emit("round", String(round));
  fs.writeFileSync(
    "issue.md",
    `La récupération automatique Sofascore a échoué pour la journée ${round}.\n\n` +
    `Détail technique : ${msg}\n\n` +
    `C'est probablement le blocage anti-bot de Sofascore (IP datacenter). ` +
    `Remplis la journée ${round} à la main sur le site, puis clique « Copier pour Claude ».`
  );
  console.error("BLOCKED:", msg);
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let state = { lastProcessedRound: 9, seasonId: null };
  if (fs.existsSync(STATE)) { try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch {} }
  const target = (state.lastProcessedRound || 0) + 1;

  let seasonId;
  try { seasonId = state.seasonId || (await resolveSeason()); }
  catch (e) { return fail(target, "résolution saison : " + e.message); }

  let events;
  try {
    const d = await jget(`${BASE}/unique-tournament/${UT}/season/${seasonId}/events/round/${target}`);
    events = d.events || [];
  } catch (e) {
    if (e.notfound) { emit("action", "none"); console.log("journée", target, "pas encore au calendrier"); return; }
    return fail(target, "événements de la journée : " + e.message);
  }

  if (events.length === 0) { emit("action", "none"); console.log("aucun match pour la journée", target); return; }

  const done = events.every((e) => e.status && (e.status.type === "finished" || e.status.code === 100));
  if (!done) { emit("action", "none"); console.log("journée", target, "pas encore terminée"); return; }

  const matches = [];
  for (const ev of events) {
    const m = {
      home: canon(ev.homeTeam?.name),
      away: canon(ev.awayTeam?.name),
      sh: ev.homeScore?.current ?? null,
      sa: ev.awayScore?.current ?? null,
      posH: null, posA: null, xgH: null, xgA: null,
      tirH: null, tirA: null, cadH: null, cadA: null,
    };
    try {
      const st = await jget(`${BASE}/event/${ev.id}/statistics`);
      const g = st.statistics || [];
      [m.posH, m.posA] = statPair(g, ["ball possession"]);
      [m.xgH, m.xgA] = statPair(g, ["expected goals"]);
      [m.tirH, m.tirA] = statPair(g, ["total shots"]);
      [m.cadH, m.cadA] = statPair(g, ["shots on target"]);
    } catch (e) {
      console.error("stats indisponibles pour l'événement", ev.id, e.message);
    }
    matches.push(m);
    await sleep(800); // courtoisie anti-rate-limit
  }

  fs.writeFileSync(
    path.join(DATA_DIR, `j${target}.json`),
    JSON.stringify({ round: target, fetchedAt: new Date().toISOString(), matches }, null, 2)
  );
  state.lastProcessedRound = target;
  state.seasonId = seasonId;
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

  let body = `La journée ${target} est complète. Les données Sofascore ont été récupérées et pré-remplies sur le site.\n\n`;
  body += `Scores récupérés :\n`;
  for (const m of matches) body += `- ${m.home} ${m.sh ?? "?"}-${m.sa ?? "?"} ${m.away}\n`;
  const missing = matches.filter((m) => m.xgH == null).length;
  if (missing) body += `\n(${missing} match(s) sans xG récupéré — à compléter à la main si besoin.)\n`;
  body += `\nÀ faire : ouvre le site (données déjà chargées), vérifie/complète, ` +
          `clique « Copier pour Claude — Préparer la J${target + 1} », et colle le texte dans ta conversation Claude.`;
  fs.writeFileSync("issue.md", body);

  emit("action", "ready");
  emit("round", String(target));
  console.log("journée", target, "traitée :", matches.length, "matchs");
}

main().catch((e) => fail("?", "erreur inattendue : " + e.message));
