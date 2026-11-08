// Récupération automatique des stats Ligue 1 depuis l'API (non officielle) FotMob.
// Traite toutes les journées terminées depuis la dernière traitée (data/state.json),
// récupère score / xG / possession / tirs / tirs cadrés, écrit data/jN.json,
// et renseigne les sorties GitHub Actions (action=ready|none|blocked).
//
// Dépendance : aucune (fetch natif Node 18+). Lancé par .github/workflows/auto-stats.yml.

import fs from "node:fs";
import path from "node:path";

const LEAGUE = 53;                   // Ligue 1 chez FotMob
const SEASON = "2026/2027";
const DATA_DIR = "data";
const STATE = path.join(DATA_DIR, "state.json");
const BASE = "https://www.fotmob.com/api/data";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json",
};

const out = process.env.GITHUB_OUTPUT;
const emit = (k, v) => { if (out) fs.appendFileSync(out, `${k}=${v}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jget(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      last = e;
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
// FotMob : content.stats.Periods.All.stats = groupes { stats: [{ title, stats: [dom, ext] }] }.
// Un même titre peut apparaître dans plusieurs groupes : on garde la première valeur non nulle.
function statPair(details, title) {
  const groups = details?.content?.stats?.Periods?.All?.stats || [];
  for (const g of groups) for (const s of g.stats || []) {
    if ((s.title || "").toLowerCase() === title && Array.isArray(s.stats) && s.stats[0] != null)
      return [num(s.stats[0]), num(s.stats[1])];
  }
  return [null, null];
}

function fail(round, msg) {
  emit("action", "blocked");
  emit("round", String(round));
  fs.writeFileSync(
    "issue.md",
    `La récupération automatique FotMob a échoué pour la journée ${round}.\n\n` +
    `Détail technique : ${msg}\n\n` +
    `FotMob a peut-être changé son API ou bloque la requête. ` +
    `Remplis la journée ${round} à la main sur le site, puis clique « Copier pour Claude ».`
  );
  console.error("BLOCKED:", msg);
}

async function fetchRound(round, fixtures) {
  const matches = [];
  for (const f of fixtures) {
    const [sh, sa] = (f.status?.scoreStr || "").split("-").map(num);
    const m = {
      home: canon(f.home?.name), away: canon(f.away?.name),
      sh: sh ?? null, sa: sa ?? null,
      posH: null, posA: null, xgH: null, xgA: null,
      tirH: null, tirA: null, cadH: null, cadA: null,
    };
    try {
      const d = await jget(`${BASE}/matchDetails?matchId=${f.id}`);
      [m.posH, m.posA] = statPair(d, "ball possession");
      [m.xgH, m.xgA] = statPair(d, "expected goals (xg)");
      [m.tirH, m.tirA] = statPair(d, "total shots");
      [m.cadH, m.cadA] = statPair(d, "shots on target");
    } catch (e) {
      console.error("stats indisponibles pour le match", f.id, e.message);
    }
    matches.push(m);
    await sleep(800); // courtoisie anti-rate-limit
  }
  fs.writeFileSync(
    path.join(DATA_DIR, `j${round}.json`),
    JSON.stringify({ round, fetchedAt: new Date().toISOString(), matches }, null, 2)
  );
  return matches;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let state = { lastProcessedRound: 0 };
  if (fs.existsSync(STATE)) { try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch {} }
  const first = (state.lastProcessedRound || 0) + 1;

  let all;
  try {
    const d = await jget(`${BASE}/leagues?id=${LEAGUE}`);
    if (d.details?.selectedSeason !== SEASON) throw new Error(`saison FotMob ${d.details?.selectedSeason} ≠ ${SEASON}`);
    all = d.fixtures?.allMatches || [];
  } catch (e) { return fail(first, "calendrier de la ligue : " + e.message); }

  // Traite toutes les journées complètes à la suite (rattrapage possible).
  // shortcut: un match reporté bloque sa journée jusqu'à ce qu'il soit joué ; gérer "postponed" si ça arrive.
  const done = [];
  let body = "";
  for (let round = first; ; round++) {
    const fixtures = all.filter((m) => String(m.round) === String(round) && !m.status?.cancelled);
    if (fixtures.length === 0 || !fixtures.every((m) => m.status?.finished)) {
      if (!done.length) console.log("journée", round, "pas encore terminée");
      break;
    }
    const matches = await fetchRound(round, fixtures);
    done.push(round);
    state.lastProcessedRound = round;
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
    body += `\n**J${round}**\n`;
    for (const m of matches) body += `- ${m.home} ${m.sh ?? "?"}-${m.sa ?? "?"} ${m.away}${m.xgH == null ? " (sans xG)" : ""}\n`;
    console.log("journée", round, "traitée :", matches.length, "matchs");
  }

  if (!done.length) { emit("action", "none"); return; }
  const label = done.length === 1 ? `${done[0]}` : `${done[0]} à ${done[done.length - 1]}`;
  const next = done[done.length - 1] + 1;
  fs.writeFileSync(
    "issue.md",
    `Données FotMob récupérées pour : J${done.join(", J")}. Elles sont pré-remplies sur le site ` +
    `(seuls les champs encore vides sont remplis, tes saisies manuelles sont conservées).\n` + body +
    `\nÀ faire : ouvre le site, vérifie/complète, clique « Copier pour Claude — Préparer la J${next} », ` +
    `et colle le texte dans ta conversation Claude.`
  );
  emit("action", "ready");
  emit("round", label);
}

main().catch((e) => fail("?", "erreur inattendue : " + e.message));
