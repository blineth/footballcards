"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Database,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

type Candidate = {
  name: string;
  dbName: string;
  team: string;
  currentTeamDb: string;
  dbTeam: string;
  yellows: number;
  cards90: number;
  fouls90: number;
  h2hFouls?: number;
  h2hYellows?: number;
  score: number;
};

type H2HCard = {
  player: string;
  card: "yellow" | "red";
  minute: string;
};

type H2HMeeting = {
  date: string;
  label: string;
  cards: H2HCard[];
};

type Fixture = {
  id: string;
  day: string;
  date: string;
  time: string;
  home: string;
  away: string;
  homeDb: string;
  awayDb: string;
  candidates: Candidate[];
  meetings?: H2HMeeting[];
  noLeagueH2HReason?: string;
};

type PlayerDetail = {
  connected?: boolean;
  baseline?: {
    appearances?: number | null;
    starts?: number | null;
    minutes?: number | null;
    yellowCards?: number | null;
    redCards?: number | null;
    foulsCommitted?: number | null;
    foulsDrawn?: number | null;
    foulsPer90?: number | null;
    cardsPer90?: number | null;
  } | null;
  h2h?: Array<{
    matchDate: string;
    foulsCommitted?: number | null;
    foulsDrawn?: number | null;
    yellowCard?: boolean | null;
    redCard?: boolean | null;
  }>;
};

/*
  Rankings use the imported 2025/26 baseline + H2H foul data.
  Verified H2H yellow incidents add evidence to the ranking.
  Current clubs were checked against the 2026/27 FPL player list on 16 Aug 2026.
  dbTeam deliberately remains the player's 2025/26 database team so /api/player
  can still retrieve the historical baseline after a summer transfer.
*/
const fixtures: Fixture[] = [
  {
    id: "arsenal-coventry",
    day: "Friday",
    date: "21 Aug",
    time: "20:00",
    home: "Arsenal",
    away: "Coventry City",
    homeDb: "Arsenal",
    awayDb: "Coventry",
    noLeagueH2HReason:
      "No 2025/26 Premier League H2H because Coventry were not in the Premier League.",
    candidates: [
      { name: "Gabriel Jesus", dbName: "Gabriel Fernando de Jesus", team: "Arsenal", currentTeamDb: "Arsenal", dbTeam: "Arsenal", yellows: 3, cards90: 0.65, fouls90: 1.94, score: 61.9 },
      { name: "Cristhian Mosquera", dbName: "Cristhian Mosquera", team: "Arsenal", currentTeamDb: "Arsenal", dbTeam: "Arsenal", yellows: 4, cards90: 0.37, fouls90: 1.55, score: 51.4 },
      { name: "Myles Lewis-Skelly", dbName: "Myles Lewis-Skelly", team: "Arsenal", currentTeamDb: "Arsenal", dbTeam: "Arsenal", yellows: 3, cards90: 0.39, fouls90: 1.29, score: 47.7 },
      { name: "Bruno Guimarães", dbName: "Bruno Guimarães Rodriguez Moura", team: "Arsenal", currentTeamDb: "Arsenal", dbTeam: "Newcastle", yellows: 6, cards90: 0.22, fouls90: 1.65, score: 46.9 },
      { name: "Riccardo Calafiori", dbName: "Riccardo Calafiori", team: "Arsenal", currentTeamDb: "Arsenal", dbTeam: "Arsenal", yellows: 5, cards90: 0.27, fouls90: 1.38, score: 45.2 },
    ],
  },
  {
    id: "hull-man-utd",
    day: "Saturday",
    date: "22 Aug",
    time: "12:30",
    home: "Hull City",
    away: "Manchester United",
    homeDb: "Hull",
    awayDb: "Man Utd",
    noLeagueH2HReason:
      "No 2025/26 Premier League H2H because Hull were not in the Premier League.",
    candidates: [
      { name: "Luke Shaw", dbName: "Luke Shaw", team: "Manchester United", currentTeamDb: "Man Utd", dbTeam: "Man Utd", yellows: 9, cards90: 0.25, fouls90: 1.34, score: 53.4 },
      { name: "Joshua Zirkzee", dbName: "Joshua Zirkzee", team: "Manchester United", currentTeamDb: "Man Utd", dbTeam: "Man Utd", yellows: 3, cards90: 0.44, fouls90: 1.19, score: 50.2 },
      { name: "Patrick Dorgu", dbName: "Patrick Dorgu", team: "Manchester United", currentTeamDb: "Man Utd", dbTeam: "Man Utd", yellows: 5, cards90: 0.31, fouls90: 1.44, score: 48.6 },
      { name: "Andrey Santos", dbName: "Andrey Nascimento dos Santos", team: "Manchester United", currentTeamDb: "Man Utd", dbTeam: "Chelsea", yellows: 4, cards90: 0.29, fouls90: 0.94, score: 39.7 },
      { name: "Noussair Mazraoui", dbName: "Noussair Mazraoui", team: "Manchester United", currentTeamDb: "Man Utd", dbTeam: "Man Utd", yellows: 3, cards90: 0.28, fouls90: 1.11, score: 38.2 },
    ],
  },
  {
    id: "everton-palace",
    day: "Saturday",
    date: "22 Aug",
    time: "15:00",
    home: "Everton",
    away: "Crystal Palace",
    homeDb: "Everton",
    awayDb: "Crystal Palace",
    candidates: [
      { name: "James Garner", dbName: "James Garner", team: "Everton", currentTeamDb: "Everton", dbTeam: "Everton", yellows: 12, cards90: 0.32, fouls90: 1.03, h2hFouls: 2, h2hYellows: 2, score: 83.7 },
      { name: "Tim Iroegbunam", dbName: "Tim Iroegbunam", team: "Everton", currentTeamDb: "Everton", dbTeam: "Everton", yellows: 9, cards90: 0.55, fouls90: 1.77, h2hFouls: 2, score: 81.2 },
      { name: "Tyler Dibling", dbName: "Tyler Dibling", team: "Everton", currentTeamDb: "Everton", dbTeam: "Everton", yellows: 2, cards90: 0.52, fouls90: 2.84, h2hFouls: 2, score: 71.0 },
      { name: "Daniel Muñoz", dbName: "Daniel Muñoz Mejía", team: "Crystal Palace", currentTeamDb: "Crystal Palace", dbTeam: "Crystal Palace", yellows: 7, cards90: 0.26, fouls90: 1.27, h2hFouls: 3, h2hYellows: 1, score: 67.4 },
      { name: "Tyrique George", dbName: "Tyrique George", team: "Everton", currentTeamDb: "Everton", dbTeam: "Everton", yellows: 2, cards90: 0.51, fouls90: 2.31, score: 63.1 },
    ],
    meetings: [
      {
        date: "2025-10-05",
        label: "Everton v Crystal Palace",
        cards: [
          { player: "Iliman Ndiaye", card: "yellow", minute: "90+5" },
          { player: "Daniel Muñoz", card: "yellow", minute: "87" },
          { player: "Adam Wharton", card: "yellow", minute: "82" },
          { player: "James Garner", card: "yellow", minute: "68" },
          { player: "Yeremy Pino", card: "yellow", minute: "68" },
        ],
      },
      {
        date: "2026-05-10",
        label: "Crystal Palace v Everton",
        cards: [
          { player: "Vitalii Mykolenko", card: "yellow", minute: "45" },
          { player: "James Garner", card: "yellow", minute: "30" },
        ],
      },
    ],
  },
  {
    id: "ipswich-sunderland",
    day: "Saturday",
    date: "22 Aug",
    time: "15:00",
    home: "Ipswich Town",
    away: "Sunderland",
    homeDb: "Ipswich",
    awayDb: "Sunderland",
    noLeagueH2HReason:
      "No 2025/26 Premier League Ipswich v Sunderland H2H because Ipswich were not in the Premier League. Individual players can still show opponent history from previous clubs.",
    candidates: [
      { name: "Saša Lukić", dbName: "Saša Lukić", team: "Ipswich Town", currentTeamDb: "Ipswich", dbTeam: "Fulham", yellows: 9, cards90: 0.47, fouls90: 2.76, score: 80.4 },
      { name: "Reinildo", dbName: "Reinildo Mandava", team: "Sunderland", currentTeamDb: "Sunderland", dbTeam: "Sunderland", yellows: 7, cards90: 0.32, fouls90: 1.46, score: 54.5 },
      { name: "Habib Diarra", dbName: "Habib Diarra", team: "Sunderland", currentTeamDb: "Sunderland", dbTeam: "Sunderland", yellows: 6, cards90: 0.38, fouls90: 1.28, score: 54.4 },
      { name: "Florentino", dbName: "Florentino Ibrain Morris Luís", team: "Ipswich Town", currentTeamDb: "Ipswich", dbTeam: "Burnley", yellows: 6, cards90: 0.26, fouls90: 1.71, h2hFouls: 1, score: 53.3 },
      { name: "Noah Sadiki", dbName: "Noah Sadiki", team: "Sunderland", currentTeamDb: "Sunderland", dbTeam: "Sunderland", yellows: 9, cards90: 0.28, fouls90: 1.00, score: 52.1 },
    ],
  },
  {
    id: "forest-leeds",
    day: "Saturday",
    date: "22 Aug",
    time: "15:00",
    home: "Nottingham Forest",
    away: "Leeds United",
    homeDb: "Nott'm Forest",
    awayDb: "Leeds",
    candidates: [
      { name: "Ibrahim Sangaré", dbName: "Ibrahim Sangaré", team: "Nottingham Forest", currentTeamDb: "Nott'm Forest", dbTeam: "Nott'm Forest", yellows: 5, cards90: 0.22, fouls90: 1.82, h2hFouls: 6, h2hYellows: 2, score: 81.1 },
      { name: "Ethan Ampadu", dbName: "Ethan Ampadu", team: "Leeds United", currentTeamDb: "Leeds", dbTeam: "Leeds", yellows: 10, cards90: 0.29, fouls90: 1.44, h2hFouls: 4, score: 71.7 },
      { name: "Ryan Yates", dbName: "Ryan Yates", team: "Nottingham Forest", currentTeamDb: "Nott'm Forest", dbTeam: "Nott'm Forest", yellows: 3, cards90: 0.45, fouls90: 1.94, score: 58.4 },
      { name: "Murillo", dbName: "Murillo Costa dos Santos", team: "Nottingham Forest", currentTeamDb: "Nott'm Forest", dbTeam: "Nott'm Forest", yellows: 5, cards90: 0.21, fouls90: 0.97, h2hFouls: 3, h2hYellows: 1, score: 55.9 },
      { name: "Wilfried Gnonto", dbName: "Wilfried Gnonto", team: "Leeds United", currentTeamDb: "Leeds", dbTeam: "Leeds", yellows: 3, cards90: 0.52, fouls90: 1.21, score: 54.6 },
    ],
    meetings: [
      {
        date: "2025-11-09",
        label: "Nottingham Forest v Leeds United",
        cards: [
          { player: "Sean Longstaff", card: "yellow", minute: "71" },
          { player: "Murillo", card: "yellow", minute: "41" },
          { player: "Ibrahim Sangaré", card: "yellow", minute: "33" },
        ],
      },
      {
        date: "2026-02-06",
        label: "Leeds United v Nottingham Forest",
        cards: [
          { player: "Ibrahim Sangaré", card: "yellow", minute: "62" },
          { player: "Noah Okafor", card: "yellow", minute: "61" },
        ],
      },
    ],
  },
  {
    id: "brentford-spurs",
    day: "Saturday",
    date: "22 Aug",
    time: "17:30",
    home: "Brentford",
    away: "Tottenham Hotspur",
    homeDb: "Brentford",
    awayDb: "Spurs",
    candidates: [
      { name: "Cristian Romero", dbName: "Cristian Romero", team: "Tottenham Hotspur", currentTeamDb: "Spurs", dbTeam: "Spurs", yellows: 9, cards90: 0.43, fouls90: 1.54, h2hFouls: 5, h2hYellows: 1, score: 93.0 },
      { name: "Vitaly Janelt", dbName: "Vitaly Janelt", team: "Brentford", currentTeamDb: "Brentford", dbTeam: "Brentford", yellows: 8, cards90: 0.50, fouls90: 1.26, h2hFouls: 3, score: 76.6 },
      { name: "Pedro Porro", dbName: "Pedro Porro Sauceda", team: "Tottenham Hotspur", currentTeamDb: "Spurs", dbTeam: "Spurs", yellows: 10, cards90: 0.32, fouls90: 1.03, h2hFouls: 2, h2hYellows: 1, score: 73.7 },
      { name: "Kevin Danso", dbName: "Kevin Danso", team: "Tottenham Hotspur", currentTeamDb: "Spurs", dbTeam: "Spurs", yellows: 8, cards90: 0.48, fouls90: 1.27, score: 66.3 },
      { name: "Yehor Yarmoliuk", dbName: "Yehor Yarmoliuk", team: "Brentford", currentTeamDb: "Brentford", dbTeam: "Brentford", yellows: 7, cards90: 0.24, fouls90: 1.26, h2hFouls: 2, h2hYellows: 1, score: 62.9 },
    ],
    meetings: [
      {
        date: "2025-12-06",
        label: "Tottenham Hotspur v Brentford",
        cards: [
          { player: "Archie Gray", card: "yellow", minute: "77" },
          { player: "Yehor Yarmoliuk", card: "yellow", minute: "72" },
          { player: "Kevin Schade", card: "yellow", minute: "60" },
          { player: "Pedro Porro", card: "yellow", minute: "47" },
          { player: "Kristoffer Ajer", card: "yellow", minute: "45" },
          { player: "Cristian Romero", card: "yellow", minute: "31" },
          { player: "Michael Kayode", card: "yellow", minute: "28" },
        ],
      },
      {
        date: "2026-01-01",
        label: "Brentford v Tottenham Hotspur",
        cards: [
          { player: "Guglielmo Vicario", card: "yellow", minute: "69" },
          { player: "João Palhinha", card: "yellow", minute: "60" },
          { player: "Jordan Henderson", card: "yellow", minute: "58" },
        ],
      },
    ],
  },
  {
    id: "brighton-villa",
    day: "Sunday",
    date: "23 Aug",
    time: "14:00",
    home: "Brighton & Hove Albion",
    away: "Aston Villa",
    homeDb: "Brighton",
    awayDb: "Aston Villa",
    candidates: [
      { name: "Diego Gómez", dbName: "Diego Gómez Amarilla", team: "Brighton", currentTeamDb: "Brighton", dbTeam: "Brighton", yellows: 9, cards90: 0.38, fouls90: 2.04, h2hFouls: 2, h2hYellows: 1, score: 85.5 },
      { name: "João Gomes", dbName: "João Victor Gomes da Silva", team: "Aston Villa", currentTeamDb: "Aston Villa", dbTeam: "Wolves", yellows: 10, cards90: 0.32, fouls90: 2.20, h2hFouls: 4, score: 81.4 },
      { name: "Mats Wieffer", dbName: "Mats Wieffer", team: "Brighton", currentTeamDb: "Brighton", dbTeam: "Brighton", yellows: 8, cards90: 0.38, fouls90: 1.42, h2hFouls: 2, score: 66.8 },
      { name: "Carlos Baleba", dbName: "Carlos Baleba", team: "Brighton", currentTeamDb: "Brighton", dbTeam: "Brighton", yellows: 5, cards90: 0.27, fouls90: 1.70, h2hFouls: 1, h2hYellows: 1, score: 61.4 },
      { name: "Charalampos Kostoulas", dbName: "Charalampos Kostoulas", team: "Brighton", currentTeamDb: "Brighton", dbTeam: "Brighton", yellows: 2, cards90: 0.51, fouls90: 1.79, score: 57.9 },
    ],
    meetings: [
      {
        date: "2025-12-03",
        label: "Brighton & Hove Albion v Aston Villa",
        cards: [
          { player: "Marco Bizot", card: "yellow", minute: "90" },
          { player: "Diego Gómez", card: "yellow", minute: "85" },
          { player: "John McGinn", card: "yellow", minute: "75" },
          { player: "Bart Verbruggen", card: "yellow", minute: "45" },
        ],
      },
      {
        date: "2026-02-11",
        label: "Aston Villa v Brighton & Hove Albion",
        cards: [
          { player: "Morgan Rogers", card: "yellow", minute: "50" },
          { player: "Emiliano Martínez", card: "yellow", minute: "41" },
          { player: "Jan Paul van Hecke", card: "yellow", minute: "41" },
          { player: "Joël Veltman", card: "yellow", minute: "23" },
          { player: "Carlos Baleba", card: "yellow", minute: "2" },
        ],
      },
    ],
  },
  {
    id: "city-bournemouth",
    day: "Sunday",
    date: "23 Aug",
    time: "14:00",
    home: "Manchester City",
    away: "AFC Bournemouth",
    homeDb: "Man City",
    awayDb: "Bournemouth",
    candidates: [
      { name: "Justin Kluivert", dbName: "Justin Kluivert", team: "AFC Bournemouth", currentTeamDb: "Bournemouth", dbTeam: "Bournemouth", yellows: 5, cards90: 0.48, fouls90: 1.71, h2hFouls: 5, h2hYellows: 2, score: 98.2 },
      { name: "Tyler Adams", dbName: "Tyler Adams", team: "AFC Bournemouth", currentTeamDb: "Bournemouth", dbTeam: "Bournemouth", yellows: 8, cards90: 0.41, fouls90: 1.78, h2hFouls: 3, h2hYellows: 1, score: 85.5 },
      { name: "David Brooks", dbName: "David Brooks", team: "AFC Bournemouth", currentTeamDb: "Bournemouth", dbTeam: "Bournemouth", yellows: 7, cards90: 0.53, fouls90: 0.83, score: 60.8 },
      { name: "Nico González", dbName: "Nico González Iglesias", team: "Manchester City", currentTeamDb: "Man City", dbTeam: "Man City", yellows: 6, cards90: 0.35, fouls90: 1.73, h2hFouls: 1, score: 59.8 },
      { name: "Antoine Semenyo", dbName: "Antoine Semenyo", team: "Manchester City", currentTeamDb: "Man City", dbTeam: "Man City", yellows: 7, cards90: 0.20, fouls90: 1.57, h2hFouls: 4, score: 59.2 },
    ],
    meetings: [
      {
        date: "2025-11-02",
        label: "Manchester City v AFC Bournemouth",
        cards: [
          { player: "Justin Kluivert", card: "yellow", minute: "87" },
          { player: "Adrien Truffert", card: "yellow", minute: "65" },
          { player: "Phil Foden", card: "yellow", minute: "45+2" },
          { player: "Gianluigi Donnarumma", card: "yellow", minute: "26" },
        ],
      },
      {
        date: "2026-05-19",
        label: "AFC Bournemouth v Manchester City",
        cards: [
          { player: "Gianluigi Donnarumma", card: "yellow", minute: "90+7" },
          { player: "Adrien Truffert", card: "yellow", minute: "90+6" },
          { player: "Rodri", card: "yellow", minute: "90+3" },
          { player: "Justin Kluivert", card: "yellow", minute: "90+3" },
          { player: "James Hill", card: "yellow", minute: "59" },
          { player: "Tyler Adams", card: "yellow", minute: "37" },
        ],
      },
    ],
  },
  {
    id: "newcastle-liverpool",
    day: "Sunday",
    date: "23 Aug",
    time: "16:30",
    home: "Newcastle United",
    away: "Liverpool",
    homeDb: "Newcastle",
    awayDb: "Liverpool",
    candidates: [
      { name: "Dan Burn", dbName: "Dan Burn", team: "Newcastle United", currentTeamDb: "Newcastle", dbTeam: "Newcastle", yellows: 9, cards90: 0.37, fouls90: 1.48, h2hFouls: 4, h2hYellows: 2, score: 95.2 },
      { name: "Joelinton", dbName: "Joelinton Cássio Apolinário de Lira", team: "Newcastle United", currentTeamDb: "Newcastle", dbTeam: "Newcastle", yellows: 10, cards90: 0.46, fouls90: 2.17, h2hFouls: 1, score: 81.9 },
      { name: "Conor Bradley", dbName: "Conor Bradley", team: "Liverpool", currentTeamDb: "Liverpool", dbTeam: "Liverpool", yellows: 5, cards90: 0.48, fouls90: 1.75, h2hFouls: 1, h2hYellows: 1, score: 76.6 },
      { name: "Federico Chiesa", dbName: "Federico Chiesa", team: "Liverpool", currentTeamDb: "Liverpool", dbTeam: "Liverpool", yellows: 3, cards90: 0.85, fouls90: 3.12, h2hFouls: 1, score: 70.5 },
      { name: "Joe Gomez", dbName: "Joe Gomez", team: "Liverpool", currentTeamDb: "Liverpool", dbTeam: "Liverpool", yellows: 4, cards90: 0.61, fouls90: 2.12, score: 66.2 },
    ],
    meetings: [
      {
        date: "2025-08-25",
        label: "Newcastle United v Liverpool",
        cards: [
          { player: "Conor Bradley", card: "yellow", minute: "87" },
          { player: "Bruno Guimarães", card: "yellow", minute: "47" },
          { player: "Anthony Gordon", card: "red", minute: "45+3" },
          { player: "Dan Burn", card: "yellow", minute: "44" },
          { player: "Ibrahima Konaté", card: "yellow", minute: "25" },
          { player: "Ryan Gravenberch", card: "yellow", minute: "8" },
        ],
      },
      {
        date: "2026-01-31",
        label: "Liverpool v Newcastle United",
        cards: [
          { player: "Dan Burn", card: "yellow", minute: "86" },
          { player: "Alexis Mac Allister", card: "yellow", minute: "59" },
          { player: "Jacob Ramsey", card: "yellow", minute: "45" },
          { player: "Anthony Gordon", card: "yellow", minute: "11" },
        ],
      },
    ],
  },
  {
    id: "fulham-chelsea",
    day: "Monday",
    date: "24 Aug",
    time: "20:00",
    home: "Fulham",
    away: "Chelsea",
    homeDb: "Fulham",
    awayDb: "Chelsea",
    candidates: [
      { name: "Moisés Caicedo", dbName: "Moisés Caicedo Corozo", team: "Chelsea", currentTeamDb: "Chelsea", dbTeam: "Chelsea", yellows: 11, cards90: 0.35, fouls90: 1.74, h2hFouls: 2, h2hYellows: 1, score: 82.9 },
      { name: "Jorge Cuenca", dbName: "Jorge Cuenca Barreno", team: "Fulham", currentTeamDb: "Fulham", dbTeam: "Fulham", yellows: 6, cards90: 0.58, fouls90: 0.96, h2hFouls: 1, h2hYellows: 1, score: 72.6 },
      { name: "Liam Delap", dbName: "Liam Delap", team: "Chelsea", currentTeamDb: "Chelsea", dbTeam: "Chelsea", yellows: 4, cards90: 0.33, fouls90: 2.06, h2hFouls: 4, score: 65.7 },
      { name: "Enzo Fernández", dbName: "Enzo Fernández", team: "Chelsea", currentTeamDb: "Chelsea", dbTeam: "Chelsea", yellows: 10, cards90: 0.29, fouls90: 1.04, h2hYellows: 1, score: 65.7 },
      { name: "Jorrel Hato", dbName: "Jorrel Hato", team: "Chelsea", currentTeamDb: "Chelsea", dbTeam: "Chelsea", yellows: 7, cards90: 0.55, fouls90: 1.19, score: 64.4 },
    ],
    meetings: [
      {
        date: "2025-08-30",
        label: "Chelsea v Fulham",
        cards: [
          { player: "Saša Lukić", card: "yellow", minute: "90+6" },
          { player: "Andrey Santos", card: "yellow", minute: "90+3" },
          { player: "Alex Iwobi", card: "yellow", minute: "73" },
          { player: "Moisés Caicedo", card: "yellow", minute: "38" },
        ],
      },
      {
        date: "2026-01-07",
        label: "Fulham v Chelsea",
        cards: [
          { player: "Raúl Jiménez", card: "yellow", minute: "90" },
          { player: "Timothy Castagne", card: "yellow", minute: "78" },
          { player: "Jorge Cuenca", card: "yellow", minute: "45" },
          { player: "Cole Palmer", card: "yellow", minute: "25" },
          { player: "Tosin Adarabioyo", card: "yellow", minute: "25" },
          { player: "Enzo Fernández", card: "yellow", minute: "24" },
          { player: "Marc Cucurella", card: "red", minute: "22" },
        ],
      },
    ],
  },
];

const verifiedCardOverrides: Record<string, "yellow" | "red"> = {
  "James Garner|2025-10-05": "yellow",
  "James Garner|2026-05-10": "yellow",
  "Daniel Muñoz Mejía|2025-10-05": "yellow",
  "Ibrahim Sangaré|2025-11-09": "yellow",
  "Ibrahim Sangaré|2026-02-06": "yellow",
  "Murillo Costa dos Santos|2025-11-09": "yellow",
  "Cristian Romero|2025-12-06": "yellow",
  "Pedro Porro Sauceda|2025-12-06": "yellow",
  "Yehor Yarmoliuk|2025-12-06": "yellow",
  "Diego Gómez Amarilla|2025-12-03": "yellow",
  "Carlos Baleba|2026-02-11": "yellow",
  "Justin Kluivert|2025-11-02": "yellow",
  "Justin Kluivert|2026-05-19": "yellow",
  "Tyler Adams|2026-05-19": "yellow",
  "Dan Burn|2025-08-25": "yellow",
  "Dan Burn|2026-01-31": "yellow",
  "Conor Bradley|2025-08-25": "yellow",
  "Moisés Caicedo Corozo|2025-08-30": "yellow",
  "Jorge Cuenca Barreno|2026-01-07": "yellow",
  "Enzo Fernández|2026-01-07": "yellow",
};

function getOpponent(fixture: Fixture, candidate: Candidate) {
  return candidate.currentTeamDb === fixture.homeDb ? fixture.awayDb : fixture.homeDb;
}

function scoreBand(score: number) {
  if (score >= 75)
    return {
      label: "STRONG",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  if (score >= 60)
    return {
      label: "GOOD",
      cls: "bg-amber-50 text-amber-700 border-amber-200",
    };
  return {
    label: "WATCH",
    cls: "bg-slate-50 text-slate-600 border-slate-200",
  };
}

function cleanDate(value: string) {
  return value.slice(0, 10);
}

function formatDate(value: string) {
  const date = new Date(`${cleanDate(value)}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function HomePage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, PlayerDetail>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});

  async function togglePlayer(
    fixture: Fixture,
    candidate: Candidate,
    index: number
  ) {
    const key = `${fixture.id}-${index}`;
    if (selected === key) {
      setSelected(null);
      return;
    }

    setSelected(key);

    if (details[key]) return;

    setLoading(key);
    try {
      const opponent = getOpponent(fixture, candidate);
      const url =
        `/api/player?name=${encodeURIComponent(candidate.dbName)}` +
        `&team=${encodeURIComponent(candidate.dbTeam)}` +
        `&opponent=${encodeURIComponent(opponent)}`;

      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        setDetails((current) => ({ ...current, [key]: data }));
      }
    } catch {
      // Summary ranking remains visible if the detailed Neon request fails.
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-30 bg-navy text-navy-foreground">
        <div className="mx-auto max-w-2xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Football Cards</h1>
              <p className="mt-0.5 text-sm text-navy-foreground/70">
                Next Premier League matchweek · 21–24 Aug 2026
              </p>
            </div>
            <a
              href="/admin/import"
              className="rounded-full bg-navy-foreground/10 px-3 py-1.5 text-xs font-semibold hover:bg-navy-foreground/20"
            >
              Import
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-4">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
              <Database className="size-5 text-foreground" />
            </div>
            <div>
              <p className="font-bold text-foreground">
                Top 5 pre-lineup yellow card radar
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Uses your imported 2025/26 cards, cards/90, fouls/90 and H2H
                foul history, plus verified H2H card incidents. Current
                2026/27 squads were checked on 16 Aug, so summer departures
                such as Casemiro are excluded.
              </p>
            </div>
          </div>
        </section>

        {fixtures.map((fixture) => (
          <section
            key={fixture.id}
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          >
            <div className="border-b border-border bg-secondary/50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {fixture.day} · {fixture.date}
                  </p>
                  <h2 className="mt-1 text-base font-bold text-foreground">
                    {fixture.home}{" "}
                    <span className="font-normal text-muted-foreground">v</span>{" "}
                    {fixture.away}
                  </h2>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-bold text-foreground">
                    {fixture.time}
                  </p>
                  <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
                    Lineups TBC
                  </span>
                </div>
              </div>
            </div>

            <div className="p-3">
              <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Top 5 yellow card candidates
              </p>

              <div className="space-y-2">
                {fixture.candidates.slice(0, 5).map((candidate, index) => {
                  const key = `${fixture.id}-${index}`;
                  const open = selected === key;
                  const detail = details[key];
                  const band = scoreBand(candidate.score);
                  const transferred =
                    candidate.currentTeamDb !== candidate.dbTeam;

                  return (
                    <div
                      key={key}
                      className="overflow-hidden rounded-xl border border-border"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          togglePlayer(fixture, candidate, index)
                        }
                        className="w-full bg-card p-3 text-left transition-colors hover:bg-secondary/40"
                      >
                        <div className="flex items-start gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-sm font-bold text-foreground">
                            {index + 1}
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-bold text-foreground">
                                {candidate.name}
                              </p>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[0.62rem] font-bold ${band.cls}`}
                              >
                                {band.label}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {candidate.team}
                              {transferred
                                ? ` · 2025/26 data from ${candidate.dbTeam}`
                                : ""}
                            </p>

                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className="rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-foreground">
                                🟨 {candidate.yellows} yellows
                              </span>
                              <span className="rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-foreground">
                                {candidate.cards90.toFixed(2)} cards/90
                              </span>
                              <span className="rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-foreground">
                                {candidate.fouls90.toFixed(2)} fouls/90
                              </span>
                              {candidate.h2hFouls ? (
                                <span className="rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-foreground">
                                  {candidate.h2hFouls} H2H fouls
                                </span>
                              ) : null}
                              {candidate.h2hYellows ? (
                                <span className="rounded-lg bg-yellow-50 px-2 py-1 text-xs font-semibold text-foreground">
                                  🟨 {candidate.h2hYellows} H2H{" "}
                                  {candidate.h2hYellows === 1
                                    ? "booking"
                                    : "bookings"}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          {open ? (
                            <ChevronUp className="mt-1 size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" />
                          )}
                        </div>
                      </button>

                      {open ? (
                        <div className="border-t border-border bg-secondary/30 p-3">
                          {loading === key ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <RefreshCw className="size-4 animate-spin" />
                              Loading evidence from Neon…
                            </div>
                          ) : detail?.connected ? (
                            <div className="space-y-3">
                              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                                Imported database evidence
                              </p>

                              {detail.baseline ? (
                                <div className="grid grid-cols-3 gap-2">
                                  <Stat
                                    label="Apps"
                                    value={detail.baseline.appearances}
                                  />
                                  <Stat
                                    label="Yellows"
                                    value={detail.baseline.yellowCards}
                                  />
                                  <Stat
                                    label="Fouls"
                                    value={detail.baseline.foulsCommitted}
                                  />
                                  <Stat
                                    label="Cards/90"
                                    value={detail.baseline.cardsPer90}
                                    decimals
                                  />
                                  <Stat
                                    label="Fouls/90"
                                    value={detail.baseline.foulsPer90}
                                    decimals
                                  />
                                  <Stat
                                    label="Minutes"
                                    value={detail.baseline.minutes}
                                  />
                                </div>
                              ) : null}

                              {detail.h2h && detail.h2h.length > 0 ? (
                                <div>
                                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                                    Previous meetings vs{" "}
                                    {getOpponent(fixture, candidate)}
                                  </p>
                                  <div className="space-y-1.5">
                                    {detail.h2h
                                      .slice(0, 8)
                                      .map((match, matchIndex) => {
                                        const matchDate = cleanDate(
                                          match.matchDate
                                        );
                                        const override =
                                          verifiedCardOverrides[
                                            `${candidate.dbName}|${matchDate}`
                                          ];

                                        const cardStatus =
                                          override === "red" ||
                                          match.redCard === true
                                            ? {
                                                label: "Sent off",
                                                icon: "🟥",
                                                className:
                                                  "text-destructive",
                                              }
                                            : override === "yellow" ||
                                                match.yellowCard === true
                                              ? {
                                                  label: "Booked",
                                                  icon: "🟨",
                                                  className:
                                                    "text-foreground",
                                                }
                                              : match.yellowCard === false
                                                ? {
                                                    label: "No card",
                                                    icon: "",
                                                    className:
                                                      "text-muted-foreground",
                                                  }
                                                : {
                                                    label:
                                                      "Card data missing",
                                                    icon: "?",
                                                    className:
                                                      "text-muted-foreground",
                                                  };

                                        return (
                                          <div
                                            key={`${match.matchDate}-${matchIndex}`}
                                            className="rounded-lg bg-card px-3 py-2 text-xs"
                                          >
                                            <div className="flex items-center justify-between gap-3">
                                              <span className="font-medium text-foreground">
                                                {formatDate(match.matchDate)}
                                              </span>
                                              <span
                                                className={`inline-flex items-center gap-1 font-semibold ${cardStatus.className}`}
                                              >
                                                {cardStatus.icon ? (
                                                  <span>
                                                    {cardStatus.icon}
                                                  </span>
                                                ) : null}
                                                {cardStatus.label}
                                              </span>
                                            </div>

                                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                                              <span>
                                                {match.foulsCommitted ?? "—"}{" "}
                                                fouls committed
                                              </span>
                                              <span>
                                                {match.foulsDrawn ?? "—"} fouls
                                                drawn
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                  </div>
                                  <p className="mt-2 text-[0.68rem] leading-relaxed text-muted-foreground">
                                    Verified incident data is used where we
                                    have it. Unknown database card cells remain
                                    marked as missing rather than being treated
                                    as no card.
                                  </p>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  No imported player H2H rows for this
                                  opponent.
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="flex gap-2 text-sm text-muted-foreground">
                              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                              The ranking is available, but the detailed Neon
                              lookup did not return a player record.
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 border-t border-border pt-3">
                {fixture.meetings ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenHistory((current) => ({
                          ...current,
                          [fixture.id]: !current[fixture.id],
                        }))
                      }
                      className="flex w-full items-center justify-between rounded-xl bg-secondary px-3 py-2 text-left"
                    >
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-foreground">
                          2025/26 H2H cards
                        </p>
                        <p className="text-[0.68rem] text-muted-foreground">
                          2 league meetings · verified card incidents
                        </p>
                      </div>
                      {openHistory[fixture.id] ? (
                        <ChevronUp className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      )}
                    </button>

                    {openHistory[fixture.id] ? (
                      <div className="mt-2 space-y-2">
                        {fixture.meetings.map((meeting) => (
                          <div
                            key={meeting.date}
                            className="rounded-xl border border-border bg-card p-3"
                          >
                            <div className="mb-2">
                              <p className="text-sm font-bold text-foreground">
                                {meeting.label}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(meeting.date)}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {meeting.cards.map((card, cardIndex) => (
                                <span
                                  key={`${meeting.date}-${card.player}-${cardIndex}`}
                                  className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-foreground"
                                >
                                  <span>
                                    {card.card === "red" ? "🟥" : "🟨"}
                                  </span>
                                  {card.player}
                                  <span className="text-muted-foreground">
                                    {card.minute}'
                                  </span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                        <p className="px-1 text-[0.68rem] leading-relaxed text-muted-foreground">
                          This is historical match evidence, so some players
                          listed here may have since moved clubs. Only current
                          2026/27 players are used in the Top 5 above.
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-secondary/30 px-3 py-3">
                    <p className="text-xs font-bold text-foreground">
                      2025/26 league H2H unavailable
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {fixture.noLeagueH2HReason}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}

        <p className="rounded-xl bg-secondary px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Research confidence is an evidence-strength score, not a guaranteed
          booking probability. The 2026 summer transfer window is still open,
          so the current-squad filter should be refreshed again if more players
          move before the window closes.
        </p>
      </div>

      <nav className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-around px-4 py-2">
          <span className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground">
            This week
          </span>
          <a
            href="/admin/import"
            className="px-4 py-2 text-xs font-semibold text-muted-foreground"
          >
            Import data
          </a>
        </div>
      </nav>
    </main>
  );
}

function Stat({
  label,
  value,
  decimals = false,
}: {
  label: string;
  value: number | null | undefined;
  decimals?: boolean;
}) {
  const display =
    value == null
      ? "—"
      : decimals
        ? Number(value).toFixed(2)
        : Math.round(Number(value)).toString();

  return (
    <div className="rounded-xl bg-card px-2 py-2 text-center">
      <p className="font-mono text-base font-bold text-foreground">
        {display}
      </p>
      <p className="mt-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
