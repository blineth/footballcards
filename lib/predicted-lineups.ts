export type PredictedPlayer = {
  name: string
  role: string
}

export type PredictedTeam = {
  formation: string
  sourceLabel: string
  confidence: "predicted" | "recent-xi-fallback"
  players: PredictedPlayer[]
}

export type PredictedFixture = {
  date: string
  home: string
  away: string
  teams: Record<string, PredictedTeam>
}

const team = (formation: string, players: Array<[string, string]>, sourceLabel = "Starting11 predicted XI", confidence: PredictedTeam["confidence"] = "predicted"): PredictedTeam => ({
  formation,
  sourceLabel,
  confidence,
  players: players.map(([name, role]) => ({ name, role })),
})

export const predictedFixtures: PredictedFixture[] = [
  {
    date: "2026-08-29", home: "Liverpool", away: "Nottingham Forest", teams: {
      Liverpool: team("4-2-3-1", [["Alisson Becker","GK"],["Jeremie Frimpong","RB"],["Virgil van Dijk","CB"],["Jeremy Jacquet","CB"],["Milos Kerkez","LB"],["Ryan Gravenberch","CDM"],["Dominik Szoboszlai","CDM"],["Florian Wirtz","CAM"],["Cody Gakpo","LW"],["Victor Munoz","RW"],["Alexander Isak","ST"]]),
      "Nottingham Forest": team("3-4-2-1", [["Matz Sels","GK"],["Nikola Milenkovic","RCB"],["Ousmane Diomande","CB"],["Murillo","LCB"],["Ola Aina","RWB"],["Xaver Schlager","CM"],["Ibrahim Sangare","CM"],["Neco Williams","LWB"],["James McAtee","RAM"],["Igor Jesus","LAM"],["Chris Wood","ST"]]),
    }
  },
  {
    date: "2026-08-29", home: "AFC Bournemouth", away: "Everton", teams: {
      "AFC Bournemouth": team("4-2-3-1", [["Djordje Petrovic","GK"],["Adam Smith","RB"],["James Hill","CB"],["Marcos Senesi","CB"],["Adrien Truffert","LB"],["Lewis Cook","CDM"],["Alex Scott","CDM"],["Marcus Tavernier","RW"],["Rayan","CAM"],["Justin Kluivert","LW"],["Evanilson","ST"]]),
      Everton: team("4-3-3", [["Jordan Pickford","GK"],["Merlin Rohl","RB"],["Jarrad Branthwaite","CB"],["James Tarkowski","CB"],["Vitalii Mykolenko","LB"],["Kiernan Dewsbury-Hall","CM"],["Hayden Hackney","CM"],["James Garner","CM"],["Iliman Ndiaye","RW"],["Thierno Barry","ST"],["Tyler Dibling","LW"]]),
    }
  },
  {
    date: "2026-08-29", home: "Coventry City", away: "Hull City", teams: {
      "Coventry City": team("4-3-3", [["Carl Rushworth","GK"],["Milan van Ewijk","RB"],["Bobby Thomas","CB"],["Aurele Amenda","CB"],["Jay Dasilva","LB"],["Caleb Yirenkyi","CM"],["Matt Grimes","CM"],["Frank Onyeka","CM"],["Loum Tchaouna","RW"],["Ellis Simms","ST"],["Brandon Thomas-Asante","LW"]]),
      "Hull City": team("5-4-1", [["Konstantinos Tzolakis","GK"],["Ryan Giles","LWB"],["Alfie Jones","LCB"],["Sean McLoughlin","CB"],["John Egan","RCB"],["Cody Drameh","RWB"],["Liam Millar","LM"],["Regan Slater","CM"],["Abdulkadir Omur","CM"],["Mohamed Belloumi","RM"],["Oli McBurnie","ST"]]),
    }
  },
  {
    date: "2026-08-29", home: "Tottenham Hotspur", away: "Newcastle United", teams: {
      "Tottenham Hotspur": team("4-3-2-1", [["Antonin Kinsky","GK"],["Pedro Porro","RB"],["Jan Paul van Hecke","CB"],["Marcos Senesi","CB"],["Andy Robertson","LB"],["Sandro Tonali","CM"],["Enzo Fernandez","CM"],["Conor Gallagher","CM"],["Mikey Moore","RAM"],["Archie Gray","LAM"],["Richarlison","ST"]]),
      "Newcastle United": team("4-2-3-1", [["Martin Dubravka","GK"],["Amar Dedic","RB"],["Sven Botman","CB"],["Malick Thiaw","CB"],["Lewis Hall","LB"],["Lewis Miley","CDM"],["Sandro Tonali","CDM"],["Anthony Elanga","RW"],["Harvey Barnes","CAM"],["Nick Woltemade","LW"],["Yoane Wissa","ST"]]),
    }
  },
  {
    date: "2026-08-30", home: "Leeds United", away: "Brentford", teams: {
      "Leeds United": team("3-4-2-1", [["James Trafford","GK"],["Joe Rodon","RCB"],["Nico Elvedi","CB"],["Tarik Muharemovic","LCB"],["Ethan Ampadu","RWB"],["Ao Tanaka","CM"],["Sean Longstaff","CM"],["James Justin","LWB"],["Daniel James","RAM"],["Noah Okafor","LAM"],["Lukas Nmecha","ST"]], "Recent XI fallback", "recent-xi-fallback"),
      Brentford: team("4-2-3-1", [["Caoimhin Kelleher","GK"],["Michael Kayode","RB"],["Kristoffer Ajer","CB"],["Nathan Collins","CB"],["Keane Lewis-Potter","LB"],["Ibrahim Sangare","CDM"],["Mathias Jensen","CDM"],["Dango Ouattara","RW"],["Kevin Schade","CAM"],["Vitaly Janelt","LW"],["Igor Thiago","ST"]]),
    }
  },
  {
    date: "2026-08-30", home: "Sunderland", away: "Fulham", teams: {
      Sunderland: team("4-2-3-1", [["Robin Roefs","GK"],["Thomas Meunier","RB"],["Nordi Mukiele","CB"],["Omar Alderete","CB"],["Reinildo Mandava","LB"],["Granit Xhaka","CDM"],["Noah Sadiki","CDM"],["Enzo Le Fee","RW"],["Chris Rigg","CAM"],["Wilson Isidor","LW"],["Brian Brobbey","ST"]]),
      Fulham: team("4-2-3-1", [["Bernd Leno","GK"],["Kenny Tete","RB"],["Joachim Andersen","CB"],["Calvin Bassey","CB"],["Antonee Robinson","LB"],["Sander Berge","CDM"],["Sasa Lukic","CDM"],["Harry Wilson","RW"],["Emile Smith Rowe","CAM"],["Alex Iwobi","LW"],["Rodrigo Muniz","ST"]], "Recent XI fallback", "recent-xi-fallback"),
    }
  },
  {
    date: "2026-08-30", home: "Manchester United", away: "Ipswich Town", teams: {
      "Manchester United": team("4-2-3-1", [["Senne Lammens","GK"],["Diogo Dalot","RB"],["Harry Maguire","CB"],["Lisandro Martinez","CB"],["Luke Shaw","LB"],["Kobbie Mainoo","CDM"],["Youri Tielemans","CDM"],["Bryan Mbeumo","RW"],["Bruno Fernandes","CAM"],["Matheus Cunha","LW"],["Marcus Rashford","ST"]]),
      "Ipswich Town": team("4-2-3-1", [["Christian Walton","GK"],["Darnell Furlong","RB"],["Dara O'Shea","CB"],["Cedric Kipre","CB"],["Leif Davis","LB"],["Sasa Lukic","CDM"],["Marcelino Nunez","CDM"],["Jaden Philogene","RW"],["Kasey McAteer","CAM"],["Jack Clarke","LW"],["Chuba Akpom","ST"]], "Recent XI / most-used fallback", "recent-xi-fallback"),
    }
  },
  {
    date: "2026-08-31", home: "Aston Villa", away: "Arsenal", teams: {
      "Aston Villa": team("4-2-3-1", [["Zion Suzuki","GK"],["Matty Cash","RB"],["Pau Torres","CB"],["Victor Lindelof","CB"],["Ian Maatsen","LB"],["Boubacar Kamara","CDM"],["John McGinn","CDM"],["Emiliano Buendia","RW"],["Ross Barkley","CAM"],["Felix Manzambi","LW"],["Tammy Abraham","ST"]]),
      Arsenal: team("4-3-3", [["David Raya","GK"],["Ben White","RB"],["Gabriel Magalhaes","CB"],["Cristhian Mosquera","CB"],["Riccardo Calafiori","LB"],["Declan Rice","CM"],["Martin Odegaard","CM"],["Martin Zubimendi","CM"],["Bukayo Saka","RW"],["Kai Havertz","ST"],["Christos Tzolis","LW"]]),
    }
  },
]

export function normalisePredictedName(value: string | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}

export function getPredictedFixture(date: string, home: string, away: string) {
  const n = normalisePredictedName
  return predictedFixtures.find((fixture) => fixture.date === date && n(fixture.home) === n(home) && n(fixture.away) === n(away)) ?? null
}

export function getPredictedPlayer(teamData: PredictedTeam | undefined, name: string) {
  if (!teamData) return null
  const target = normalisePredictedName(name)
  return teamData.players.find((player) => {
    const candidate = normalisePredictedName(player.name)
    return candidate === target || candidate.includes(target) || target.includes(candidate)
  }) ?? null
}

export function directOpponentRoles(role: string) {
  const r = role.toUpperCase()
  const map: Record<string, string[]> = {
    LB: ["RW", "RAM", "RM", "RWB"], LWB: ["RW", "RAM", "RM", "RWB"],
    RB: ["LW", "LAM", "LM", "LWB"], RWB: ["LW", "LAM", "LM", "LWB"],
    LCB: ["ST", "CF", "RW"], RCB: ["ST", "CF", "LW"], CB: ["ST", "CF"],
    CDM: ["CAM", "AM", "CM"], DM: ["CAM", "AM", "CM"], CM: ["CM", "CAM", "AM"],
    CAM: ["CDM", "DM", "CM"], AM: ["CDM", "DM", "CM"],
    LW: ["RB", "RWB", "RCB"], LAM: ["RB", "RWB", "RCB"], LM: ["RB", "RWB"],
    RW: ["LB", "LWB", "LCB"], RAM: ["LB", "LWB", "LCB"], RM: ["LB", "LWB"],
    ST: ["CB", "LCB", "RCB"], CF: ["CB", "LCB", "RCB"],
  }
  return map[r] ?? []
}
